/**
 * Test doubles. FAKE PROVIDERS ONLY — nothing here reaches the network, and the
 * test suite must be runnable with no API keys configured at all.
 *
 * The fake DB records every call in order, because the cost invariants are
 * statements about ordering and multiplicity ("the reservation is released
 * exactly once", "the refund happens after the error code is written"), and
 * those are only assertable if the calls are observable.
 */

import type {
  DrawingAnalysis,
  GeneratedStory,
  JobProgressEvent,
  StoryPageStatus,
  StoryStatus,
} from '@papercub/shared';
import type { ContentModerator, ModerationOutcome } from '../moderation';
import type {
  CharacterRecord,
  IllustrationRow,
  JobPatch,
  ModerationEventRecord,
  NarrationRow,
  RecordCostArgs,
  StoryPageRow,
  StoryRecord,
  WorkerDb,
} from '../ports';
import type {
  ImageGenerator,
  ProviderBundle,
  ProviderUsage,
  SpeechSynthesizer,
  TextGenerator,
  VisionAnalyzer,
} from '../providers/types';

/* ── Fake database ────────────────────────────────────────────────────── */

export interface FakeDbState {
  costCalls: RecordCostArgs[];
  refundCalls: string[];
  moderationEvents: ModerationEventRecord[];
  jobPatches: { jobId: string; patch: JobPatch }[];
  progressEvents: JobProgressEvent[];
  storyStatuses: { storyId: string; status: StoryStatus }[];
  pages: StoryPageRow[];
  illustrations: IllustrationRow[];
  narrations: NarrationRow[];
  uploads: { key: string; bytes: number }[];
  pageStatuses: { index: number; status: StoryPageStatus }[];
  /** Characters marked failed, so a test can assert the slot was given back. */
  failedCharacters: string[];
}

export interface FakeDbOptions {
  characters?: CharacterRecord[];
  story?: StoryRecord;
  globalSpendTodayCents?: number;
  /** Simulates a job already refunded by a previous attempt. */
  alreadyRefunded?: boolean;
}

export interface FakeDb extends WorkerDb {
  state: FakeDbState;
  /** Total integer cents written across all record_cost calls. */
  totalRecordedCents(): number;
  /** How many calls released the reservation. MUST never exceed 1. */
  finalCallCount(): number;
}

export function createFakeDb(opts: FakeDbOptions = {}): FakeDb {
  const state: FakeDbState = {
    costCalls: [],
    refundCalls: [],
    moderationEvents: [],
    jobPatches: [],
    progressEvents: [],
    storyStatuses: [],
    pages: [],
    illustrations: [],
    narrations: [],
    uploads: [],
    pageStatuses: [],
    failedCharacters: [],
  };

  let refunded = opts.alreadyRefunded ?? false;
  let illustrationSeq = 0;

  return {
    state,

    totalRecordedCents() {
      return state.costCalls.reduce((sum, c) => sum + c.costCentsDelta, 0);
    },

    finalCallCount() {
      return state.costCalls.filter((c) => c.final).length;
    },

    async recordCost(args) {
      state.costCalls.push(args);
    },

    async refundStoryQuota(jobId) {
      state.refundCalls.push(jobId);
      // Mirrors the SQL: guarded by generation_jobs.quota_refunded, so the
      // second call is a no-op and does NOT release the reservation again.
      if (refunded) return { refunded: false, alreadyRefunded: true };
      refunded = true;
      return { refunded: true, alreadyRefunded: false };
    },

    async globalSpendTodayCents() {
      return opts.globalSpendTodayCents ?? 0;
    },

    async recordModeration(req) {
      state.moderationEvents.push(req);
    },

    async updateJob(jobId, patch) {
      state.jobPatches.push({ jobId, patch });
    },

    async emitProgress(event) {
      state.progressEvents.push(event);
    },

    async isJobFinished() {
      return false;
    },

    async loadCharacters() {
      return opts.characters ?? [];
    },

    async loadStory() {
      if (!opts.story) throw new Error('fake db: no story configured');
      return opts.story;
    },

    async downloadObject() {
      return new Uint8Array([1, 2, 3]);
    },

    async uploadObject(key, bytes) {
      state.uploads.push({ key, bytes: bytes.length });
    },

    async setStoryStatus(storyId, status) {
      state.storyStatuses.push({ storyId, status });
    },

    async insertStoryPages(_storyId, pages) {
      state.pages.push(...pages);
    },

    async setStoryPageStatus(_storyId, index, status) {
      state.pageStatuses.push({ index, status });
    },

    async insertIllustration(row) {
      state.illustrations.push(row);
      illustrationSeq += 1;
      return `illustration-${illustrationSeq}`;
    },

    async replaceIllustration(row) {
      state.illustrations.push(row);
      illustrationSeq += 1;
      return `illustration-${illustrationSeq}`;
    },

    async linkPageIllustration() {},

    async insertNarration(row) {
      state.narrations.push(row);
    },

    async incrementPageRegenCount() {
      return 1;
    },

    async updateCharacterFromAnalysis() {},
    async setCharacterStatus(characterId) {
      state.failedCharacters.push(characterId);
    },

    async insertCharacterAsset() {},
  };
}

/* ── Fake providers ───────────────────────────────────────────────────── */

export function usage(costCents: number, modelId = 'fake-model'): ProviderUsage {
  return {
    costCents,
    inputTokens: 100,
    outputTokens: 200,
    imageCount: 0,
    latencyMs: 5,
    modelId,
    provider: 'fake',
  };
}

