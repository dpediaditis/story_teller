import { z } from 'zod';

/**
 * Every closed vocabulary in Papercub, exactly once, as a zod enum.
 * The zod value is the source of truth; the TS type is derived.
 *
 * NAMING: enum *values* are lower_snake_case and are what is stored in Postgres
 * and sent over the wire. Display strings are never enum values — they live in
 * the mobile copy layer. Adding a value requires a migration (B1) + copy key (B3).
 */

/* ── Child ─────────────────────────────────────────────────────────────── */

/**
 * DECISIONS.md §10: age BAND only. A birth date must not exist anywhere in the
 * schema, contract, or client. This enum is the only permitted age representation.
 */
export const AgeBand = z.enum(['4_5', '6_7', '8_plus']);
export type AgeBand = z.infer<typeof AgeBand>;

/* ── Drawing / character ───────────────────────────────────────────────── */

export const DrawingSource = z.enum(['camera', 'photos']);
export type DrawingSource = z.infer<typeof DrawingSource>;

/** DECISIONS.md §10: the full photo is only retained on explicit opt-in. */
export const RetentionPolicy = z.enum(['delete_after_cutout', 'keep_original']);
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

/** How the on-device pipeline produced the cut-out. Drives Milestone-0 metrics. */
export const IsolationMethod = z.enum(['vision_subject_lift', 'ink_extraction', 'manual_repair']);
export type IsolationMethod = z.infer<typeof IsolationMethod>;

export const CharacterAssetKind = z.enum(['cutout', 'reference_sheet', 'pose', 'style_ref']);
export type CharacterAssetKind = z.infer<typeof CharacterAssetKind>;

export const CharacterStatus = z.enum(['draft', 'building', 'ready', 'failed', 'archived']);
export type CharacterStatus = z.infer<typeof CharacterStatus>;

/* ── Story ─────────────────────────────────────────────────────────────── */

/** Six themes, from design artboard "Pick an adventure". */
export const StoryTheme = z.enum(['space', 'dinosaurs', 'underwater', 'magic', 'pirates', 'jungle']);
export type StoryTheme = z.infer<typeof StoryTheme>;

/** Three moods. Default is `adventurous`. */
export const StoryMood = z.enum(['funny', 'adventurous', 'calm']);
export type StoryMood = z.infer<typeof StoryMood>;

/** Three lengths. Page counts live in constants.ts — never hard-code them. */
export const StoryLength = z.enum(['short', 'normal', 'bedtime']);
export type StoryLength = z.infer<typeof StoryLength>;

/**
 * `partial` is load-bearing: cover-first streaming means a story is readable
 * before it is complete. The reader must handle it.
 */
export const StoryStatus = z.enum([
  'draft', 'queued', 'generating', 'partial', 'ready', 'failed', 'deleted',
]);
export type StoryStatus = z.infer<typeof StoryStatus>;

export const StoryPageStatus = z.enum(['pending', 'text_ready', 'illustrating', 'ready', 'failed']);
export type StoryPageStatus = z.infer<typeof StoryPageStatus>;

/** MVP always writes exactly one row, role `lead`. See domain.ts StoryCharacter. */
export const StoryCharacterRole = z.enum(['lead', 'companion']);
export type StoryCharacterRole = z.infer<typeof StoryCharacterRole>;

/**
 * The illustration technique is a per-story parameter so Milestone 0's Fidelity
 * Ladder can choose without a migration. Default: `cutout_rerender`.
 */
export const RenderTechnique = z.enum([
  'paper_cutout_composite', 'cutout_rerender', 'multi_reference',
]);
export type RenderTechnique = z.infer<typeof RenderTechnique>;

/* ── Jobs ──────────────────────────────────────────────────────────────── */

export const JobType = z.enum([
  'character_build', 'story_generate', 'page_regenerate', 'narration_generate',
]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum([
  'queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead_letter',
]);
export type JobStatus = z.infer<typeof JobStatus>;

/**
 * Pipeline stages, in execution order. Each message shown to a user must
 * correspond to a stage that is ACTUALLY RUNNING. Never invent progress.
 * Mobile copy key for each stage is `generation.stage.<value>`.
 */
export const GenerationStage = z.enum([
  'queued',
  'moderating_input',        // gate 1
  'analysing_drawing',       // vision pass
  'building_character_refs', // CharacterAsset set
  'validating_request',      // gate 2
  'writing_story',           // "Writing Bobo's story"
  'moderating_text',         // gate 3 + reading-level check
  'illustrating_cover',      // "Drawing the moon"
  'illustrating_pages',      // "Colouring page 3…"
  'moderating_images',       // gate 4
  'narrating',               // "Recording the voice"
  'assembling',              // "Binding the book"
  'done',
]);
export type GenerationStage = z.infer<typeof GenerationStage>;

/* ── Moderation (the four gates) ───────────────────────────────────────── */

export const ModerationStage = z.enum(['input_image', 'input_text', 'output_text', 'output_image']);
export type ModerationStage = z.infer<typeof ModerationStage>;

export const ModerationVerdict = z.enum(['pass', 'flag', 'block']);
export type ModerationVerdict = z.infer<typeof ModerationVerdict>;

export const ModerationSubjectType = z.enum([
  'original_drawing', 'character_cutout', 'character_name', 'character_traits',
  'story_request', 'story_page_text', 'page_illustration', 'narration',
]);
export type ModerationSubjectType = z.infer<typeof ModerationSubjectType>;

export const ModerationAction = z.enum([
  'none', 'soft_retry', 'blocked_and_refunded', 'blocked_story_failed',
  'name_rejected', 'trait_dropped',
]);
export type ModerationAction = z.infer<typeof ModerationAction>;

/* ── Money ─────────────────────────────────────────────────────────────── */

export const EntitlementTier = z.enum(['free', 'family']);
export type EntitlementTier = z.infer<typeof EntitlementTier>;

/** RevenueCat product identifiers. DECISIONS.md §1. */
export const ProductId = z.enum([
  'papercub_family_monthly', 'papercub_family_annual', 'papercub_topup_3',
]);
export type ProductId = z.infer<typeof ProductId>;

export const SubscriptionStatus = z.enum([
  'none', 'active', 'in_grace_period', 'in_billing_retry', 'expired', 'revoked', 'paused',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const StoreEnvironment = z.enum(['sandbox', 'production']);
export type StoreEnvironment = z.infer<typeof StoreEnvironment>;

/** Which limit stopped the request. Drives which paywall variant is shown. */
export const QuotaBlockReason = z.enum([
  'story_quota_exhausted',
  'character_quota_exhausted',
  'cost_ceiling_reached',   // DECISIONS.md §3.1 — measured
  'global_spend_halt',      // DECISIONS.md §3.3
  'rate_limited',           // DECISIONS.md §3.4
  'free_tier_consumed',     // one-off free tier, never renews
]);
export type QuotaBlockReason = z.infer<typeof QuotaBlockReason>;

/* ── Auth / account merge (DECISIONS.md §7, §12) ───────────────────────── */

export const AuthProvider = z.enum(['anonymous', 'apple', 'google']);
export type AuthProvider = z.infer<typeof AuthProvider>;

/**
 * Design artboard "That account already has a library".
 * `merge` = "Put them together" (default, primary).
 * `keep_account_only` = anonymous content is LEFT IN PLACE on the orphaned uid,
 * never deleted, retained per RETENTION_DAYS.orphanedAnonymousContent.
 */
export const MergeStrategy = z.enum(['merge', 'keep_account_only']);
export type MergeStrategy = z.infer<typeof MergeStrategy>;
