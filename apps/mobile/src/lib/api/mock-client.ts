import { z } from 'zod';
import {
  ChildProfileDto as ChildProfileDtoSchema,
  CreateCharacterRequest as CreateCharacterRequestSchema,
  CreateStoryRequest as CreateStoryRequestSchema,
  QUOTA,
  STORY_SHAPE,
  TOPUP_STORIES_GRANTED,
  UpsertChildRequest as UpsertChildRequestSchema,
  type CharacterDto,
  type EndpointName,
  type EndpointRequest,
  type EndpointResponse,
  type EntitlementSnapshot,
  type GenerationStage,
  type JobProgressEvent,
  type JobStatusDto,
  type QuotaSnapshot,
  type StoryDetailDto,
  type StorySummaryDto,
} from '@papercub/shared';
import { ApiCallError, type ApiClient } from './client';
import { GENERATION_STAGE_ORDER } from './copy';

type ChildProfileDto = z.infer<typeof ChildProfileDtoSchema>;
type UpsertChildRequest = z.infer<typeof UpsertChildRequestSchema>;
type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>;
type CreateStoryRequest = z.infer<typeof CreateStoryRequestSchema>;

/* ── in-memory fixtures ──────────────────────────────────────────────────
 * Seeded so every screen has something to render on first launch in Expo
 * Go, without a backend. Mutated in place by the calls below — this is a
 * demo data store, not a cache of a real one.
 */

let uidCounter = 1;
function nextId(prefix: string) {
  return `${prefix}-${uidCounter++}`;
}

const now = () => new Date().toISOString();

let entitlement: EntitlementSnapshot = {
  tier: 'free',
  status: 'none',
  productId: null,
  periodEnd: null,
  renewsAt: null,
  environment: 'sandbox',
};

let usage = { storiesUsed: 0, charactersUsed: 0, costCentsAccrued: 0, topupStoriesRemaining: 0 };

const children: ChildProfileDto[] = [
  {
    id: nextId('child'),
    displayName: 'Mia',
    ageBand: '6_7',
    avatarCharacterId: null,
    createdAt: now(),
  },
];

const characters: CharacterDto[] = [
  {
    id: nextId('char'),
    childId: children[0]!.id,
    drawingId: nextId('drawing'),
    name: 'Bobo',
    characterType: 'Purple monster',
    personalityTraits: ['Funny and brave'],
    palette: ['#6d47bd', '#efe7fb'],
    status: 'ready',
    storyCount: 2,
    primaryAsset: {
      id: nextId('asset'),
      kind: 'cutout',
      storageKey: 'character-assets/demo/bobo/cutout.png',
      isPrimary: true,
      version: 1,
      widthPx: 900,
      heightPx: 900,
    },
    cutoutStorageKey: 'drawings/demo/bobo/cutout.png',
    originalStorageKey: null,
    createdAt: now(),
    archivedAt: null,
  },
  {
    id: nextId('char'),
    childId: children[0]!.id,
    drawingId: nextId('drawing'),
    name: 'Luna',
    characterType: 'Sleepy fox',
    personalityTraits: ['Curious'],
    palette: ['#e8d9ae', '#4f5c25'],
    status: 'ready',
    storyCount: 1,
    primaryAsset: {
      id: nextId('asset'),
      kind: 'cutout',
      storageKey: 'character-assets/demo/luna/cutout.png',
      isPrimary: true,
      version: 1,
      widthPx: 900,
      heightPx: 900,
    },
    cutoutStorageKey: 'drawings/demo/luna/cutout.png',
    originalStorageKey: null,
    createdAt: now(),
    archivedAt: null,
  },
];

