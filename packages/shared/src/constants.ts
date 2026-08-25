import type { StoryLength, ProductId } from './enums';

/**
 * Every number DECISIONS.md fixes. If a value appears here it must NOT be
 * duplicated as a literal anywhere else in the monorepo.
 */

/* ── Story shape ───────────────────────────────────────────────────────────
 * DECISIONS.md §11. The design's assumptions note said 8/12/16 pages; at those
 * counts a bedtime book is 17 images (~$0.92) and the worst legitimate month is
 * $4.69 — NEGATIVE against the annual plan's $4.81 net. Revised to 6/10/12.
 * imageCount = pageCount + 1 cover.
 */
export const STORY_SHAPE: Record<
  StoryLength,
  { pageCount: number; imageCount: number; approxMinutes: number; estimatedCostCents: number }
> = {
  short:   { pageCount: 6,  imageCount: 7,  approxMinutes: 3, estimatedCostCents: 45 },
  normal:  { pageCount: 10, imageCount: 11, approxMinutes: 5, estimatedCostCents: 64 },
  bedtime: { pageCount: 12, imageCount: 13, approxMinutes: 7, estimatedCostCents: 74 },
} as const;

export const CHARACTER_BUILD_ESTIMATED_COST_CENTS = 16;
export const SENTENCES_PER_PAGE = { min: 2, max: 3 } as const;

/* ── Quota (DECISIONS.md §1, §3) ───────────────────────────────────────── */

export const QUOTA = {
  free: {
    /** One-off. NEVER renews. There is no reset date on the free tier. */
    storiesTotal: 1,
    charactersTotal: 1,
    /** The free story is forced to `short`. */
    allowedLengths: ['short'] as const,
    renews: false,
  },
  family: {
    storiesPerPeriod: 5,
    charactersTotal: 5,
    allowedLengths: ['short', 'normal', 'bedtime'] as const,
    /** Resets on the billing anniversary. No rollover. */
    renews: true,
  },
} as const;

export const TOPUP_STORIES_GRANTED = 3;

/** Regenerating a page: 2 free per story, then it consumes budget. */
export const FREE_PAGE_REGENS_PER_STORY = 2;

/* ── Cost guarantees (DECISIONS.md §3) ─────────────────────────────────── */

/**
 * Per-account monthly ceiling, on MEASURED cost accrued in usage_records — not
 * on story count. Sits above the worst legitimate month (5 bedtime = $3.74) so
 * it never binds for an honest user. Checked BEFORE enqueueing any job.
 */
export const MONTHLY_COST_CEILING_CENTS = 385;

/** Free-tier lifetime exposure: 1 short story (45c) + 1 character (16c). */
export const FREE_TIER_LIFETIME_CEILING_CENTS = 61;

/** Alert threshold on the 7-day moving average cost per story. */
export const COST_PER_STORY_ALERT_CENTS = 75;

/** Retry overhead already priced into STORY_SHAPE estimates. */
export const RETRY_OVERHEAD_RATIO = 0.15;

export const MAX_ATTEMPTS_PER_STAGE = 3;

/* ── Pricing display (RevenueCat is authoritative at runtime) ──────────── */

export const PRODUCTS: Record<ProductId, { displayPriceEUR: string; period: string }> = {
  papercub_family_monthly: { displayPriceEUR: 'EUR 7.99',  period: 'month' },
  papercub_family_annual:  { displayPriceEUR: 'EUR 79.99', period: 'year' },
  papercub_topup_3:        { displayPriceEUR: 'EUR 4.99',  period: 'once' },
} as const;

/* ── Retention (DECISIONS.md §10) ──────────────────────────────────────── */

export const RETENTION_DAYS = {
  characterAssetsAfterSoftDelete: 30,
  accountHardDelete: 30,
  promptDebugArtefacts: 30,
  /** Anonymous uid orphaned by a `keep_account_only` merge. Retained, not deleted. */
  orphanedAnonymousContent: 30,
} as const;

/* ── Media ─────────────────────────────────────────────────────────────── */

export const SIGNED_URL_TTL_SECONDS = 3600;
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const COVER_ASPECT_RATIO = '4:5' as const;
export const PAGE_ASPECT_RATIO = '4:3' as const;

/* ── Latency SLOs ──────────────────────────────────────────────────────── */

export const SLO = {
  coverRevealMs: 12_000,
  shortStoryCompleteMs: 70_000,
  /** After this, the client switches to the "slow" copy. */
  showSlowStateAfterMs: 60_000,
  jobPollIntervalMs: 2_000,
} as const;
