// Auth helpers for Edge Functions.
//
//  - `auth: 'user'` endpoints (contract.ts `endpoints`): verify the caller's
//    Supabase JWT (anonymous JWTs count, docs/ARCHITECTURE.md) and hand back a
//    Supabase client scoped to THAT JWT, so every subsequent query is subject
//    to RLS exactly like the client's own would be. This function never
//    constructs a service-role client — that key does not exist in this
//    package (CLAUDE.md rule 1 / docs/ARCHITECTURE.md "the service-role rule").
//
//  - `auth: 'service'` endpoints (only `revenuecat-webhook`): header-secret
//    authenticated, NOT reachable with a user JWT or the anon key alone.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@papercub/shared';
import { ApiFailure } from './respond.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/**
 * A Supabase client authenticated as the CALLER — forwards the incoming
 * `Authorization` header as-is, so PostgREST evaluates RLS as `auth.uid()` ==
 * the caller's own uid. Anonymous JWTs (Supabase anonymous sign-in) work the
 * same way as any other JWT here.
 */
export function callerClient(req: Request): SupabaseClient<Database> {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface AuthedRequest {
  supabase: SupabaseClient<Database>;
  userId: string;
}

/**
 * For `auth: 'user'` endpoints. Verifies the JWT server-side via
 * `auth.getUser()` (never trusts an unverified header) and returns both the
 * uid and an RLS-scoped client for the rest of the handler to use.
 */
export async function requireUser(req: Request): Promise<AuthedRequest> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new ApiFailure('unauthenticated', {
      message: 'missing Authorization header',
      copyKey: 'error.unauthenticated',
      retryable: false,
    });
  }
  const supabase = callerClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ApiFailure('unauthenticated', {
      message: 'invalid or expired session',
      copyKey: 'error.unauthenticated',
      retryable: false,
    });
  }
  return { supabase, userId: data.user.id };
}

/**
 * For `auth: 'service'` endpoints. Verified by the Authorization header
 * matching the named secret env var — NOT a user JWT, NOT the anon key.
 * `revenuecat-webhook` calls this BEFORE parsing anything (docs/AGENT_BRIEFS.md
 * B2 red line).
 */
export function requireServiceSecret(req: Request, envVarName: string): void {
  const expected = Deno.env.get(envVarName);
  if (!expected) {
    throw new ApiFailure('internal', {
      message: `${envVarName} is not configured`,
      retryable: false,
    });
  }
  const header = req.headers.get('Authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '').trim();
  if (!timingSafeEqual(provided, expected)) {
    throw new ApiFailure('unauthenticated', {
      message: 'invalid webhook secret',
      retryable: false,
    });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