const stories: StoryDetailDto[] = [
  {
    id: nextId('story'),
    title: 'Bobo and the Missing Moon',
    theme: 'space',
    mood: 'adventurous',
    length: 'short',
    status: 'ready',
    cover: {
      id: nextId('illus'),
      pageIndex: 0,
      storageKey: 'illustrations/demo/moon/cover.png',
      width: 1024,
      height: 1280,
    },
    characterNames: ['Bobo'],
    characterTombstone: false,
    pageCount: STORY_SHAPE.short.pageCount,
    createdAt: now(),
    favouritedAt: null,
    characters: [{ characterId: characters[0]!.id, role: 'lead', orderIndex: 0, name: 'Bobo' }],
    pages: buildReadyPages(STORY_SHAPE.short.pageCount, 'Bobo'),
    narration: {
      id: nextId('narr'),
      storageKey: 'narration/demo/moon/audio.m4a',
      wordTimingsKey: null,
      sentenceLevelOnly: true,
      durationMs: 92_000,
      voiceId: 'papercub_default',
      language: 'en',
    },
    activeJob: null,
    renderTechnique: 'cutout_rerender',
    modelBundleVersion: 'mock-1',
  },
  {
    id: nextId('story'),
    title: 'Luna Finds the Secret Forest',
    theme: 'jungle',
    mood: 'calm',
    length: 'normal',
    status: 'ready',
    cover: {
      id: nextId('illus'),
      pageIndex: 0,
      storageKey: 'illustrations/demo/forest/cover.png',
      width: 1024,
      height: 1280,
    },
    characterNames: ['Luna'],
    characterTombstone: false,
    pageCount: STORY_SHAPE.normal.pageCount,
    createdAt: now(),
    favouritedAt: null,
    characters: [{ characterId: characters[1]!.id, role: 'lead', orderIndex: 0, name: 'Luna' }],
    pages: buildReadyPages(STORY_SHAPE.normal.pageCount, 'Luna'),
    narration: {
      id: nextId('narr'),
      storageKey: 'narration/demo/forest/audio.m4a',
      wordTimingsKey: null,
      sentenceLevelOnly: true,
      durationMs: 140_000,
      voiceId: 'papercub_default',
      language: 'en',
    },
    activeJob: null,
    renderTechnique: 'cutout_rerender',
    modelBundleVersion: 'mock-1',
  },
];

function buildReadyPages(count: number, name: string): StoryDetailDto['pages'] {
  const lines = [
    `${name} checked behind the clouds. No moon there either.`,
    `"Maybe it rolled," said ${name}.`,
    `${name} looked behind the biggest cloud. No moon.`,
    `He looked under a sleeping star. Still no moon.`,
    `Something round and silver was hiding by the hill.`,
    `${name} laughed — there it was all along.`,
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: nextId('page'),
    index: i + 1,
    text: lines[i % lines.length] ?? lines[0] ?? '',
    status: 'ready' as const,
    regenCount: 0,
    illustration: {
      id: nextId('illus'),
      pageIndex: i + 1,
      storageKey: `illustrations/demo/page-${i + 1}.png`,
      width: 1024,
      height: 768,
    },
  }));
}

function computeQuota(): QuotaSnapshot {
  const tier = entitlement.tier;
  const cfg = tier === 'free' ? QUOTA.free : QUOTA.family;
  const storiesLimit = tier === 'free' ? QUOTA.free.storiesTotal : QUOTA.family.storiesPerPeriod;
  const charactersLimit = cfg.charactersTotal;
  const storiesRemaining = Math.max(0, storiesLimit - usage.storiesUsed);
  const freeTierConsumed = tier === 'free' && usage.storiesUsed >= QUOTA.free.storiesTotal;
  return {
    storiesUsed: usage.storiesUsed,
    storiesLimit,
    storiesRemaining,
    topupStoriesRemaining: usage.topupStoriesRemaining,
    charactersUsed: characters.filter((c) => c.status !== 'archived').length,
    charactersLimit,
    allowedLengths: [...cfg.allowedLengths],
    freeTierConsumed,
    periodEnd: tier === 'family' ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null,
    costCentsAccrued: usage.costCentsAccrued,
    costCeilingCents: 385,
    blockedBy:
      storiesRemaining <= 0 && usage.topupStoriesRemaining <= 0
        ? tier === 'free'
          ? 'free_tier_consumed'
          : 'story_quota_exhausted'
        : null,
  };
}

/* ── job simulation ───────────────────────────────────────────────────── */

interface MockJob {
  id: string;
  storyId: string | null;
  characterId: string | null;
  type: 'character_build' | 'story_generate';
  stageIndex: number;
  pagesTotal: number;
  pagesCompleted: number;
  startedAt: number;
  listeners: Set<(event: JobProgressEvent) => void>;
  timer: ReturnType<typeof setInterval> | null;
  failed: boolean;
}

const jobs = new Map<string, MockJob>();

function stageCopyKey(stage: GenerationStage) {
  return `generation.stage.${stage}`;
}

function emitJob(job: MockJob) {
  const stage = GENERATION_STAGE_ORDER[job.stageIndex] ?? 'queued';
  const readable: number[] = [];
  for (let i = 1; i <= job.pagesCompleted; i++) readable.push(i);
  const event: JobProgressEvent = {
    jobId: job.id,
    storyId: job.storyId,
    status: job.failed ? 'failed' : stage === 'done' ? 'succeeded' : 'running',
    stage,
    stageCopyKey: stageCopyKey(stage),
    pagesCompleted: job.pagesCompleted,
    pagesTotal: job.pagesTotal,
    coverReady: job.stageIndex >= GENERATION_STAGE_ORDER.indexOf('illustrating_pages'),
    readablePageIndexes: readable,
    errorCode: job.failed ? 'provider_timeout' : null,
    emittedAt: now(),
  };
  job.listeners.forEach((fn) => fn(event));
}

