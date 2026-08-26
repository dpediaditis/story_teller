/**
 * Every side effect the pipeline can have, as one narrow interface.
 *
 * This exists for a specific reason: CLAUDE.md requires regression tests on
 * "anything that costs money or leaks data", and the cost/refund rules are
 * expressed in terms of *which calls happen in what order*, not in terms of
 * rows. A port makes those assertions exact and keeps the pipeline honest —
 * the pipeline cannot reach for a supabase client it was never given.
 *
 * The real implementation is src/db.ts. The test double is src/testing/fake-db.ts.
 */

import type { z } from 'zod';
import type { RecordModerationRequest as RecordModerationRequestSchema } from '@papercub/shared';
import type {
  AgeBand,
  GenerationStage,
  JobErrorCode,
  JobProgressEvent,
  JobStatus,
  RecordCostRequest,
  RenderTechnique,
  StoryPageStatus,
  StoryStatus,
} from '@papercub/shared';

/**
 * contract.ts exports RecordModerationRequest as a zod schema but not as a TS
 * type, so it is derived here once rather than at four call sites.
 */
export type ModerationEventRecord = z.infer<typeof RecordModerationRequestSchema>;

/* ── Cost ─────────────────────────────────────────────────────────────── */

export interface RecordCostArgs {
  /** The full measured record, for the audit log. */
  request: RecordCostRequest;
  /** Integer cents to add to measured spend on this call. May be 0. */
  costCentsDelta: number;
  /**
   * Release this job's reservation back out of usage_records.cost_cents_reserved.
   * EXACTLY ONE call per job may set this, and only when refund_story_quota did
   * not already release it — the two paths both decrement the same shared
   * counter, so doing both frees a *different* concurrent job's reservation.
   */
  final: boolean;
}

/* ── Story writes ─────────────────────────────────────────────────────── */

export interface StoryPageRow {
  index: number;
  text: string;
  /** Internal image prompt. NEVER returned to a client. */
  sceneDescription: string;
  status: StoryPageStatus;
}

export interface IllustrationRow {
  storyId: string;
  /** 0 is the cover. */
  pageIndex: number;
  storageKey: string;
  width: number;
  height: number;
  modelId: string;
  seed: number | null;
  referenceAssetIds: string[];
  costCents: number;
}

export interface NarrationRow {
  storyId: string;
  voiceId: string;
  provider: string;
  storageKey: string;
  durationMs: number;
  wordTimingsKey: string | null;
  sentenceLevelOnly: boolean;
  language: string;
}

export interface JobPatch {
  status?: JobStatus;
  stage?: GenerationStage;
  pagesCompleted?: number;
  pagesTotal?: number;
  errorCode?: JobErrorCode | null;
  startedAt?: string;
  finishedAt?: string;
  attempts?: number;
  latencyMs?: number;
}

/**
 * A story as the regeneration and narration pipelines need to read it back.
 * Note what is absent: anything identifying the child. `ageBand` is the only
 * age representation that exists anywhere (DECISIONS.md §10).
 */
export interface StoryRecord {
  id: string;
  childId: string;
  ageBand: AgeBand;
  locale: string;
  renderTechnique: RenderTechnique;
  characterIds: string[];
  pages: {
    index: number;
    text: string;
    /** Internal image prompt. Never leaves the worker. */
    sceneDescription: string;
    regenCount: number;
  }[];
}

/** The character data the pipeline needs. Note what is absent: the child's name. */
export interface CharacterRecord {
  id: string;
  /** User free text. Re-validated through asUntrustedText before any prompt. */
  name: string;
  characterType: string | null;
  personalityTraits: string[];
  palette: string[];
  featureAnchor: string | null;
  cutoutStorageKey: string;
  /** character_assets rows usable as image references. */
  referenceAssets: { id: string; storageKey: string; kind: string }[];
}

export interface WorkerDb {
  /* Cost. */
  recordCost(args: RecordCostArgs): Promise<void>;
  /** Idempotent — guarded by generation_jobs.quota_refunded in SQL. */
  refundStoryQuota(jobId: string): Promise<{ refunded: boolean; alreadyRefunded: boolean }>;
  /** Measured spend across ALL accounts for today (UTC). DECISIONS.md §3.3. */
  globalSpendTodayCents(): Promise<number>;

  /* Moderation. */
  recordModeration(req: ModerationEventRecord): Promise<void>;

  /* Jobs + progress. */
  updateJob(jobId: string, patch: JobPatch): Promise<void>;
  emitProgress(event: JobProgressEvent): Promise<void>;

  /* Reads. */
  loadCharacters(characterIds: string[]): Promise<CharacterRecord[]>;
  loadStory(storyId: string): Promise<StoryRecord>;
  downloadObject(storageKey: string): Promise<Uint8Array>;

  /* Writes. */
  uploadObject(storageKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  setStoryStatus(
    storyId: string,
    status: StoryStatus,
    extra?: { title?: string; completedAt?: string; coverAssetId?: string },
  ): Promise<void>;
  insertStoryPages(storyId: string, pages: StoryPageRow[]): Promise<void>;
  setStoryPageStatus(storyId: string, index: number, status: StoryPageStatus): Promise<void>;
  insertIllustration(row: IllustrationRow): Promise<string>;
  linkPageIllustration(storyId: string, pageIndex: number, illustrationId: string): Promise<void>;
  insertNarration(row: NarrationRow): Promise<void>;
  incrementPageRegenCount(storyId: string, pageIndex: number): Promise<number>;
  replaceIllustration(row: IllustrationRow): Promise<string>;

  /**
   * Has this job already reached a terminal state? pgmq is at-least-once, so a
   * job slower than the visibility timeout is redelivered WHILE IT IS STILL
   * RUNNING and a second worker starts it from the top. Observed live on a
   * character_build: read_ct went 1 -> 2, the stage went backwards from
   * `building_character_refs` to `analysing_drawing`, and every provider call
   * was paid for twice.
   */
  isJobFinished(jobId: string): Promise<boolean>;

  /* Character build. */
  updateCharacterFromAnalysis(
    characterId: string,
    patch: { featureAnchor: string; palette: string[]; status: 'ready' | 'failed' },
  ): Promise<void>;
  /**
   * A terminal failure marks the character `failed`. The character slot is a
   * live COUNT of characters that are neither archived nor failed, so this is
   * what gives the slot back — on the free tier, where the limit is one
   * character ever, a build that failed and stayed `building` locked the user
   * out permanently with nothing to show for it.
   */
  setCharacterStatus(characterId: string, status: 'failed'): Promise<void>;
  insertCharacterAsset(row: {
    characterId: string;
    kind: string;
    storageKey: string;
    modelId: string | null;
    promptHash: string | null;
    isPrimary: boolean;
    widthPx: number;
    heightPx: number;
  }): Promise<void>;
}

/* ── Queue ────────────────────────────────────────────────────────────── */

export interface QueueMessage {
  msgId: number;
  /** pgmq's read counter. 1 on first delivery. Drives the DLQ threshold. */
  readCt: number;
  message: unknown;
}

export interface WorkerQueue {
  read(visibilityTimeoutSeconds: number, batchSize: number): Promise<QueueMessage[]>;
  delete(msgId: number): Promise<void>;
  /** Move to papercub_generation_dlq and delete from the main queue. */
  moveToDlq(msg: QueueMessage): Promise<void>;
}
