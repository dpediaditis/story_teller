/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE API CONTRACT. Single source of truth for every boundary in Papercub.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Consumed by:
 *    apps/mobile        — request construction + response parsing
 *    supabase/functions — request validation (ALWAYS re-validate server-side)
 *    services/worker    — job payload validation + progress events
 *
 *  RULES
 *   1. Every Edge Function validates its request with the schema named here.
 *      A handler that trusts an unparsed body is a review failure.
 *   2. Adding a field: make it optional, ship the server, then the client.
 *      Removing a field: remove the client use, ship, then remove here.
 *   3. Nothing in this file may reference a child's display name.
 *   4. Route paths are function names. Edge Functions are invoked as
 *      `POST {SUPABASE_URL}/functions/v1/{name}`; sub-paths route inside.
 */

import { z } from 'zod';
import { DEFAULT_NARRATION_VOICE_ID, NarrationVoiceId } from './voices.ts';
import { DEFAULT_STORY_LOCALE, StoryLocale } from './languages.ts';
import {
  AgeBand, AuthProvider, CharacterAssetKind, CharacterStatus, DrawingSource,
  EntitlementTier, GenerationStage, IsolationMethod, JobStatus, JobType,
  MergeStrategy, ModerationAction, ModerationStage, ModerationSubjectType,
  ModerationVerdict, ProductId, QuotaBlockReason, RenderTechnique,
  RetentionPolicy, StoreEnvironment, StoryCharacterRole, StoryLength,
  StoryMood, StoryPageStatus, StoryStatus, StoryTheme, SubscriptionStatus,
} from './enums.ts';
import { ApiError, JobErrorCode } from './errors.ts';

/** Re-exported so agents can `import { StoryTheme } from '@papercub/shared'`. */
export {
  AgeBand, AuthProvider, CharacterAssetKind, CharacterStatus, DrawingSource,
  EntitlementTier, GenerationStage, IsolationMethod, JobStatus, JobType,
  MergeStrategy, ModerationAction, ModerationStage, ModerationSubjectType,
  ModerationVerdict, ProductId, QuotaBlockReason, RenderTechnique,
  RetentionPolicy, StoreEnvironment, StoryCharacterRole, StoryLength,
  StoryMood, StoryPageStatus, StoryStatus, StoryTheme, SubscriptionStatus,
};

/* ═══ Envelopes ═══════════════════════════════════════════════════════════ */

export const Uuid = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const StorageKeySchema = z.string().min(3).max(512);

/**
 * Every Edge Function returns this shape. `ok` discriminates. HTTP status comes
 * from HTTP_STATUS_FOR_ERROR but the body is always parseable.
 */
export function apiResponse<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: ApiError }),
  ]);
}
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const EmptyResponse = z.object({});

/** Mutating endpoints accept this header: `Idempotency-Key`. */
export const IdempotencyKey = z.string().min(8).max(128);

/* ═══ Shared value objects ════════════════════════════════════════════════ */

export const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Character/trait free text. Server re-runs asUntrustedText() on this. */
export const FreeTextName = z.string().trim().min(1).max(40);

export const SignedMedia = z.object({
  storageKey: StorageKeySchema,
  url: z.string().url(),
  expiresAt: IsoDateTimeSchema,
});
export type SignedMedia = z.infer<typeof SignedMedia>;

export const EntitlementSnapshot = z.object({
  tier: EntitlementTier,
  status: SubscriptionStatus,
  productId: ProductId.nullable(),
  /**
   * null on the free tier — it never renews. Drives whether the design's
   * "Remind me on the 1st" affordance is shown. DECISIONS.md §4.
   */
  periodEnd: IsoDateTimeSchema.nullable(),
  renewsAt: IsoDateTimeSchema.nullable(),
  environment: StoreEnvironment,
});
export type EntitlementSnapshot = z.infer<typeof EntitlementSnapshot>;

