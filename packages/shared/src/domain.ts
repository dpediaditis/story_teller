/**
 * Entity types for the data model. These mirror the Postgres tables 1:1 in
 * camelCase. B1 owns the SQL; this file owns the shape the SQL must produce.
 * Where they disagree, this file is the specification and the migration is the bug.
 *
 * CONVENTIONS
 *  - `Id` types are branded so a characterId cannot be passed where a storyId goes.
 *  - Timestamps are ISO-8601 strings (`timestamptz` in Postgres), never Date.
 *  - `null` means "known to be absent". `undefined` never crosses a boundary.
 *  - Soft delete = `deletedAt`/`archivedAt` is non-null. Queries must filter.
 */

import type {
  AgeBand, AuthProvider, CharacterAssetKind, CharacterStatus, DrawingSource,
  EntitlementTier, GenerationStage, IsolationMethod, JobStatus, JobType,
  ModerationAction, ModerationStage, ModerationSubjectType, ModerationVerdict,
  ProductId, RenderTechnique, RetentionPolicy, StoreEnvironment,
  StoryCharacterRole, StoryPageStatus, StoryStatus, StoryTheme, StoryMood,
  StoryLength, SubscriptionStatus,
} from './enums.ts';
import type { ChildDisplayName } from './prompt-safety.ts';
import type { JobErrorCode } from './errors.ts';
import type { StorageKey } from './storage.ts';

/* ── Branded ids ───────────────────────────────────────────────────────── */

declare const ID_BRAND: unique symbol;
type Id<T extends string> = string & { readonly [ID_BRAND]: T };

export type ParentAccountId = Id<'parent_account'>;
export type ChildProfileId = Id<'child_profile'>;
export type OriginalDrawingId = Id<'original_drawing'>;
export type CharacterId = Id<'character'>;
export type CharacterAssetId = Id<'character_asset'>;
export type StoryId = Id<'story'>;
export type StoryPageId = Id<'story_page'>;
export type PageIllustrationId = Id<'page_illustration'>;
export type NarrationId = Id<'narration'>;
export type GenerationJobId = Id<'generation_job'>;
export type SubscriptionId = Id<'subscription'>;
export type UsageRecordId = Id<'usage_record'>;
export type ModerationEventId = Id<'moderation_event'>;
export type WorldId = Id<'world'>;
export type WorldFactId = Id<'world_fact'>;
export type PlaceId = Id<'place'>;

/** `auth.users.id`. Every RLS policy is scoped to this. */
export type AuthUserId = Id<'auth_user'>;

export type IsoDateTime = string;

/* ── ParentAccount ─────────────────────────────────────────────────────── */

/**
 * The only identity. `id` IS `auth.users.id` — there is no surrogate key, which
 * is what makes every RLS policy a plain `id = auth.uid()` or
 * `parent_id = auth.uid()`.
 *
 * DEVIATION: the plan listed `apple_user_id`. Under Supabase Auth that is
 * redundant (identities live in `auth.identities`) and would duplicate a
 * provider subject id into a client-readable table. Omitted; `linkedProviders`
 * is derived at read time. See docs/ARCHITECTURE.md.
 */