export interface FakeProviderOptions {
  storyCostCents?: number;
  coverCostCents?: number;
  pageCostCents?: number;
  speechCostCents?: number;
  visionCostCents?: number;
  pageCount?: number;
  /** Throw from this many-th image call (1-based), to simulate a mid-run crash. */
  failImageCallNumber?: number;
  failImageWith?: Error;
  storyOverride?: Partial<GeneratedStory>;
}

export interface FakeProviders extends ProviderBundle {
  calls: { kind: string; tier?: string }[];
}

const SIMPLE_PAGE_TEXT =
  'Bobo found a small blue door. It was warm and open. Bobo went inside and smiled.';

export function createFakeProviders(opts: FakeProviderOptions = {}): FakeProviders {
  const calls: { kind: string; tier?: string }[] = [];
  const pageCount = opts.pageCount ?? 6;
  let imageCalls = 0;

  const text: TextGenerator = {
    async generateStory() {
      calls.push({ kind: 'text' });
      const value: GeneratedStory = {
        title: 'Bobo and the Blue Door',
        pages: Array.from({ length: pageCount }, (_, i) => ({
          index: i + 1,
          text: SIMPLE_PAGE_TEXT,
          sceneDescription:
            'A small round creature stands beside a bright blue door in a sunny meadow.',
        })),
        coverSceneDescription:
          'A small round creature smiles beside a bright blue door under a wide sky.',
        ...opts.storyOverride,
      };
      return { value, usage: usage(opts.storyCostCents ?? 0.8, 'fake-text') };
    },
  };

  const vision: VisionAnalyzer = {
    async analyseDrawing() {
      calls.push({ kind: 'vision' });
      const value: DrawingAnalysis = {
        subjectGuess: 'a round friendly creature',
        dominantColours: ['#33aaff', '#ffcc00'],
        distinguishingFeatures: ['three horns', 'one big eye'],
        medium: 'crayon',
        lineQuality: 'bold',
        suggestedTraits: ['brave'],
        suggestedType: 'monster',
      };
      return { value, usage: usage(opts.visionCostCents ?? 1.2, 'fake-vision') };
    },
  };

  const image: ImageGenerator = {
    async generateIllustration({ tier }) {
      imageCalls += 1;
      calls.push({ kind: 'image', tier });

      if (opts.failImageCallNumber === imageCalls) {
        // Thrown AFTER the call is counted but BEFORE usage is returned, which
        // is the realistic shape: the provider was invoked, we may or may not
        // have been billed, and we cannot record what we were not told.
        throw opts.failImageWith ?? new Error('fake image provider exploded');
      }

      const cost = tier === 'premium' ? (opts.coverCostCents ?? 3.9) : (opts.pageCostCents ?? 2.1);
      return {
        value: {
          imageBytes: new Uint8Array([9, 9, 9]),
          seed: 4242,
          // A real adapter reads this off the bytes; the fake states it, so a
          // pipeline test still exercises the columns it writes.
          meta: { mimeType: 'image/png', ext: 'png', width: 1024, height: 768 },
        },
        usage: { ...usage(cost, `fake-image-${tier}`), imageCount: 1 },
      };
    },
  };

  const speech: SpeechSynthesizer = {
    async synthesise() {
      calls.push({ kind: 'speech' });
      return {
        value: { audioBytes: new Uint8Array([7, 7]), durationMs: 30_000, mimeType: 'audio/wav' },
        usage: usage(opts.speechCostCents ?? 0.5, 'fake-tts'),
      };
    },
  };

  return { version: 'test-bundle', vision, text, image, speech, calls };
}

/* ── Fake moderator ───────────────────────────────────────────────────── */

export interface FakeModeratorOptions {
  imageVerdict?: ModerationOutcome['verdict'];
  textVerdict?: ModerationOutcome['verdict'];
  /** Block only on this many-th image check (1-based). */
  blockImageCallNumber?: number;
  costCents?: number;
}

export function createFakeModerator(opts: FakeModeratorOptions = {}): ContentModerator {
  let imageCalls = 0;
  const cost = opts.costCents ?? 0;

  const withUsage = (outcome: Omit<ModerationOutcome, 'usage'>): ModerationOutcome =>
    cost > 0 ? { ...outcome, usage: usage(cost, 'fake-moderator') } : outcome;

  return {
    async moderateImage() {
      imageCalls += 1;
      const blocked = opts.blockImageCallNumber === imageCalls;
      return withUsage({
        verdict: blocked ? 'block' : (opts.imageVerdict ?? 'pass'),
        categories: blocked ? ['test_block'] : [],
        rawScore: 0.01,
        provider: 'fake',
      });
    },
    async moderateText() {
      return withUsage({
        verdict: opts.textVerdict ?? 'pass',
        categories: [],
        rawScore: 0.01,
        provider: 'fake',
      });
    },
  };
}

/* ── Fixtures ─────────────────────────────────────────────────────────── */

export function fakeCharacter(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Bobo',
    characterType: 'monster',
    personalityTraits: ['brave', 'silly'],
    palette: ['#33aaff'],
    featureAnchor: 'three horns, one big eye',
    cutoutStorageKey: 'drawings/parent/char/cutout.png',
    referenceAssets: [
      { id: 'asset-1', storageKey: 'character-assets/parent/char/ref.png', kind: 'reference_sheet' },
    ],
    ...overrides,
  };
}
