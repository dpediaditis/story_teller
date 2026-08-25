/**
 * Zod-validated environment for services/worker.
 *
 * This is the ONLY file in the monorepo permitted to read
 * `SUPABASE_SERVICE_ROLE_KEY` (see eslint.config.mjs's `no-restricted-syntax`
 * rule, which fails the build on any other reference to it in
 * apps/mobile, supabase/functions, or packages/**).
 */

import { z } from 'zod';

const EnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),

  WORKER_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  GLOBAL_DAILY_SPEND_CAP_CENTS: z.coerce.number().int().min(0).default(50000),

  /** Bumped whenever the provider/model set used for generation changes. */
  MODEL_BUNDLE_VERSION: z.string().default('2026.08.01'),
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