function startJob(args: {
  storyId: string | null;
  characterId: string | null;
  type: 'character_build' | 'story_generate';
  pagesTotal: number;
  /** Demo hook: force a failure to exercise the "Generation failed" state. */
  forceFail?: boolean;
}): MockJob {
  const job: MockJob = {
    id: nextId('job'),
    storyId: args.storyId,
    characterId: args.characterId,
    type: args.type,
    stageIndex: 0,
    pagesTotal: args.pagesTotal,
    pagesCompleted: 0,
    startedAt: Date.now(),
    listeners: new Set(),
    timer: null,
    failed: false,
  };
  jobs.set(job.id, job);

  const relevantStages =
    args.type === 'character_build'
      ? GENERATION_STAGE_ORDER.filter((s) =>
          ['queued', 'moderating_input', 'analysing_drawing', 'building_character_refs', 'done'].includes(s),
        )
      : GENERATION_STAGE_ORDER;

  let tick = 0;
  job.timer = setInterval(() => {
    tick += 1;
    if (args.forceFail && tick === 3) {
      job.failed = true;
      emitJob(job);
      if (job.timer) clearInterval(job.timer);
      return;
    }
    const currentStageName = GENERATION_STAGE_ORDER[job.stageIndex] ?? 'queued';
    const relIndex = relevantStages.indexOf(currentStageName);
    if (currentStageName === 'illustrating_pages' && job.pagesCompleted < job.pagesTotal) {
      job.pagesCompleted += 1;
      emitJob(job);
      if (job.pagesCompleted < job.pagesTotal) return;
    }
    const nextRelIndex = Math.min(relIndex + 1, relevantStages.length - 1);
    const nextStage = relevantStages[nextRelIndex] ?? 'done';
    job.stageIndex = GENERATION_STAGE_ORDER.indexOf(nextStage);
    emitJob(job);
    if (nextStage === 'done') {
      if (job.timer) clearInterval(job.timer);
    }
  }, 900);

  return job;
}

function jobToDto(job: MockJob): JobStatusDto {
  const stage = GENERATION_STAGE_ORDER[job.stageIndex] ?? 'queued';
  return {
    id: job.id,
    type: job.type,
    status: job.failed ? 'failed' : stage === 'done' ? 'succeeded' : 'running',
    stage,
    stageCopyKey: stageCopyKey(stage),
    pagesCompleted: job.pagesCompleted,
    pagesTotal: job.pagesTotal,
    storyId: job.storyId,
    characterId: job.characterId,
    errorCode: job.failed ? 'provider_timeout' : null,
    quotaRefunded: job.failed,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: stage === 'done' || job.failed ? now() : null,
    elapsedMs: Date.now() - job.startedAt,
  };
}

/* ── the client ───────────────────────────────────────────────────────── */

function ok<T>(data: T): T {
  return data;
}