export interface ParentAccount {
  id: ParentAccountId & AuthUserId;
  /** SHA-256 of the lowercased email. Set only if the parent opts into receipts. */
  emailHash: string | null;
  locale: string;
  /** True while the session is anonymous. Flipped by the merge/link flow. */
  isAnonymous: boolean;
  /** Providers currently linked. Anonymous accounts hold exactly ['anonymous']. */
  linkedProviders: AuthProvider[];
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/* ── ChildProfile ──────────────────────────────────────────────────────── */

/**
 * NO BIRTH DATE. Not now, not as a nullable column, not "for later".
 * `displayName` is branded and must never reach a prompt (prompt-safety.ts).
 */
export interface ChildProfile {
  id: ChildProfileId;
  parentId: ParentAccountId;
  /** May be a nickname. Rendered in our UI only. */
  displayName: ChildDisplayName | null;
  ageBand: AgeBand;
  avatarCharacterId: CharacterId | null;
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/* ── OriginalDrawing ───────────────────────────────────────────────────── */

/**
 * DEVIATION: the plan listed a single `storage_key`, but the cut-out and the
 * full photo have different retention rules (DECISIONS.md §10 — upload the
 * cut-out by default, the full photo only on opt-in). One column cannot express
 * that, so they are split.
 */
export interface OriginalDrawing {
  id: OriginalDrawingId;
  childId: ChildProfileId;
  /** The full photo. Present only when retentionPolicy === 'keep_original'. */
  storageKey: StorageKey | null;
  /** The isolated cut-out (PNG with alpha). Always present. */
  cutoutStorageKey: StorageKey;
  capturedAt: IsoDateTime;
  source: DrawingSource;
  retentionPolicy: RetentionPolicy;
  /** Must be true before any upload. Enforced on-device. */
  exifStripped: boolean;
  isolationMethod: IsolationMethod;
  /** 0..1 from the Vision mask. Below threshold routes to manual repair. */
  isolationConfidence: number;
  /** On-device pre-upload checks. DECISIONS.md §10. */
  faceDetected: boolean;
  textDetected: boolean;
  widthPx: number;
  heightPx: number;
  createdAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/* ── Character ─────────────────────────────────────────────────────────── */

export interface Character {
  id: CharacterId;
  childId: ChildProfileId;
  drawingId: OriginalDrawingId;
  /** User free text. Required. Treat as UntrustedText at every prompt boundary. */
  name: string;
  /** Model-suggested, parent-approved. */
  characterType: string | null;
  /** Parent-approved strings, never raw model output. */
  personalityTraits: string[];
  /** Hex colours extracted on-device from the cut-out. */
  palette: string[];
  /** Textual feature anchor from the vision pass. Injected into every image prompt. */
  featureAnchor: string | null;
  status: CharacterStatus;
  createdAt: IsoDateTime;
  archivedAt: IsoDateTime | null;
}

/**
 * The consistency backbone. Built once at character creation and reused for
 * every story forever — which is why the marginal cost of a second story with
 * an existing character is lower than the first. Versioned so improving the
 * pipeline does not break old stories.
 */
export interface CharacterAsset {
  id: CharacterAssetId;
  characterId: CharacterId;
  kind: CharacterAssetKind;
  storageKey: StorageKey;
  modelId: string | null;
  /** SHA-256 of the exact prompt used. Cache key + reproducibility. */
  promptHash: string | null;
  /** Which reference-set generation produced this. Bumped when the pipeline changes. */
  version: number;
  isPrimary: boolean;
  widthPx: number;
  heightPx: number;
  createdAt: IsoDateTime;
}

/* ── Story ─────────────────────────────────────────────────────────────── */

export interface Story {
  id: StoryId;
  childId: ChildProfileId;
  title: string | null;
  theme: StoryTheme;
  mood: StoryMood;
  length: StoryLength;
  status: StoryStatus;
  /** The cover lives in page_illustrations with pageIndex 0. */
  coverAssetId: PageIllustrationId | null;
  /** Per-story so Milestone 0 can switch technique without a migration. */
  renderTechnique: RenderTechnique;
  /** Pins the model set that produced it. Essential for explaining an old story. */
  modelBundleVersion: string;
  /** The starring character was deleted. Story survives and stays readable. */
  characterTombstone: boolean;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  favouritedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}

/**
 * MANY-TO-MANY FROM DAY ONE. Even with a one-character MVP this is a real join
 * table — retrofitting it later means migrating every story.
 *
 * MVP writes exactly one row, role 'lead', orderIndex 0. Every read path must
 * nonetheless treat this as a list. `story.characters[0]` is acceptable at the
 * UI layer; a `stories.character_id` COLUMN is not, and will be rejected.
 */
export interface StoryCharacter {
  storyId: StoryId;
  characterId: CharacterId;
  role: StoryCharacterRole;
  orderIndex: number;
}

export interface StoryPage {
  id: StoryPageId;
  storyId: StoryId;
  /** 1-based. Index 0 is the cover and is NOT a StoryPage row. */
  index: number;
  text: string;
  /**
   * The internal image prompt. Self-contained — no pronoun references to other
   * pages, because each image is generated independently. NEVER shown to users
   * and never returned by any client-facing endpoint.
   */
  sceneDescription: string;
  illustrationAssetId: PageIllustrationId | null;
  status: StoryPageStatus;
  regenCount: number;
  createdAt: IsoDateTime;
}

export interface PageIllustration {
  id: PageIllustrationId;
  storyId: StoryId;
  /** 0 = cover. */
  pageIndex: number;
  storageKey: StorageKey;
  width: number;
  height: number;
  modelId: string;
  seed: number | null;
  /** Recording the reference set per image is what makes consistency debuggable. */
  referenceAssetIds: CharacterAssetId[];
  moderationVerdict: ModerationVerdict;
  costCents: number;
  createdAt: IsoDateTime;
}

export interface Narration {
  id: NarrationId;
  storyId: StoryId;
  voiceId: string;
  provider: string;
  storageKey: StorageKey;
  durationMs: number;
  /** Separate JSON blob of word/sentence timings, for highlighting. */
  wordTimingsKey: StorageKey | null;
  /** Fell back to sentence-level timing. Sufficient for a 5-year-old. */
  sentenceLevelOnly: boolean;
  language: string;
  createdAt: IsoDateTime;
}

/* ── Operations ────────────────────────────────────────────────────────── */

/**
 * One row per pipeline run. This table is the cost accounting, the SLO
 * monitoring and the refund logic. It is NOT a temporary queue record — pgmq
 * holds the transient message, this holds the durable record.
 */
export interface GenerationJob {
  id: GenerationJobId;
  /** Denormalised owner, so RLS is a single predicate and the worker can bill. */
  parentId: ParentAccountId;
  storyId: StoryId | null;
  characterId: CharacterId | null;
  type: JobType;
  status: JobStatus;
  stage: GenerationStage;
  /** For the client's honest stage list. */
  pagesCompleted: number;
  pagesTotal: number;
  attempts: number;
  /** MEASURED, accumulated as stages complete. Drives the cost ceiling. */
  costCents: number;
  /** Pre-flight estimate, reserved at enqueue and reconciled at completion. */
  estimatedCostCents: number;
  latencyMs: number | null;
  errorCode: JobErrorCode | null;
  /** True once the story quota has been given back. Idempotency guard. */
  quotaRefunded: boolean;
  idempotencyKey: string;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
}

/**
 * Derived from RevenueCat webhooks, themselves derived from App Store Server
 * Notifications V2. THE SERVER IS AUTHORITATIVE; the client never decides
 * entitlement. DECISIONS.md §8.
 */
export interface Subscription {
  id: SubscriptionId;
  parentId: ParentAccountId;
  productId: ProductId | null;
  tier: EntitlementTier;
  status: SubscriptionStatus;
  renewsAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  originalTransactionId: string | null;
  revenuecatAppUserId: string | null;
  environment: StoreEnvironment;
  /** Non-expiring top-up stories bought via papercub_topup_3. */
  topupStoriesRemaining: number;
  updatedAt: IsoDateTime;
}

/**
 * One row per billing period. Enforced server-side before ANY job is enqueued.
 * For free accounts there is exactly one row, `periodEnd` is null, and it never
 * rolls over — the free tier does not renew.
 */
export interface UsageRecord {
  id: UsageRecordId;
  parentId: ParentAccountId;
  periodStart: IsoDateTime;
  /** null on the free tier: the period never ends. */
  periodEnd: IsoDateTime | null;
  storiesUsed: number;
  charactersUsed: number;
  regensUsed: number;
  /** MEASURED spend. The cost ceiling is checked against this. */
  costCentsAccrued: number;
  /** Reserved-but-not-yet-settled cost of in-flight jobs. */
  costCentsReserved: number;
  updatedAt: IsoDateTime;
}

/** Append-only audit trail. The answer to App Review's safety question. */
export interface ModerationEvent {
  id: ModerationEventId;
  parentId: ParentAccountId;
  subjectType: ModerationSubjectType;
  subjectId: string;
  stage: ModerationStage;
  verdict: ModerationVerdict;
  categories: string[];
  actionTaken: ModerationAction;
  provider: string;
  rawScore: number | null;
  createdAt: IsoDateTime;
}

/* ── v1.2 — DECLARED, UNUSED ──────────────────────────────────────────────
 * These exist so My World can be added without a migration. B1 creates the
 * tables AND their RLS policies. Nothing in MVP reads or writes them, and no
 * endpoint in contract.ts exposes them. Do not "helpfully" wire them up.
 */

export interface World {
  id: WorldId;
  childId: ChildProfileId;
  name: string;
  createdAt: IsoDateTime;
}

export interface WorldFact {
  id: WorldFactId;
  worldId: WorldId;
  subjectType: 'character' | 'place' | 'world';
  subjectId: string;
  /** e.g. "Bobo is afraid of the dark." Text, not images — cheap. */
  factText: string;
  sourceStoryId: StoryId | null;
  confidence: number;
  supersededBy: WorldFactId | null;
  createdAt: IsoDateTime;
}

export interface Place {
  id: PlaceId;
  worldId: WorldId;
  name: string;
  description: string;
  firstStoryId: StoryId | null;
  styleRefAssetId: CharacterAssetId | null;
  createdAt: IsoDateTime;
}

/* ── Read models (what endpoints actually return) ──────────────────────── */

export interface CharacterWithAssets extends Character {
  primaryAsset: CharacterAsset | null;
  drawing: Pick<OriginalDrawing, 'id' | 'cutoutStorageKey' | 'storageKey' | 'capturedAt'>;
  storyCount: number;
}

/** `sceneDescription` is intentionally omitted — it never crosses the wire. */
export type StoryPagePublic = Omit<StoryPage, 'sceneDescription'> & {
  illustration: PageIllustration | null;
};

export interface StoryWithPages extends Story {
  characters: Array<StoryCharacter & { character: Character }>;
  pages: StoryPagePublic[];
  cover: PageIllustration | null;
  narration: Narration | null;
  activeJob: Pick<GenerationJob, 'id' | 'status' | 'stage' | 'pagesCompleted' | 'pagesTotal'> | null;
}
