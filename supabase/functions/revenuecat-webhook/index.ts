// POST /revenuecat-webhook (revenuecatWebhook). contract.ts:
// endpoints.revenuecatWebhook. auth: 'service' — SERVER-TO-SERVER ONLY.
//
// Verifies REVENUECAT_WEBHOOK_SECRET BEFORE parsing anything (docs/AGENT_BRIEFS.md
// B2 red line). Not callable with a user JWT or the anon key alone.
//
// KNOWN GRANT MISMATCH (see this agent's handover report): apply_revenuecat_event
// is `grant execute ... to service_role` only
// (supabase/migrations/20260825182000_security_definer_functions.sql). This
// Edge Function does NOT hold SUPABASE_SERVICE_ROLE_KEY — CLAUDE.md rule 1 is
// categorical: that key exists only in services/worker, nowhere else, full
// stop. So the RPC call below is expected to fail with a 42501 permission
// error under the schema exactly as delivered, even though this webhook has
// already authenticated the caller via the shared secret. docs/ARCHITECTURE.md
// says these functions should be callable "not by holding the service key",
// which implies the EXECUTE grant should include a role this function CAN
// act as (there is no user JWT here at all, so realistically `anon`, scoped
// safely because apply_revenuecat_event only runs elevated logic after this
// function's own secret check) — that grant does not exist today. This
// function implements the correct verify -> parse -> map -> call sequence so
// the fix is a one-line grant change away, and surfaces the failure as a
// clear internal error instead of silently no-opping.

import { RevenueCatWebhookEvent } from '@papercub/shared';
import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from '@papercub/shared';
import { requireServiceSecret } from '../_shared/auth.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

type SubscriptionStatus =
  | 'none' | 'active' | 'in_grace_period' | 'in_billing_retry' | 'expired' | 'revoked' | 'paused';


Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }

    // MUST happen before any parsing.
    requireServiceSecret(req, 'REVENUECAT_WEBHOOK_SECRET');

    const json = await req.json().catch(() => {
      throw new ApiFailure('validation_failed', { message: 'body is not valid JSON' });
    });
    const parsed = RevenueCatWebhookEvent.safeParse(json);
    if (!parsed.success) {
      throw new ApiFailure('validation_failed', { message: parsed.error.message });
    }
    const { event } = parsed.data;

    // Everything below is a HANDOFF, not an entitlement decision.
    //
    // This function holds no user JWT and — by CLAUDE.md rule 1 — no
    // service-role key, so it cannot write `subscriptions` itself. It records
    // the event in an inbox and services/worker (which does hold the key)
    // reconciles it.
    //
    // Critically, the worker must RE-FETCH subscriber state from the RevenueCat
    // REST API before applying anything. The payload stored here is untrusted
    // input, which is what makes a forged inbox row harmless: the worst it can
    // do is trigger a redundant reconciliation of an account whose real state
    // is then read from RevenueCat anyway.
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await supabase.rpc('enqueue_revenuecat_event', {
      p_event_id: event.id,
      p_app_user_id: event.app_user_id,
      p_event_type: event.type,
      p_environment: event.environment.toLowerCase(),
      p_payload: parsed.data as unknown as Json,
      // deno-lint-ignore no-explicit-any
    } as any);

    if (error) throw error;

    // Acknowledge fast. RevenueCat retries on non-2xx, and redelivery is safe:
    // the inbox is unique on event_id and conflicts are a no-op.
    return ok({});
  }),
);