function fail(code: import('@papercub/shared').ApiErrorCode, copyKey: string): never {
  throw new ApiCallError({
    code,
    message: `[mock] ${code}`,
    copyKey,
    retryable: code === 'upstream_unavailable' || code === 'rate_limited',
  });
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export const mockApiClient: ApiClient = {
  async call<K extends EndpointName>(name: K, request: EndpointRequest<K>): Promise<EndpointResponse<K>> {
    await delay();
    switch (name) {
      case 'getSession':
        return ok({
          parentId: 'parent-demo',
          isAnonymous: true,
          linkedProviders: ['anonymous'],
          locale: 'en-GB',
          children,
          entitlement,
          quota: computeQuota(),
          generationHalted: false,
          serverTime: now(),
        }) as EndpointResponse<K>;

      case 'upsertChild': {
        const req = request as UpsertChildRequest;
        let child = children.find((c) => c.id === req.id);
        if (!child) {
          child = {
            id: nextId('child'),
            displayName: req.displayName,
            ageBand: req.ageBand,
            avatarCharacterId: null,
            createdAt: now(),
          };
          children.push(child);
        } else {
          child.displayName = req.displayName;
          child.ageBand = req.ageBand;
        }
        return ok({ child }) as EndpointResponse<K>;
      }

      case 'createUploadUrl':
        return ok({
          storageKey: `drawings/demo/${nextId('upload')}.png`,
          uploadUrl: 'https://example.invalid/mock-upload',
          token: 'mock-token',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }) as EndpointResponse<K>;

      case 'createCharacter': {
        const req = request as CreateCharacterRequest;
        const quota = computeQuota();
        if (quota.charactersUsed >= quota.charactersLimit) {
          fail('quota_exceeded', 'error.quota_exceeded.' + entitlement.tier);
        }
        const character: CharacterDto = {
          id: nextId('char'),
          childId: req.childId,
          drawingId: nextId('drawing'),
          name: req.name,
          characterType: req.characterType,
          personalityTraits: req.personalityTraits,
          palette: req.palette,
          status: 'building',
          storyCount: 0,
          primaryAsset: null,
          cutoutStorageKey: req.drawing.cutoutStorageKey,
          originalStorageKey: req.drawing.originalStorageKey,
          createdAt: now(),
          archivedAt: null,
        };
        characters.push(character);
        usage.charactersUsed += 1;
        const job = startJob({ storyId: null, characterId: character.id, type: 'character_build', pagesTotal: 0 });
        // Flip to ready shortly, mimicking the worker finishing the build.
        setTimeout(() => {
          character.status = 'ready';
          character.primaryAsset = {
            id: nextId('asset'),
            kind: 'cutout',
            storageKey: character.cutoutStorageKey,
            isPrimary: true,
            version: 1,
            widthPx: req.drawing.widthPx,
            heightPx: req.drawing.heightPx,
          };
        }, 3200);
        return ok({
          character,
          job: jobToDto(job),
          quota: computeQuota(),
        }) as EndpointResponse<K>;
      }

      case 'listCharacters':
        return ok({ characters: characters.filter((c) => c.status !== 'archived') }) as EndpointResponse<K>;

      case 'getCharacter': {
        const req = request as { id: string };
        const character = characters.find((c) => c.id === req.id);
        if (!character) fail('not_found', 'error.not_found');
        return ok({
          character,
          assets: character.primaryAsset ? [character.primaryAsset] : [],
          stories: stories.filter((s) => s.characters.some((c) => c.characterId === character.id)),
        }) as EndpointResponse<K>;
      }

      case 'updateCharacter': {
        const req = request as { id: string; name?: string; characterType?: string | null; personalityTraits?: string[] };
        const character = characters.find((c) => c.id === req.id);
        if (!character) fail('not_found', 'error.not_found');
        if (req.name) character.name = req.name;
        if (req.characterType !== undefined) character.characterType = req.characterType;
        if (req.personalityTraits) character.personalityTraits = req.personalityTraits;
        return ok({ character }) as EndpointResponse<K>;
      }

      case 'deleteCharacter': {
        const req = request as { id: string };
        const character = characters.find((c) => c.id === req.id);
        if (character) character.status = 'archived';
        return ok({}) as EndpointResponse<K>;
      }

      case 'getTraitSuggestions': {
        const req = request as { id: string };
        return ok({
          characterId: req.id,
          suggestedType: 'Purple monster',
          suggestedTraits: ['Funny and brave'],
          ready: true,
        }) as EndpointResponse<K>;
      }

      case 'createStory': {
        const req = request as CreateStoryRequest;
        const quota = computeQuota();
        if (quota.storiesRemaining <= 0 && quota.topupStoriesRemaining <= 0) {
          fail('quota_exceeded', 'error.quota_exceeded.' + entitlement.tier);
        }
        const shape = STORY_SHAPE[req.length];
        const lead = characters.find((c) => c.id === req.characters[0]?.characterId);
        const story: StoryDetailDto = {
          id: nextId('story'),
          title: null,
          theme: req.theme,
          mood: req.mood,
          length: req.length,
          status: 'queued',
          cover: null,
          characterNames: lead ? [lead.name] : [],
          characterTombstone: false,
          pageCount: shape.pageCount,
          createdAt: now(),
          favouritedAt: null,
          characters: req.characters.map((c, i) => ({
            characterId: c.characterId,
            role: c.role ?? 'lead',
            orderIndex: i,
            name: characters.find((ch) => ch.id === c.characterId)?.name ?? 'Character',
          })),
          pages: Array.from({ length: shape.pageCount }, (_, i) => ({
            id: nextId('page'),
            index: i + 1,
            text: '',
            status: 'pending' as const,
            regenCount: 0,
            illustration: null,
          })),
          narration: null,
          activeJob: null,
          renderTechnique: 'cutout_rerender',
          modelBundleVersion: 'mock-1',
        };
        stories.unshift(story);
        usage.storiesUsed += (usage.topupStoriesRemaining > 0 && quota.storiesRemaining <= 0) ? 0 : 1;
        if (usage.topupStoriesRemaining > 0 && quota.storiesRemaining <= 0) usage.topupStoriesRemaining -= 1;
        usage.costCentsAccrued += shape.estimatedCostCents;

        const job = startJob({
          storyId: story.id,
          characterId: null,
          type: 'story_generate',
          pagesTotal: shape.pageCount,
        });
        story.activeJob = { id: job.id, status: 'running', stage: 'queued', pagesCompleted: 0, pagesTotal: shape.pageCount };

        // Simulate completion: title + cover + pages fill in over time.
        const leadName = lead?.name ?? 'Your character';
        setTimeout(() => {
          story.title = `${leadName} and the Missing Moon`;
          story.status = 'partial';
          story.cover = {
            id: nextId('illus'),
            pageIndex: 0,
            storageKey: 'illustrations/demo/generated/cover.png',
            width: 1024,
            height: 1280,
          };
        }, 3000);
        setTimeout(() => {
          story.pages = buildReadyPages(shape.pageCount, leadName);
          story.status = 'ready';
          story.narration = {
            id: nextId('narr'),
            storageKey: 'narration/demo/generated/audio.m4a',
            wordTimingsKey: null,
            sentenceLevelOnly: true,
            durationMs: shape.pageCount * 15_000,
            voiceId: 'papercub_default',
            language: 'en',
          };
          story.activeJob = null;
        }, GENERATION_STAGE_ORDER.length * 900 + shape.pageCount * 900 + 500);

        return ok({ story, job: jobToDto(job), quota: computeQuota() }) as EndpointResponse<K>;
      }

      case 'listStories': {
        const req = request as { favouritesOnly?: boolean };
        const list: StorySummaryDto[] = stories
          .filter((s) => !req.favouritesOnly || s.favouritedAt)
          .map(({ pages: _pages, characters: _characters, narration: _narration, activeJob: _activeJob, renderTechnique: _rt, modelBundleVersion: _mbv, ...summary }) => summary);
        return ok({ stories: list, nextCursor: null }) as EndpointResponse<K>;
      }

      case 'getStory': {
        const req = request as { id: string };
        const story = stories.find((s) => s.id === req.id);
        if (!story) fail('not_found', 'error.not_found');
        return ok({ story }) as EndpointResponse<K>;
      }

      case 'setStoryFavourite': {
        const req = request as { id: string; favourited: boolean };
        const story = stories.find((s) => s.id === req.id);
        if (story) story.favouritedAt = req.favourited ? now() : null;
        return ok({}) as EndpointResponse<K>;
      }

      case 'deleteStory': {
        const req = request as { id: string };
        const idx = stories.findIndex((s) => s.id === req.id);
        if (idx >= 0) stories.splice(idx, 1);
        return ok({}) as EndpointResponse<K>;
      }

      case 'regeneratePage':
        fail('upstream_unavailable', 'error.upstream_unavailable');
        break;

      case 'getJob': {
        const req = request as { id: string };
        const job = jobs.get(req.id);
        if (!job) fail('not_found', 'error.not_found');
        return ok({ job: jobToDto(job) }) as EndpointResponse<K>;
      }

      case 'signMedia': {
        const req = request as { storageKeys: string[] };
        return ok({
          media: req.storageKeys.map((storageKey) => ({
            storageKey,
            url: `https://picsum.photos/seed/${encodeURIComponent(storageKey)}/800/600`,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          })),
        }) as EndpointResponse<K>;
      }

      case 'refreshEntitlement':
        return ok({ entitlement, quota: computeQuota() }) as EndpointResponse<K>;

      default:
        fail('internal', 'error.internal');
    }
    // Unreachable, but satisfies TS across the switch.
    return undefined as unknown as EndpointResponse<K>;
  },

  subscribeJob(jobId, onEvent) {
    const job = jobs.get(jobId);
    if (!job) return () => {};
    job.listeners.add(onEvent);
    // Push current state immediately so late subscribers aren't stuck.
    emitJob(job);
    return () => job.listeners.delete(onEvent);
  },
};

/** Test-only escape hatch: flips the demo account to a paid tier. */
export function __mockSetEntitlement(tier: 'free' | 'family') {
  entitlement = {
    tier,
    status: tier === 'family' ? 'active' : 'none',
    productId: tier === 'family' ? 'papercub_family_annual' : null,
    periodEnd: tier === 'family' ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null,
    renewsAt: tier === 'family' ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null,
    environment: 'sandbox',
  };
}

export function __mockExhaustFreeQuota() {
  usage.storiesUsed = QUOTA.free.storiesTotal;
}

export function __mockGrantTopup() {
  usage.topupStoriesRemaining += TOPUP_STORIES_GRANTED;
}
