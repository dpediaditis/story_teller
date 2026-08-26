// /characters — createCharacter, listCharacters, getCharacter, updateCharacter,
// deleteCharacter, getTraitSuggestions (contract.ts endpoints). auth: 'user'.
//
// Sub-routing convention (contract.ts's `endpoints` disambiguates only by
// fn+method, which collides for GET — listCharacters vs getCharacter vs
// getTraitSuggestions all read on fn 'characters'). This function resolves it
// by URL path, documented in this agent's handover report:
//   GET    /characters                    -> listCharacters
//   GET    /characters/:id                -> getCharacter
//   GET    /characters/:id/trait-suggestions -> getTraitSuggestions
//   POST   /characters                    -> createCharacter
//   PATCH  /characters                    -> updateCharacter (body.id)
//   DELETE /characters                    -> deleteCharacter (body.id)

import {
  CreateCharacterRequest,
  DeleteCharacterRequest,
  ListCharactersRequest,
  UpdateCharacterRequest,
} from '@papercub/shared';
import {
  CHARACTER_BUILD_ESTIMATED_COST_CENTS,
  MONTHLY_COST_CEILING_CENTS,
  asUntrustedText,
} from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody, parseQuery } from '../_shared/body.ts';
import { toCharacterDto, toJobStatusDto } from '../_shared/dto.ts';
import { loadEntitlementAndQuota, loadRawUsage } from '../_shared/quota.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

const MODEL_BUNDLE_VERSION = Deno.env.get('MODEL_BUNDLE_VERSION') ?? 'papercub-2026.08';

const CHARACTER_SELECT =
  'id, child_id, drawing_id, name, character_type, personality_traits, palette, status, created_at, archived_at';

