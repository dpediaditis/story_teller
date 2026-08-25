// /stories — createStory, listStories, getStory, setStoryFavourite,
// deleteStory, regeneratePage (contract.ts endpoints). auth: 'user'.
//
// THE quota gate (docs/AGENT_BRIEFS.md B2: "the thing that matters most").
// Checks 1-3 (halt, rate limit, entitlement) run here in TS; checks 4-5
// (story quota, measured cost ceiling) plus the atomic insert are entirely
// inside claim_story_quota() (supabase/migrations/20260826120000_...), which
// also derives pages/cost from length and enqueues the pgmq message. This
// file NEVER reimplements that arithmetic — it calls the RPC and maps its
// jsonb result to ApiErrorCode / QuotaSnapshot.
//
// Sub-routing convention (see characters/index.ts for the same issue):
//   POST   /stories                  -> createStory
//   POST   /stories/regenerate-page  -> regeneratePage
//   GET    /stories                  -> listStories
//   GET    /stories/:id              -> getStory
//   PATCH  /stories                  -> setStoryFavourite (body.id)
//   DELETE /stories                  -> deleteStory (body.id)

import {
  CreateStoryRequest,
  DeleteStoryRequest,
  ListStoriesRequest,
  RegeneratePageRequest,
  SetStoryFavouriteRequest,
} from '@papercub/shared';
import {
  FREE_PAGE_REGENS_PER_STORY,
  MONTHLY_COST_CEILING_CENTS,
  STORY_SHAPE,
} from '@papercub/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody, parseQuery } from '../_shared/body.ts';
import { toJobStatusDto, toPageIllustrationDto, toStoryPageDto } from '../_shared/dto.ts';
import { insertJobOrExplain } from '../_shared/jobs.ts';
import { isGenerationHalted, loadEntitlementAndQuota, loadRawUsage } from '../_shared/quota.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

const MODEL_BUNDLE_VERSION = Deno.env.get('MODEL_BUNDLE_VERSION') ?? 'papercub-2026.08';

const STORY_SUMMARY_SELECT =
  'id, title, theme, mood, length, status, cover_asset_id, render_technique, model_bundle_version, character_tombstone, created_at, completed_at, favourited_at, child_id';