export const QuotaSnapshot = z.object({
  storiesUsed: z.number().int().min(0),
  storiesLimit: z.number().int().min(0),
  storiesRemaining: z.number().int().min(0),
  topupStoriesRemaining: z.number().int().min(0),
  charactersUsed: z.number().int().min(0),
  charactersLimit: z.number().int().min(0),
  allowedLengths: z.array(StoryLength),
  /** true when the free tier's single one-off allowance is spent. */
  freeTierConsumed: z.boolean(),
  /** null for free. Rendered on the Usage screen. */
  periodEnd: IsoDateTimeSchema.nullable(),
  /** Never displayed. Present so the client can pre-disable actions honestly. */
  costCentsAccrued: z.number().int().min(0),
  costCeilingCents: z.number().int().min(0),
  blockedBy: QuotaBlockReason.nullable(),
});
export type QuotaSnapshot = z.infer<typeof QuotaSnapshot>;

/* ═══ Entity DTOs (wire shapes) ═══════════════════════════════════════════ */

export const ChildProfileDto = z.object({
  id: Uuid,
  displayName: z.string().max(40).nullable(),
  ageBand: AgeBand,
  avatarCharacterId: Uuid.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const CharacterAssetDto = z.object({
  id: Uuid,
  kind: CharacterAssetKind,
  storageKey: StorageKeySchema,
  isPrimary: z.boolean(),
  version: z.number().int(),
  widthPx: z.number().int(),
  heightPx: z.number().int(),
});

export const CharacterDto = z.object({
  id: Uuid,
  childId: Uuid,
  drawingId: Uuid,
  name: z.string(),
  characterType: z.string().nullable(),
  personalityTraits: z.array(z.string()),
  palette: z.array(HexColour),
  status: CharacterStatus,
  storyCount: z.number().int().min(0),
  primaryAsset: CharacterAssetDto.nullable(),
  cutoutStorageKey: StorageKeySchema,
  /** Only present when retentionPolicy === 'keep_original'. */
  originalStorageKey: StorageKeySchema.nullable(),
  createdAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable(),
});
export type CharacterDto = z.infer<typeof CharacterDto>;

export const PageIllustrationDto = z.object({
  id: Uuid,
  pageIndex: z.number().int().min(0),
  storageKey: StorageKeySchema,
  width: z.number().int(),
  height: z.number().int(),
});

/**
 * NOTE: `sceneDescription` is deliberately absent. It is the internal image
 * prompt and is never shown to users. Do not add it.
 */
export const StoryPageDto = z.object({
  id: Uuid,
  index: z.number().int().min(1),
  text: z.string(),
  status: StoryPageStatus,
  regenCount: z.number().int().min(0),
  illustration: PageIllustrationDto.nullable(),
});

export const NarrationDto = z.object({
  id: Uuid,
  storageKey: StorageKeySchema,
  wordTimingsKey: StorageKeySchema.nullable(),
  sentenceLevelOnly: z.boolean(),
  durationMs: z.number().int(),
  voiceId: NarrationVoiceId,
  language: StoryLocale,
});

export const StorySummaryDto = z.object({
  id: Uuid,
  title: z.string().nullable(),
  theme: StoryTheme,
  mood: StoryMood,
  length: StoryLength,
  status: StoryStatus,
  cover: PageIllustrationDto.nullable(),
  characterNames: z.array(z.string()),
  characterTombstone: z.boolean(),
  pageCount: z.number().int(),
  createdAt: IsoDateTimeSchema,
  favouritedAt: IsoDateTimeSchema.nullable(),
});
export type StorySummaryDto = z.infer<typeof StorySummaryDto>;

export const StoryDetailDto = StorySummaryDto.extend({
  characters: z.array(
    z.object({
      characterId: Uuid,
      role: StoryCharacterRole,
      orderIndex: z.number().int(),
      name: z.string(),
    }),
  ),
  pages: z.array(StoryPageDto),
  narration: NarrationDto.nullable(),
  activeJob: z
    .object({
      id: Uuid,
      status: JobStatus,
      stage: GenerationStage,
      pagesCompleted: z.number().int(),
      pagesTotal: z.number().int(),
    })
    .nullable(),
  renderTechnique: RenderTechnique,
  modelBundleVersion: z.string(),
});
export type StoryDetailDto = z.infer<typeof StoryDetailDto>;

export const JobStatusDto = z.object({
  id: Uuid,
  type: JobType,
  status: JobStatus,
  stage: GenerationStage,
  /** Copy key the client renders, e.g. `generation.stage.illustrating_pages`. */
  stageCopyKey: z.string(),
  pagesCompleted: z.number().int().min(0),
  pagesTotal: z.number().int().min(0),
  storyId: Uuid.nullable(),
  characterId: Uuid.nullable(),
  errorCode: JobErrorCode.nullable(),
  /** True when the story quota was returned. Client should refresh quota. */
  quotaRefunded: z.boolean(),
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  /** Elapsed ms. Client shows reassurance only after SLO.showSlowStateAfterMs. */
  elapsedMs: z.number().int().min(0),
});
export type JobStatusDto = z.infer<typeof JobStatusDto>;

/* ═══ 1. session / bootstrap ══════════════════════════════════════════════ */

/** One call the app makes on launch and on foreground. */
export const GetSessionResponse = z.object({
  parentId: Uuid,
  isAnonymous: z.boolean(),
  linkedProviders: z.array(AuthProvider),
  locale: z.string(),
  children: z.array(ChildProfileDto),
  entitlement: EntitlementSnapshot,
  quota: QuotaSnapshot,
  /** Global halt (DECISIONS.md §3.3). Client disables generation entry points. */
  generationHalted: z.boolean(),
  /** Server clock, so the client never trusts device time for periods. */
  serverTime: IsoDateTimeSchema,
});
export type GetSessionResponse = z.infer<typeof GetSessionResponse>;

/* ═══ 2. children ════════════════════════════════════════════════════════ */

export const UpsertChildRequest = z.object({
  id: Uuid.optional(),
  /** Optional and skippable in onboarding. NEVER sent to a provider. */
  displayName: z.string().trim().max(40).nullable(),
  ageBand: AgeBand,
});
export const UpsertChildResponse = z.object({ child: ChildProfileDto });
export const DeleteChildRequest = z.object({ id: Uuid });

/* ═══ 3. drawings — upload ═══════════════════════════════════════════════ */

/**
 * The client uploads DIRECTLY to Supabase Storage with this signed URL.
 * The cut-out is mandatory; the full photo only when the parent opted to keep
 * the original. DECISIONS.md §10.
 */
export const CreateUploadUrlRequest = z.object({
  childId: Uuid,
  contentType: z.enum(['image/png', 'image/jpeg', 'image/heic']),
  byteLength: z.number().int().positive(),
  purpose: z.enum(['cutout', 'original']),
});
export const CreateUploadUrlResponse = z.object({
  storageKey: StorageKeySchema,
  uploadUrl: z.string().url(),
  /** Supabase signed-upload token, passed to `uploadToSignedUrl`. */
  token: z.string(),
  expiresAt: IsoDateTimeSchema,
});

/* ═══ 4. characters ══════════════════════════════════════════════════════ */

/**
 * Called AFTER uploads succeed. Creates OriginalDrawing + Character and
 * enqueues a `character_build` job. Quota + cost ceiling checked HERE, before
 * enqueue.
 */
export const CreateCharacterRequest = z.object({
  childId: Uuid,
  name: FreeTextName,
  characterType: FreeTextName.nullable().default(null),
  personalityTraits: z.array(FreeTextName).max(4).default([]),
  drawing: z.object({
    cutoutStorageKey: StorageKeySchema,
    originalStorageKey: StorageKeySchema.nullable(),
    source: DrawingSource,
    retentionPolicy: RetentionPolicy,
    /** Must be true. The server rejects false — EXIF is stripped on-device. */
    exifStripped: z.literal(true),
    isolationMethod: IsolationMethod,
    isolationConfidence: z.number().min(0).max(1),
    faceDetected: z.boolean(),
    textDetected: z.boolean(),
    capturedAt: IsoDateTimeSchema,
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
  }),
  /** Extracted on-device from the cut-out. */
  palette: z.array(HexColour).max(8).default([]),
  /**
   * Client-generated, stable across retries of the same user intent — exactly
   * as CreateStoryRequest. DECISIONS.md §15 finding 11: this field did not
   * exist, so `createCharacter` had nothing to honour and minted a fresh uuid
   * per request. A retried create (a flaky network on the one screen a parent
   * will retry) made a SECOND character, burning both a character slot and the
   * build budget — and on the free tier the slot is the only one they get.
   */
  idempotencyKey: IdempotencyKey,
});
export const CreateCharacterResponse = z.object({
  character: CharacterDto,
  job: JobStatusDto,
  quota: QuotaSnapshot,
});

export const ListCharactersRequest = z.object({
  childId: Uuid.optional(),
  includeArchived: z.boolean().default(false),
});
export const ListCharactersResponse = z.object({ characters: z.array(CharacterDto) });

export const GetCharacterResponse = z.object({
  character: CharacterDto,
  assets: z.array(CharacterAssetDto),
  stories: z.array(StorySummaryDto),
});

export const UpdateCharacterRequest = z.object({
  id: Uuid,
  name: FreeTextName.optional(),
  characterType: FreeTextName.nullable().optional(),
  personalityTraits: z.array(FreeTextName).max(4).optional(),
});
export const UpdateCharacterResponse = z.object({ character: CharacterDto });

/**
 * Soft-delete. Assets hard-deleted after RETENTION_DAYS. Stories starring it
 * survive with characterTombstone = true.
 */
export const DeleteCharacterRequest = z.object({ id: Uuid });

/** Trait suggestions produced by the character_build job. */
export const GetTraitSuggestionsResponse = z.object({
  characterId: Uuid,
  /** Framed as suggestions we made, never as facts we detected. */
  suggestedType: z.string().nullable(),
  suggestedTraits: z.array(z.string()).max(4),
  ready: z.boolean(),
});

/* ═══ 5. stories ═════════════════════════════════════════════════════════ */

/**
 * THE quota gate. Order of checks, all server-side, before any enqueue:
 *   1. global generation halt
 *   2. per-device / per-IP rate limit (anonymous only)
 *   3. entitlement -> allowedLengths
 *   4. story quota (or topup balance)
 *   5. MEASURED cost ceiling:
 *        accrued + reserved + STORY_SHAPE[length].estimatedCostCents
 *          <= MONTHLY_COST_CEILING_CENTS
 * Failing 4 or 5 returns quota_exceeded / cost_ceiling_exceeded with a
 * QuotaSnapshot in error.details.quota.
 */
export const CreateStoryRequest = z.object({
  childId: Uuid,
  /**
   * Array, not a scalar — StoryCharacter is many-to-many from day one.
   * MVP: exactly one entry. The server rejects length !== 1 until V1.1.
   */
  characters: z
    .array(z.object({ characterId: Uuid, role: StoryCharacterRole.default('lead') }))
    .min(1)
    .max(3),
  theme: StoryTheme,
  mood: StoryMood.default('adventurous'),
  length: StoryLength.default('short'),
  /**
   * Narration voice. Optional so an older client keeps working — omitted means
   * the free voice. A `family`-tier voice from a free account is REFUSED by
   * claim_story_quota, not silently downgraded: quietly reading the book in a
   * different voice from the one chosen is worse than saying no.
   */
  voiceId: NarrationVoiceId.default(DEFAULT_NARRATION_VOICE_ID),
  /**
   * The language the story is WRITTEN and read aloud in — not a narration
   * setting. Free on every tier (languages.ts): a family that cannot read the
   * free story has not been given one.
   */
  locale: StoryLocale.default(DEFAULT_STORY_LOCALE),
  /** Client-generated, stable across retries of the same user intent. */
  idempotencyKey: IdempotencyKey,
});
export const CreateStoryResponse = z.object({
  story: StoryDetailDto,
  job: JobStatusDto,
  quota: QuotaSnapshot,
});

export const ListStoriesRequest = z.object({
  childId: Uuid.optional(),
  favouritesOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().nullable().default(null),
});
export const ListStoriesResponse = z.object({
  stories: z.array(StorySummaryDto),
  nextCursor: z.string().nullable(),
});

export const GetStoryResponse = z.object({ story: StoryDetailDto });
export const SetStoryFavouriteRequest = z.object({ id: Uuid, favourited: z.boolean() });
export const DeleteStoryRequest = z.object({ id: Uuid });

/** 2 free per story (FREE_PAGE_REGENS_PER_STORY), then metered. */
export const RegeneratePageRequest = z.object({
  storyId: Uuid,
  pageIndex: z.number().int().min(1),
  idempotencyKey: IdempotencyKey,
});
export const RegeneratePageResponse = z.object({ job: JobStatusDto, quota: QuotaSnapshot });

/* ═══ 6. jobs ════════════════════════════════════════════════════════════ */

export const GetJobResponse = z.object({ job: JobStatusDto });

/**
 * Realtime channel `job:{jobId}`, or polling at SLO.jobPollIntervalMs. Emitted
 * by the worker at every stage transition and page completion.
 * NEVER emit a stage that is not actually running.
 */
export const JobProgressEvent = z.object({
  jobId: Uuid,
  storyId: Uuid.nullable(),
  status: JobStatus,
  stage: GenerationStage,
  stageCopyKey: z.string(),
  pagesCompleted: z.number().int(),
  pagesTotal: z.number().int(),
  /** Emitted the moment the cover lands, so the client can reveal it. */
  coverReady: z.boolean(),
  /** Pages readable right now — enables reading page 1 while page 5 renders. */
  readablePageIndexes: z.array(z.number().int()),
  errorCode: JobErrorCode.nullable(),
  emittedAt: IsoDateTimeSchema,
});
export type JobProgressEvent = z.infer<typeof JobProgressEvent>;

/* ═══ 7. media ═══════════════════════════════════════════════════════════ */

/** Batched. One round trip per screen, not one per image. */
export const SignMediaRequest = z.object({
  storageKeys: z.array(StorageKeySchema).min(1).max(64),
  expiresInSeconds: z.number().int().min(60).max(86_400).default(3600),
});
export const SignMediaResponse = z.object({ media: z.array(SignedMedia) });

/* ═══ 8. account: merge, link, delete (DECISIONS.md §7) ═══════════════════ */

/**
 * ACCOUNT MERGE — a first-class flow, not an error path.
 *
 *   a. Anonymous session A calls createMergeToken -> short-lived server-signed
 *      token naming uid A. Client stores it in the keychain.
 *   b. Client attempts linkIdentity(). If it fails with identity_already_exists,
 *      the client signs in normally, obtaining session B.
 *   c. Session B calls mergePreview with the token -> counts on both sides.
 *   d. Session B calls mergeAccounts with the token + strategy.
 *
 * Neither side is ever silently discarded. `keep_account_only` LEAVES the
 * anonymous content in place on uid A for RETENTION_DAYS.orphanedAnonymousContent.
 */
export const CreateMergeTokenResponse = z.object({
  mergeToken: z.string().min(16),
  expiresAt: IsoDateTimeSchema,
  /** Counts on this phone, for the "THIS PHONE" panel. */
  localCounts: z.object({ characters: z.number().int(), stories: z.number().int() }),
});

export const MergePreviewRequest = z.object({ mergeToken: z.string().min(16) });
export const MergePreviewResponse = z.object({
  /** Anonymous side ("THIS PHONE"). */
  source: z.object({
    parentId: Uuid,
    characters: z.number().int(),
    stories: z.number().int(),
    characterNames: z.array(z.string()),
  }),
  /** Signed-in side ("THE ACCOUNT"). */
  target: z.object({
    parentId: Uuid,
    characters: z.number().int(),
    stories: z.number().int(),
    characterNames: z.array(z.string()),
    entitlement: EntitlementSnapshot,
  }),
  mergedCounts: z.object({ characters: z.number().int(), stories: z.number().int() }),
  /**
   * True if merging would exceed the target's character quota. Merge is still
   * allowed — existing content is never blocked — but new creation is capped.
   */
  wouldExceedCharacterQuota: z.boolean(),
  /** MVP: duplicates are kept as separate books. No dedupe. */
  duplicatePolicy: z.literal('keep_both'),
});
export type MergePreviewResponse = z.infer<typeof MergePreviewResponse>;

export const MergeAccountsRequest = z.object({
  mergeToken: z.string().min(16),
  strategy: MergeStrategy,
});
export const MergeAccountsResponse = z.object({
  strategy: MergeStrategy,
  movedCharacters: z.number().int(),
  movedStories: z.number().int(),
  /** Present when strategy === 'keep_account_only'. Content retained, not deleted. */
  orphanedParentId: Uuid.nullable(),
  session: GetSessionResponse,
});

/** In-app account deletion. Cascades to object storage within 30 days. */
export const DeleteAccountRequest = z.object({
  /** Parental-gate proof: the gate must have been passed within the last 120s. */
  gatePassedAt: IsoDateTimeSchema,
  confirmation: z.literal('DELETE'),
});
export const DeleteAccountResponse = z.object({ scheduledPurgeAt: IsoDateTimeSchema });

/* ═══ 9. entitlement / RevenueCat webhook ════════════════════════════════ */

/**
 * SERVER-TO-SERVER ONLY. Verified by the Authorization header matching
 * REVENUECAT_WEBHOOK_SECRET. Must NOT accept a user JWT and must NOT be
 * callable with the anon key alone. The client NEVER asserts entitlement.
 */
export const RevenueCatWebhookEvent = z.object({
  api_version: z.string(),
  event: z.object({
    id: z.string(),
    type: z.enum([
      'INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'UNCANCELLATION',
      'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_PAUSED', 'EXPIRATION',
      'BILLING_ISSUE', 'PRODUCT_CHANGE', 'TRANSFER', 'REFUND_REVERSED',
      'SUBSCRIPTION_EXTENDED', 'TEST',
    ]),
    app_user_id: z.string(),
    original_app_user_id: z.string().optional(),
    product_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    period_type: z.string().optional(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    environment: z.enum(['SANDBOX', 'PRODUCTION']),
    original_transaction_id: z.string().optional(),
    store: z.string().optional(),
  }),
});
export type RevenueCatWebhookEvent = z.infer<typeof RevenueCatWebhookEvent>;

/**
 * Client asks the server to re-read RevenueCat after a purchase completes.
 * This is a HINT to reconcile, not an assertion of entitlement.
 */
export const RefreshEntitlementResponse = z.object({
  entitlement: EntitlementSnapshot,
  quota: QuotaSnapshot,
});

/* ═══ 10. moderation surface (client-visible subset) ═════════════════════ */

/** Returned inside ApiError.details when code === 'moderation_blocked'. */
export const ModerationBlockDetail = z.object({
  stage: ModerationStage,
  subjectType: ModerationSubjectType,
  verdict: ModerationVerdict,
  action: ModerationAction,
  /**
   * e.g. `moderation.blocked.input_image` -> "Let's try a different drawing."
   * Never an accusation. Categories are NOT sent to the client.
   */
  copyKey: z.string(),
});

/* ═══ 11. Job payloads (pgmq message bodies) ═════════════════════════════ */

/**
 * What the Edge Function writes into pgmq and the worker reads. `jobId` always
 * references an existing generation_jobs row — the queue message is transient,
 * the row is not.
 */
const JobPayloadBase = z.object({
  jobId: Uuid,
  parentId: Uuid,
  childId: Uuid,
  /** Reserved cost, already added to usage_records.cost_cents_reserved. */
  estimatedCostCents: z.number().int().min(0),
  modelBundleVersion: z.string(),
  enqueuedAt: IsoDateTimeSchema,
  attempt: z.number().int().min(1).default(1),
});

export const CharacterBuildJobPayload = JobPayloadBase.extend({
  type: z.literal('character_build'),
  characterId: Uuid,
  drawingId: Uuid,
  cutoutStorageKey: StorageKeySchema,
});

export const StoryGenerateJobPayload = JobPayloadBase.extend({
  type: z.literal('story_generate'),
  storyId: Uuid,
  characterIds: z.array(Uuid).min(1),
  theme: StoryTheme,
  mood: StoryMood,
  length: StoryLength,
  pageCount: z.number().int().min(1),
  /** From child_profiles.age_band. Drives vocabulary. Never a birth date. */
  ageBand: AgeBand,
  renderTechnique: RenderTechnique,
  locale: StoryLocale,
  /** Chosen at claim time and already checked against the tier there. */
  voiceId: NarrationVoiceId.default(DEFAULT_NARRATION_VOICE_ID),
});

export const PageRegenerateJobPayload = JobPayloadBase.extend({
  type: z.literal('page_regenerate'),
  storyId: Uuid,
  pageIndex: z.number().int().min(1),
});

export const NarrationJobPayload = JobPayloadBase.extend({
  type: z.literal('narration_generate'),
  storyId: Uuid,
  voiceId: NarrationVoiceId,
  language: z.string(),
});

/**
 * Inferred types for each payload. The schema and its type share a name, per
 * the convention used throughout this file — a zod const and a TS type occupy
 * different namespaces, so both are importable as `JobPayload` etc.
 */
export type CharacterBuildJobPayload = z.infer<typeof CharacterBuildJobPayload>;
export type StoryGenerateJobPayload = z.infer<typeof StoryGenerateJobPayload>;
export type PageRegenerateJobPayload = z.infer<typeof PageRegenerateJobPayload>;
export type NarrationJobPayload = z.infer<typeof NarrationJobPayload>;

export const JobPayload = z.discriminatedUnion('type', [
  CharacterBuildJobPayload,
  StoryGenerateJobPayload,
  PageRegenerateJobPayload,
  NarrationJobPayload,
]);
export type JobPayload = z.infer<typeof JobPayload>;

export const QUEUE_NAMES = {
  generation: 'papercub_generation',
  generationDlq: 'papercub_generation_dlq',
} as const;

/* ═══ 12. Worker -> DB write shapes ══════════════════════════════════════ */

/**
 * The worker holds the service-role key and writes directly to Postgres. These
 * schemas exist so its writes are typed, NOT because they are HTTP endpoints.
 */
export const RecordCostRequest = z.object({
  jobId: Uuid,
  parentId: Uuid,
  stage: GenerationStage,
  provider: z.string(),
  modelId: z.string(),
  /** MEASURED, from the provider's usage response. Not an estimate. */
  costCents: z.number().int().min(0),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  imageCount: z.number().int().min(0).default(0),
  latencyMs: z.number().int().min(0),
});
export type RecordCostRequest = z.infer<typeof RecordCostRequest>;

export const RecordModerationRequest = z.object({
  parentId: Uuid,
  subjectType: ModerationSubjectType,
  subjectId: z.string(),
  stage: ModerationStage,
  verdict: ModerationVerdict,
  categories: z.array(z.string()),
  actionTaken: ModerationAction,
  provider: z.string(),
  rawScore: z.number().nullable(),
});

/* ═══ 13. Structured model outputs ═══════════════════════════════════════ */

/**
 * The exact JSON shape the text model must return. Providers are configured
 * with this as a response schema so free-form prose can never land in a page
 * slot (moderation gate 2).
 */
export const GeneratedStory = z.object({
  title: z.string().min(1).max(80),
  pages: z
    .array(
      z.object({
        index: z.number().int().min(1),
        text: z.string().min(1).max(400),
        /** Self-contained. No pronoun references to other pages. */
        sceneDescription: z.string().min(20).max(1200),
      }),
    )
    .min(1),
  coverSceneDescription: z.string().min(20).max(1200),
});
export type GeneratedStory = z.infer<typeof GeneratedStory>;

/** The vision pass over the cut-out. */
export const DrawingAnalysis = z.object({
  subjectGuess: z.string().max(60),
  dominantColours: z.array(HexColour).max(6),
  /** e.g. ["three horns", "one big eye", "striped tail"] — the feature anchor. */
  distinguishingFeatures: z.array(z.string().max(60)).max(6),
  medium: z.enum(['crayon', 'marker', 'pencil', 'paint', 'mixed', 'unknown']),
  lineQuality: z.enum(['bold', 'light', 'sketchy', 'mixed']),
  /** Proposals requiring an explicit parent approve step. Never auto-applied. */
  suggestedTraits: z.array(z.string().max(30)).max(3),
  suggestedType: z.string().max(30),
});
export type DrawingAnalysis = z.infer<typeof DrawingAnalysis>;

/* ═══ 14. Endpoint registry ══════════════════════════════════════════════ */

/**
 * The complete list of Edge Functions. B2 implements exactly these; B3 calls
 * exactly these. Adding one means adding it here first.
 *
 * `auth`:
 *   'user'    — requires a Supabase user JWT (anonymous JWTs count). RLS applies.
 *   'service' — server-to-server, header-authenticated. NOT reachable with the
 *               anon key. Never called from apps/mobile.
 */
export const endpoints = {
  getSession:          { fn: 'session',            method: 'GET',    auth: 'user',    request: z.void(),               response: GetSessionResponse },
  upsertChild:         { fn: 'children',           method: 'POST',   auth: 'user',    request: UpsertChildRequest,     response: UpsertChildResponse },
  deleteChild:         { fn: 'children',           method: 'DELETE', auth: 'user',    request: DeleteChildRequest,     response: EmptyResponse },

  createUploadUrl:     { fn: 'uploads',            method: 'POST',   auth: 'user',    request: CreateUploadUrlRequest, response: CreateUploadUrlResponse },

  createCharacter:     { fn: 'characters',         method: 'POST',   auth: 'user',    request: CreateCharacterRequest, response: CreateCharacterResponse },
  listCharacters:      { fn: 'characters',         method: 'GET',    auth: 'user',    request: ListCharactersRequest,  response: ListCharactersResponse },
  getCharacter:        { fn: 'characters',         method: 'GET',    auth: 'user',    request: z.object({ id: Uuid }), response: GetCharacterResponse },
  updateCharacter:     { fn: 'characters',         method: 'PATCH',  auth: 'user',    request: UpdateCharacterRequest, response: UpdateCharacterResponse },
  deleteCharacter:     { fn: 'characters',         method: 'DELETE', auth: 'user',    request: DeleteCharacterRequest, response: EmptyResponse },
  getTraitSuggestions: { fn: 'characters',         method: 'GET',    auth: 'user',    request: z.object({ id: Uuid }), response: GetTraitSuggestionsResponse },

  createStory:         { fn: 'stories',            method: 'POST',   auth: 'user',    request: CreateStoryRequest,     response: CreateStoryResponse },
  listStories:         { fn: 'stories',            method: 'GET',    auth: 'user',    request: ListStoriesRequest,     response: ListStoriesResponse },
  getStory:            { fn: 'stories',            method: 'GET',    auth: 'user',    request: z.object({ id: Uuid }), response: GetStoryResponse },
  setStoryFavourite:   { fn: 'stories',            method: 'PATCH',  auth: 'user',    request: SetStoryFavouriteRequest, response: EmptyResponse },
  deleteStory:         { fn: 'stories',            method: 'DELETE', auth: 'user',    request: DeleteStoryRequest,     response: EmptyResponse },
  regeneratePage:      { fn: 'stories',            method: 'POST',   auth: 'user',    request: RegeneratePageRequest,  response: RegeneratePageResponse },

  getJob:              { fn: 'jobs',               method: 'GET',    auth: 'user',    request: z.object({ id: Uuid }), response: GetJobResponse },

  signMedia:           { fn: 'media-sign',         method: 'POST',   auth: 'user',    request: SignMediaRequest,       response: SignMediaResponse },

  createMergeToken:    { fn: 'account-merge',      method: 'POST',   auth: 'user',    request: z.void(),               response: CreateMergeTokenResponse },
  mergePreview:        { fn: 'account-merge',      method: 'POST',   auth: 'user',    request: MergePreviewRequest,    response: MergePreviewResponse },
  mergeAccounts:       { fn: 'account-merge',      method: 'POST',   auth: 'user',    request: MergeAccountsRequest,   response: MergeAccountsResponse },

  deleteAccount:       { fn: 'account-delete',     method: 'POST',   auth: 'user',    request: DeleteAccountRequest,   response: DeleteAccountResponse },

  refreshEntitlement:  { fn: 'entitlement',        method: 'POST',   auth: 'user',    request: z.void(),               response: RefreshEntitlementResponse },
  revenuecatWebhook:   { fn: 'revenuecat-webhook', method: 'POST',   auth: 'service', request: RevenueCatWebhookEvent, response: EmptyResponse },
} as const;

export type EndpointName = keyof typeof endpoints;
export type EndpointRequest<K extends EndpointName> = z.infer<(typeof endpoints)[K]['request']>;
export type EndpointResponse<K extends EndpointName> = z.infer<(typeof endpoints)[K]['response']>;
