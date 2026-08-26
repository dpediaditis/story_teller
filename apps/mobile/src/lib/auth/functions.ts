import { FunctionsHttpError } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { ApiError } from '@papercub/shared';
import { supabase } from '../supabase';
// Imported from the leaf module, NOT the '../api' barrel: the barrel now also
// exports supabaseApiClient, which imports this file — a require cycle that
// leaves one of the two uninitialised at runtime depending on load order.
import { ApiCallError } from '../api/client';

/**
 * Calls an `account-merge` / `session` Edge Function directly (these two
 * functions are consumed from the auth module rather than through
 * `apps/mobile/src/lib/api`'s mock-backed `apiClient` — see this agent's
 * handover report for why). `supabase.functions.invoke` attaches the current
 * session's JWT automatically (anonymous JWTs included), so every call here
 * is subject to RLS exactly like a direct client call would be — never a
 * service-role client, never the anon key alone for a `auth: 'user'` route.
 *
 * `fnPath` may include a sub-route, e.g. `'account-merge/preview'`, matching
 * the sub-routing convention documented in that function's `index.ts`.
 */
export async function invokeAuthFn<Res>(
  fnPath: string,
  responseSchema: z.ZodType<Res>,
  body?: unknown,
  method: 'GET' | 'POST' = 'POST',
): Promise<Res> {
  const { data, error } = await supabase.functions.invoke(fnPath, {
    method,
    ...(method === 'GET' ? {} : { body: body ?? {} }),
  });

  if (error) {
    const apiError = await extractApiError(error);
    throw new ApiCallError(apiError);
  }

  // The envelope is { ok: true, data } on success (2xx) — invoke() only
  // returns a JS error for non-2xx, so `data` here is always the success
  // shape, but we still re-validate against the contract schema rather than
  // trusting the wire.
  const envelopeData = (data as { ok?: boolean; data?: unknown })?.data ?? data;
  const parsed = responseSchema.safeParse(envelopeData);
  if (!parsed.success) {
    throw new ApiCallError({
      code: 'internal',
      message: `response for ${fnPath} did not match the contract: ${parsed.error.message}`,
      retryable: false,
    });
  }
  return parsed.data;
}

async function extractApiError(error: unknown): Promise<ApiError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { ok?: boolean; error?: ApiError };
      if (body?.error) return body.error;
    } catch {
      // fall through to the generic mapping below
    }
  }
  const message = error instanceof Error ? error.message : 'unknown auth function error';
  return {
    code: 'upstream_unavailable',
    message,
    copyKey: 'error.upstream_unavailable',
    retryable: true,
  };
}
