import { z } from 'zod';

/** Client-visible API failures. Every Edge Function returns one of these. */
export const ApiErrorCode = z.enum([
  'unauthenticated', 'forbidden', 'not_found', 'validation_failed', 'conflict',
  'quota_exceeded', 'cost_ceiling_exceeded', 'entitlement_required', 'rate_limited',
  'moderation_blocked', 'account_merge_required', 'upstream_unavailable',
  'service_halted', 'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const HTTP_STATUS_FOR_ERROR: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  quota_exceeded: 402,
  cost_ceiling_exceeded: 402,
  entitlement_required: 402,
  rate_limited: 429,
  moderation_blocked: 422,
  account_merge_required: 409,
  upstream_unavailable: 503,
  service_halted: 503,
  internal: 500,
};

export const ApiError = z.object({
  code: ApiErrorCode,
  /** Developer-facing. NEVER rendered to a user — the app owns all copy. */
  message: z.string(),
  /** Copy key the client renders, e.g. `error.quota_exceeded.free`. */
  copyKey: z.string().optional(),
  retryable: z.boolean().default(false),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Terminal failure reasons recorded on generation_jobs.error_code. */
export const JobErrorCode = z.enum([
  'moderation_blocked_input_image', 'moderation_blocked_input_text',
  'moderation_blocked_output_text', 'moderation_blocked_output_image',
  'reading_level_failed', 'invalid_structured_output', 'provider_timeout',
  'provider_error', 'provider_rate_limited', 'provider_safety_refusal',
  'regen_budget_exhausted', 'cost_ceiling_exceeded', 'storage_error',
  'cancelled', 'internal',
]);
export type JobErrorCode = z.infer<typeof JobErrorCode>;

/**
 * Failures that must refund the story quota. Gate 4 requires failing a story
 * cleanly and refunding rather than shipping something unreviewed.
 * Idempotency is guarded by generation_jobs.quota_refunded — without that flag
 * this becomes a free-story exploit.
 */
export const REFUNDABLE_JOB_ERRORS: readonly JobErrorCode[] = [
  'provider_timeout', 'provider_error', 'provider_rate_limited',
  'invalid_structured_output', 'storage_error', 'regen_budget_exhausted',
  'moderation_blocked_output_text', 'moderation_blocked_output_image', 'internal',
] as const;
