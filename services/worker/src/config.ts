/**
 * Zod-validated environment for services/worker.
 *
 * This is the ONLY file in the monorepo permitted to read
 * `SUPABASE_SERVICE_ROLE_KEY` (see eslint.config.mjs's `no-restricted-syntax`
 * rule, which fails the build on any other reference to it in
 * apps/mobile, supabase/functions, or packages/**).
 */

import { z } from 'zod';

/**
 * A .env writes an unset key as `KEY=`, which arrives as ''. zod's `.optional()`
 * accepts *absent*, not *empty*, so the worker refused to boot whenever an
 * optional provider key was left blank — the normal state for OPENAI_API_KEY
 * and REVENUECAT_SECRET_API_KEY.
 */
const emptyAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),

  /**
   * RevenueCat REST v1 secret key. The reconciler re-fetches subscriber state
   * with this rather than trusting the stored webhook payload
   * (20260826090000_entitlement_inbox_and_merge_grants.sql).
   */
  REVENUECAT_SECRET_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  REVENUECAT_API_BASE_URL: z.string().url().default('https://api.revenuecat.com'),

  WORKER_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  GLOBAL_DAILY_SPEND_CAP_CENTS: z.coerce.number().int().min(0).default(50000),

  /** Bumped whenever the provider/model set used for generation changes. */
  MODEL_BUNDLE_VERSION: z.string().default('2026.08.01'),

  /* ── Model selection ──────────────────────────────────────────────────
   * The premium/fast split is not a preference, it is the unit economics:
   * DECISIONS.md §2 prices a story as ONE premium cover plus N fast interior
   * pages. Changing either of these changes the cost table.
   */
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.5-flash'),
  GEMINI_VISION_MODEL: z.string().default('gemini-3.1-flash-lite'),
  GEMINI_IMAGE_MODEL_PREMIUM: z.string().default('gemini-3.1-flash-image'),
  GEMINI_IMAGE_MODEL_FAST: z.string().default('gemini-3.1-flash-lite-image'),
  GEMINI_TTS_MODEL: z.string().default('gemini-2.5-flash-preview-tts'),

  /** Second provider, implemented but DARK. Never selected unless set true. */
  ENABLE_OPENAI_PROVIDER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OPENAI_TEXT_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),

  /* ── Queue ────────────────────────────────────────────────────────────── */
  /**
   * docs/ARCHITECTURE.md specified 180s. Measured against it, that is too low:
   * a normal story takes 154s and a bedtime story is longer, so pgmq redelivers
   * the message while the job is still running and a second worker generates —
   * and pays for — the whole book again. Observed live on a character_build.
   *
   * The timeout has to sit comfortably above the WORST job duration, not the
   * typical one, because a Gemini 503 storm adds ~62s of backoff per call. The
   * cost of it being too high is only that a genuinely crashed worker's message
   * waits longer to be retried, and the client is polling the job row anyway.
   */
  QUEUE_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(900),
  QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1000),
  QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).default(1),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

let cached: WorkerConfig | undefined;

/** Parses process.env once and caches the result. Throws on first call if invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (!cached) {
    cached = EnvSchema.parse(env);
  }
  return cached;
}

/** Test seam. Never called in production code. */
export function resetConfigForTests(): void {
  cached = undefined;
}