function subPath(req: Request): string[] {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('characters');
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

/** Rejects any free-text field that fails the shared prompt-injection guard. */
function guardText(field: string, value: string): string {
  const result = asUntrustedText(value);
  if (!result.ok) {
    throw new ApiFailure('moderation_blocked', {
      message: `${field} rejected: ${result.reason}`,
      copyKey: 'moderation.blocked.character_name',
      details: {
        stage: 'input_text',
        subjectType: 'character_name',
        verdict: 'block',
        action: 'name_rejected',
      },
    });
  }
  return value;
}

Deno.serve(
  withEnvelope(async (req) => {
    const { supabase, userId } = await requireUser(req);
    const path = subPath(req);

    if (req.method === 'POST' && path.length === 0) {
      return await createCharacter(req, supabase, userId);
    }

    if (req.method === 'GET' && path.length === 0) {
      const query = parseQuery(req, ListCharactersRequest);
      let q = supabase.from('characters').select(CHARACTER_SELECT);
      if (query.childId) q = q.eq('child_id', query.childId);
      if (!query.includeArchived) q = q.is('archived_at', null);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;

      const characters = await Promise.all((data ?? []).map((c) => hydrateCharacter(supabase, c)));
      const response = { characters };
      return ok(response);
    }

    if (req.method === 'GET' && path.length === 1) {
      const id = path[0];
      const { data: character, error } = await supabase
        .from('characters')
        .select(CHARACTER_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!character) throw new ApiFailure('not_found', { message: 'character not found', copyKey: 'error.not_found' });

      const [{ data: assets, error: assetsError }, { data: stories, error: storiesError }] = await Promise.all([
        supabase
          .from('character_assets')
          .select('id, kind, storage_key, is_primary, version, width_px, height_px')
          .eq('character_id', id),
        supabase
          .from('story_characters')
          .select('story_id, stories(id, title, theme, mood, length, status, created_at, favourited_at, character_tombstone)')
          .eq('character_id', id),
      ]);
      if (assetsError) throw assetsError;
      if (storiesError) throw storiesError;

      const dto = await hydrateCharacter(supabase, character);
      const response = {
        character: dto,
        assets: (assets ?? []).map((a) => ({
          id: a.id,
          kind: a.kind,
          storageKey: a.storage_key,
          isPrimary: a.is_primary,
          version: a.version,
          widthPx: a.width_px,
          heightPx: a.height_px,
        })),
        stories: (stories ?? [])
          .map((row) => (row as unknown as { stories: Record<string, unknown> | null }).stories)
          .filter((s): s is Record<string, unknown> => Boolean(s))
          .map((s) => ({
            id: s.id as string,
            title: (s.title as string | null) ?? null,
            theme: s.theme,
            mood: s.mood,
            length: s.length,
            status: s.status,
            cover: null,
            characterNames: [dto.name],
            characterTombstone: s.character_tombstone as boolean,
            pageCount: 0,
            createdAt: s.created_at as string,
            favouritedAt: (s.favourited_at as string | null) ?? null,
          })),
      };
      return ok(response);
    }

    if (req.method === 'GET' && path.length === 2 && path[1] === 'trait-suggestions') {
      const id = path[0];
      const { data: character, error } = await supabase
        .from('characters')
        .select('id, character_type, personality_traits, status')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!character) throw new ApiFailure('not_found', { message: 'character not found', copyKey: 'error.not_found' });

      const response = {
        characterId: character.id,
        suggestedType: character.character_type,
        suggestedTraits: character.personality_traits,
        ready: character.status === 'ready',
      };
      return ok(response);
    }

    if (req.method === 'PATCH' && path.length === 0) {
      const body = await parseBody(req, UpdateCharacterRequest);
      const patch: { name?: string; character_type?: string | null; personality_traits?: string[] } = {};
      if (body.name !== undefined) patch.name = guardText('name', body.name);
      if (body.characterType !== undefined) {
        patch.character_type = body.characterType === null ? null : guardText('characterType', body.characterType);
      }
      if (body.personalityTraits !== undefined) {
        patch.personality_traits = body.personalityTraits.map((t) => guardText('personalityTraits', t));
      }
      const { data, error } = await supabase
        .from('characters')
        .update(patch)
        .eq('id', body.id)
        .select(CHARACTER_SELECT)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiFailure('not_found', { message: 'character not found', copyKey: 'error.not_found' });

      const dto = await hydrateCharacter(supabase, data);
      const response = { character: dto };
      return ok(response);
    }

    if (req.method === 'DELETE' && path.length === 0) {
      const body = await parseBody(req, DeleteCharacterRequest);
      const { data, error } = await supabase
        .from('characters')
        .update({ archived_at: new Date().toISOString(), status: 'archived' })
        .eq('id', body.id)
        .is('archived_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiFailure('not_found', { message: 'character not found', copyKey: 'error.not_found' });
      return ok({});
    }

    throw new ApiFailure('validation_failed', { message: `unsupported route ${req.method} /characters/${path.join('/')}` });
  }),
);

async function hydrateCharacter(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  character: {
    id: string;
    child_id: string;
    drawing_id: string;
    name: string;
    character_type: string | null;
    personality_traits: string[];
    palette: string[];
    status: string;
    created_at: string;
    archived_at: string | null;
  },
) {
  const [{ data: drawing, error: drawingError }, { data: primaryAsset, error: assetError }, { count, error: countError }] =
    await Promise.all([
      supabase
        .from('original_drawings')
        .select('cutout_storage_key, storage_key')
        .eq('id', character.drawing_id)
        .single(),
      supabase
        .from('character_assets')
        .select('id, kind, storage_key, is_primary, version, width_px, height_px')
        .eq('character_id', character.id)
        .eq('is_primary', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('story_characters')
        .select('story_id', { count: 'exact', head: true })
        .eq('character_id', character.id),
    ]);
  if (drawingError) throw drawingError;
  if (assetError) throw assetError;
  if (countError) throw countError;

  return toCharacterDto({
    character,
    drawing: drawing ?? { cutout_storage_key: '', storage_key: null },
    primaryAsset: primaryAsset ?? null,
    storyCount: count ?? 0,
  });
}

async function createCharacter(
  req: Request,
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
) {
  const body = await parseBody(req, CreateCharacterRequest);

  const name = guardText('name', body.name);
  const characterType = body.characterType === null ? null : guardText('characterType', body.characterType);
  const personalityTraits = body.personalityTraits.map((t) => guardText('personalityTraits', t));

  // Ownership re-check (RLS backstops this, but we want a clean forbidden).
  const { data: child, error: childError } = await supabase
    .from('child_profiles')
    .select('id')
    .eq('id', body.childId)
    .is('deleted_at', null)
    .maybeSingle();
  if (childError) throw childError;
  if (!child) throw new ApiFailure('forbidden', { message: 'child does not belong to caller', copyKey: 'error.forbidden' });

  // Quota + cost ceiling, checked BEFORE any write (contract.ts comment on
  // CreateCharacterRequest). No security-definer claim function exists for
  // this path (see _shared/jobs.ts) so this check is NOT atomic with the
  // insert the way claim_story_quota is for stories — a known, documented gap
  // under concurrent double-submission from the same account.
  const { quota } = await loadEntitlementAndQuota(supabase, userId);
  if (quota.charactersUsed >= quota.charactersLimit) {
    throw new ApiFailure('quota_exceeded', {
      message: 'character quota exhausted',
      copyKey: 'error.quota_exceeded.character',
      details: { quota },
    });
  }
  const raw = await loadRawUsage(supabase, userId);
  if (raw.costCentsAccrued + raw.costCentsReserved + CHARACTER_BUILD_ESTIMATED_COST_CENTS > MONTHLY_COST_CEILING_CENTS) {
    throw new ApiFailure('cost_ceiling_exceeded', {
      message: 'monthly cost ceiling would be exceeded',
      copyKey: 'error.cost_ceiling_exceeded',
      details: { quota },
    });
  }

  let drawingId: string | null = null;
  let characterId: string | null = null;
  try {
    const { data: drawing, error: drawingError } = await supabase
      .from('original_drawings')
      .insert({
        child_id: body.childId,
        storage_key: body.drawing.originalStorageKey,
        cutout_storage_key: body.drawing.cutoutStorageKey,
        captured_at: body.drawing.capturedAt,
        source: body.drawing.source,
        retention_policy: body.drawing.retentionPolicy,
        exif_stripped: body.drawing.exifStripped,
        isolation_method: body.drawing.isolationMethod,
        isolation_confidence: body.drawing.isolationConfidence,
        face_detected: body.drawing.faceDetected,
        text_detected: body.drawing.textDetected,
        width_px: body.drawing.widthPx,
        height_px: body.drawing.heightPx,
      })
      .select('id')
      .single();
    if (drawingError) throw drawingError;
    drawingId = drawing.id;

    const { data: character, error: characterError } = await supabase
      .from('characters')
      .insert({
        child_id: body.childId,
        drawing_id: drawingId,
        name,
        character_type: characterType,
        personality_traits: personalityTraits,
        palette: body.palette,
        status: 'building',
      })
      .select(CHARACTER_SELECT)
      .single();
    if (characterError) throw characterError;
    characterId = character.id;

    // claim_character_build (migration 20260826200000) claims the slot,
    // reserves the cost, writes the generation_jobs row and enqueues, all in
    // one transaction. A direct insert here is blocked by RLS by design —
    // generation_jobs is SELECT-only for `authenticated` — which is why this
    // path could not work at all before that migration existed.
    //
    // §15 finding 11 is NOT closed here. The claim function honours an
    // idempotency key, but `CreateCharacterRequest` has no field to carry one —
    // unlike CreateStoryRequest — so there is nothing to pass but a fresh uuid,
    // and a retried request still mints a second character. Closing it is a
    // contract change (add `idempotencyKey` to CreateCharacterRequest) plus a
    // client change, not a fix that belongs in this function alone.
    const { data: claim, error: claimError } = await supabase.rpc('claim_character_build', {
      p_character_id: characterId,
      p_model_bundle_version: MODEL_BUNDLE_VERSION,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (claimError) throw claimError;

    const claimed = claim as {
      ok: boolean;
      jobId?: string;
      blockedBy?: string;
      charactersUsed?: number;
      charactersLimit?: number;
    };

    if (!claimed.ok) {
      const { quota: blockedQuota } = await loadEntitlementAndQuota(supabase, userId);
      throw new ApiFailure(
        claimed.blockedBy === 'cost_ceiling_reached' ? 'cost_ceiling_exceeded' : 'quota_exceeded',
        {
          message: `character build refused: ${claimed.blockedBy}`,
          copyKey:
            claimed.blockedBy === 'cost_ceiling_reached'
              ? 'error.cost_ceiling_exceeded'
              : 'error.quota_exceeded.character',
          details: { quota: blockedQuota },
        },
      );
    }

    const { data: jobRow, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', claimed.jobId!)
      .single();
    if (jobError) throw jobError;

    const dto = await hydrateCharacter(supabase, character);
    const { quota: freshQuota } = await loadEntitlementAndQuota(supabase, userId);
    const response = {
      character: dto,
      job: toJobStatusDto(jobRow),
      quota: freshQuota,
    };
    return ok(response);
  } catch (e) {
    // Don't leave an orphaned character/drawing behind a job we couldn't create.
    if (characterId) await supabase.from('characters').delete().eq('id', characterId);
    if (drawingId) await supabase.from('original_drawings').delete().eq('id', drawingId);
    throw e;
  }
}