function subPath(req: Request): string[] {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('stories');
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

Deno.serve(
  withEnvelope(async (req) => {
    const { supabase, userId } = await requireUser(req);
    const path = subPath(req);

    if (req.method === 'POST' && path.length === 1 && path[0] === 'regenerate-page') {
      return await regeneratePage(req, supabase, userId);
    }
    if (req.method === 'POST' && path.length === 0) {
      return await createStory(req, supabase, userId);
    }
    if (req.method === 'GET' && path.length === 1) {
      const story = await buildStoryDetail(supabase, path[0]);
      if (!story) throw new ApiFailure('not_found', { message: 'story not found', copyKey: 'error.not_found' });
      return ok({ story });
    }
    if (req.method === 'GET' && path.length === 0) {
      return await listStories(req, supabase);
    }
    if (req.method === 'PATCH' && path.length === 0) {
      const body = await parseBody(req, SetStoryFavouriteRequest);
      const { data, error } = await supabase
        .from('stories')
        .update({ favourited_at: body.favourited ? new Date().toISOString() : null })
        .eq('id', body.id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiFailure('not_found', { message: 'story not found', copyKey: 'error.not_found' });
      return ok({});
    }
    if (req.method === 'DELETE' && path.length === 0) {
      const body = await parseBody(req, DeleteStoryRequest);
      const { data, error } = await supabase
        .from('stories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', body.id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiFailure('not_found', { message: 'story not found', copyKey: 'error.not_found' });
      return ok({});
    }

    throw new ApiFailure('validation_failed', { message: `unsupported route ${req.method} /stories/${path.join('/')}` });
  }),
);

async function createStory(req: Request, supabase: SupabaseClient<Database>, userId: string) {
  const body = await parseBody(req, CreateStoryRequest);

  // MVP restriction (contract.ts comment on CreateStoryRequest): the server
  // rejects length !== 1 until V1.1, even though the schema allows up to 3.
  if (body.characters.length !== 1) {
    throw new ApiFailure('validation_failed', {
      message: 'exactly one character is supported until V1.1',
      copyKey: 'error.validation_failed',
    });
  }

  // 1. global generation halt.
  if (isGenerationHalted()) {
    throw new ApiFailure('service_halted', {
      message: 'generation is temporarily halted',
      copyKey: 'error.service_halted',
      retryable: true,
    });
  }

  // 2. per-device / per-IP rate limit (anonymous only). KNOWN GAP: no
  // device-id or IP table exists in the delivered schema (DECISIONS.md §12
  // compensating control #3), so this is a same-account proxy over
  // generation_jobs rather than true per-device/per-IP limiting. Flagged in
  // this agent's handover report.
  const { data: parentRow, error: parentError } = await supabase
    .from('parent_accounts')
    .select('is_anonymous')
    .eq('id', userId)
    .single();
  if (parentError) throw parentError;
  if (parentRow.is_anonymous) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('generation_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'story_generate')
      .gte('created_at', since);
    if (countError) throw countError;
    if ((count ?? 0) >= 3) {
      throw new ApiFailure('rate_limited', {
        message: 'anonymous story generation rate limit exceeded',
        copyKey: 'error.rate_limited',
        retryable: true,
      });
    }
  }

  // 3. entitlement -> allowedLengths.
  const { quota } = await loadEntitlementAndQuota(supabase, userId);
  if (!quota.allowedLengths.includes(body.length)) {
    throw new ApiFailure('entitlement_required', {
      message: `length '${body.length}' is not allowed on the current plan`,
      copyKey: 'error.entitlement_required.length',
      details: { quota },
    });
  }

  const shape = STORY_SHAPE[body.length];
  const characterIds = body.characters.map((c) => c.characterId);

  // 4 & 5. story quota + MEASURED cost ceiling, atomic with the insert.
  const { data: claim, error: claimError } = await supabase.rpc('claim_story_quota', {
    p_child_id: body.childId,
    p_character_ids: characterIds,
    p_theme: body.theme,
    p_mood: body.mood,
    p_length: body.length,
    p_render_technique: 'cutout_rerender',
    p_model_bundle_version: MODEL_BUNDLE_VERSION,
    p_idempotency_key: body.idempotencyKey,
  });
  if (claimError) {
    if (claimError.message?.includes('forbidden')) {
      throw new ApiFailure('forbidden', { message: claimError.message, copyKey: 'error.forbidden' });
    }
    if (claimError.message?.includes('unauthenticated')) {
      throw new ApiFailure('unauthenticated', { message: claimError.message });
    }
    throw claimError;
  }

  const result = claim as {
    allowed: boolean;
    idempotentReplay?: boolean;
    storyId?: string;
    jobId?: string;
    blockedBy?: string;
  };

  if (!result.allowed) {
    const { quota: freshQuota } = await loadEntitlementAndQuota(supabase, userId);
    if (result.blockedBy === 'cost_ceiling_reached') {
      throw new ApiFailure('cost_ceiling_exceeded', {
        message: 'monthly cost ceiling reached',
        copyKey: 'error.cost_ceiling_exceeded',
        details: { quota: freshQuota },
      });
    }
    throw new ApiFailure('quota_exceeded', {
      message: `story quota blocked: ${result.blockedBy}`,
      copyKey:
        result.blockedBy === 'free_tier_consumed'
          ? 'error.quota_exceeded.free'
          : 'error.quota_exceeded.family',
      details: { quota: freshQuota },
    });
  }

  const storyId = result.storyId!;
  const jobId = result.jobId!;

  const [story, quotaResult, jobRes] = await Promise.all([
    buildStoryDetail(supabase, storyId),
    loadEntitlementAndQuota(supabase, userId),
    supabase
      .from('generation_jobs')
      .select(
        'id, type, status, stage, pages_completed, pages_total, story_id, character_id, error_code, quota_refunded, started_at, finished_at, created_at',
      )
      .eq('id', jobId)
      .single(),
  ]);
  if (jobRes.error) throw jobRes.error;
  if (!story) throw new ApiFailure('internal', { message: 'story disappeared immediately after claim_story_quota' });

  return ok({
    story,
    job: toJobStatusDto(jobRes.data),
    quota: quotaResult.quota,
  });
}

async function listStories(req: Request, supabase: SupabaseClient<Database>) {
  const query = parseQuery(req, ListStoriesRequest);
  let q = supabase.from('stories').select(STORY_SUMMARY_SELECT).is('deleted_at', null);
  if (query.childId) q = q.eq('child_id', query.childId);
  if (query.favouritesOnly) q = q.not('favourited_at', 'is', null);
  q = q.order('created_at', { ascending: false }).limit(query.limit);
  if (query.cursor) q = q.lt('created_at', query.cursor);

  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];

  const stories = await Promise.all(rows.map((r) => toStorySummary(supabase, r)));
  const nextCursor = rows.length === query.limit ? rows[rows.length - 1]?.created_at ?? null : null;
  return ok({ stories, nextCursor });
}

async function buildStoryDetail(supabase: SupabaseClient<Database>, id: string) {
  const { data: story, error } = await supabase.from('stories').select(STORY_SUMMARY_SELECT).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!story) return null;

  const [
    { data: pages, error: pagesError },
    { data: storyChars, error: storyCharsError },
    { data: narration, error: narrationError },
    { data: activeJob, error: jobError },
  ] = await Promise.all([
    supabase
      .from('story_pages')
      .select('id, index, text, status, regen_count, illustration_asset_id')
      .eq('story_id', id)
      .order('index', { ascending: true }),
    supabase
      .from('story_characters')
      .select('character_id, role, order_index, characters(name)')
      .eq('story_id', id)
      .order('order_index', { ascending: true }),
    supabase
      .from('narrations')
      .select('id, storage_key, word_timings_key, sentence_level_only, duration_ms, voice_id, language')
      .eq('story_id', id)
      .maybeSingle(),
    supabase
      .from('generation_jobs')
      .select('id, status, stage, pages_completed, pages_total')
      .eq('story_id', id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (pagesError) throw pagesError;
  if (storyCharsError) throw storyCharsError;
  if (narrationError) throw narrationError;
  if (jobError) throw jobError;

  const illustrationIds = [
    story.cover_asset_id,
    ...(pages ?? []).map((p) => p.illustration_asset_id),
  ].filter((x): x is string => Boolean(x));

  const illustrationsById = new Map<string, { id: string; page_index: number; storage_key: string; width: number; height: number }>();
  if (illustrationIds.length > 0) {
    const { data: illustrations, error: illError } = await supabase
      .from('page_illustrations')
      .select('id, page_index, storage_key, width, height')
      .in('id', illustrationIds);
    if (illError) throw illError;
    for (const ill of illustrations ?? []) illustrationsById.set(ill.id, ill);
  }

  const pageDtos = (pages ?? []).map((p) =>
    toStoryPageDto(p, p.illustration_asset_id ? illustrationsById.get(p.illustration_asset_id) ?? null : null),
  );

  const characters = (storyChars ?? []).map((sc) => ({
    characterId: sc.character_id,
    role: sc.role,
    orderIndex: sc.order_index,
    name: (sc as unknown as { characters: { name: string } | null }).characters?.name ?? '',
  }));

  const storyDto = {
    id: story.id,
    title: story.title,
    theme: story.theme,
    mood: story.mood,
    length: story.length,
    status: story.status,
    cover: toPageIllustrationDto(story.cover_asset_id ? illustrationsById.get(story.cover_asset_id) ?? null : null),
    characterNames: characters.map((c) => c.name),
    characterTombstone: story.character_tombstone,
    pageCount: (pages ?? []).length,
    createdAt: story.created_at,
    favouritedAt: story.favourited_at,
    characters,
    pages: pageDtos,
    narration: narration
      ? {
          id: narration.id,
          storageKey: narration.storage_key,
          wordTimingsKey: narration.word_timings_key,
          sentenceLevelOnly: narration.sentence_level_only,
          durationMs: narration.duration_ms,
          voiceId: narration.voice_id,
          language: narration.language,
        }
      : null,
    activeJob: activeJob
      ? {
          id: activeJob.id,
          status: activeJob.status,
          stage: activeJob.stage,
          pagesCompleted: activeJob.pages_completed,
          pagesTotal: activeJob.pages_total,
        }
      : null,
    renderTechnique: story.render_technique,
    modelBundleVersion: story.model_bundle_version,
  };

  return storyDto;
}

async function toStorySummary(
  supabase: SupabaseClient<Database>,
  story: {
    id: string;
    title: string | null;
    theme: string;
    mood: string;
    length: string;
    status: string;
    cover_asset_id: string | null;
    character_tombstone: boolean;
    created_at: string;
    favourited_at: string | null;
  },
) {
  const [{ data: storyChars, error: charsError }, { count: pageCount, error: pageCountError }, coverIllustration] =
    await Promise.all([
      supabase.from('story_characters').select('characters(name)').eq('story_id', story.id),
      supabase.from('story_pages').select('id', { count: 'exact', head: true }).eq('story_id', story.id),
      story.cover_asset_id
        ? supabase
            .from('page_illustrations')
            .select('id, page_index, storage_key, width, height')
            .eq('id', story.cover_asset_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (charsError) throw charsError;
  if (pageCountError) throw pageCountError;
  if (coverIllustration.error) throw coverIllustration.error;

  const characterNames = (storyChars ?? []).map(
    (sc) => (sc as unknown as { characters: { name: string } | null }).characters?.name ?? '',
  );

  return {
    id: story.id,
    title: story.title,
    theme: story.theme,
    mood: story.mood,
    length: story.length,
    status: story.status,
    cover: toPageIllustrationDto(coverIllustration.data),
    characterNames,
    characterTombstone: story.character_tombstone,
    pageCount: pageCount ?? 0,
    createdAt: story.created_at,
    favouritedAt: story.favourited_at,
  };
}

async function regeneratePage(req: Request, supabase: SupabaseClient<Database>, userId: string) {
  const body = await parseBody(req, RegeneratePageRequest);

  if (isGenerationHalted()) {
    throw new ApiFailure('service_halted', { message: 'generation is temporarily halted', copyKey: 'error.service_halted', retryable: true });
  }

  // Idempotent replay: an existing job for this key wins, no new claim.
  const { data: existingJob, error: existingJobError } = await supabase
    .from('generation_jobs')
    .select('id, type, status, stage, pages_completed, pages_total, story_id, character_id, error_code, quota_refunded, started_at, finished_at, created_at')
    .eq('parent_id', userId)
    .eq('idempotency_key', body.idempotencyKey)
    .maybeSingle();
  if (existingJobError) throw existingJobError;
  if (existingJob) {
    const { quota } = await loadEntitlementAndQuota(supabase, userId);
    return ok({ job: toJobStatusDto(existingJob), quota });
  }

  const { data: page, error: pageError } = await supabase
    .from('story_pages')
    .select('id, regen_count, story_id')
    .eq('story_id', body.storyId)
    .eq('index', body.pageIndex)
    .maybeSingle();
  if (pageError) throw pageError;
  if (!page) throw new ApiFailure('not_found', { message: 'page not found', copyKey: 'error.not_found' });

  // 2 free regens per story (FREE_PAGE_REGENS_PER_STORY), then metered against
  // the same measured cost ceiling as a new story.
  const estimatedCostCents = page.regen_count < FREE_PAGE_REGENS_PER_STORY ? 0 : STORY_SHAPE.short.estimatedCostCents;
  const raw = await loadRawUsage(supabase, userId);
  if (raw.costCentsAccrued + raw.costCentsReserved + estimatedCostCents > MONTHLY_COST_CEILING_CENTS) {
    const { quota } = await loadEntitlementAndQuota(supabase, userId);
    throw new ApiFailure('cost_ceiling_exceeded', {
      message: 'monthly cost ceiling would be exceeded',
      copyKey: 'error.cost_ceiling_exceeded',
      details: { quota },
    });
  }

  const jobRow = await insertJobOrExplain(supabase, {
    parentId: userId,
    storyId: body.storyId,
    type: 'page_regenerate',
    estimatedCostCents,
    idempotencyKey: body.idempotencyKey,
  });

  const { quota } = await loadEntitlementAndQuota(supabase, userId);
  return ok({ job: toJobStatusDto(jobRow), quota });
}
