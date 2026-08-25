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
import type { Database } from '@papercub/shared';
import { requireServiceSecret } from '../_shared/auth.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

type SubscriptionStatus =
  | 'none' | 'active' | 'in_grace_period' | 'in_billing_retry' | 'expired' | 'revoked' | 'paused';

function mapStatus(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'TRANSFER':
    case 'SUBSCRIPTION_EXTENDED':
    case 'REFUND_REVERSED':
    case 'CANCELLATION': // auto-renew off, still entitled until expiry.
      return 'active';
    case 'EXPIRATION':
      return 'expired';
    case 'BILLING_ISSUE':
      return 'in_billing_retry';
    case 'SUBSCRIPTION_PAUSED':
      return 'paused';
    case 'NON_RENEWING_PURCHASE':
      return 'active';
    case 'TEST':
      return null; // acknowledged, no state change.
    default:
      return null;
  }
}

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

    const status = mapStatus(event.type);
    if (status === null) {
      // TEST events and anything we don't map yet: acknowledge, no write.
      return ok({});
    }

    const isTopup = event.product_id === 'papercub_topup_3';
    const isFamilyProduct =
      event.product_id === 'papercub_family_monthly' || event.product_id === 'papercub_family_annual';

    // No user JWT exists on this request at all (server-to-server, header
    // secret only) — use a bare anon-key client, never the service-role key.
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const parentId = event.app_user_id;
    let tier: 'free' | 'family' = 'free';
    if (isFamilyProduct) {
      tier = 'family';
    } else if (isTopup) {
      // Top-ups don't change tier; preserve whatever's on record.
      const { data: existing } = await supabase
        .from('subscriptions')
        .select('tier')
        .eq('parent_id', parentId)
        .maybeSingle();
      tier = existing?.tier ?? 'free';
    }

    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
    const renewsAt = status === 'active' ? expiresAt : null;

    // The generated Database['...']['Functions'] Args types don't mark these
    // as nullable even though the underlying SQL function's params genuinely
    // accept NULL (see the migration) — cast rather than fight the generator.
    const { error } = await supabase.rpc('apply_revenuecat_event', {
      p_parent_id: parentId,
      p_product_id: event.product_id ?? null,
      p_tier: tier,
      p_status: status,
      p_renews_at: renewsAt,
      p_expires_at: expiresAt,
      p_original_transaction_id: event.original_transaction_id ?? null,
      p_revenuecat_app_user_id: event.app_user_id,
      p_environment: event.environment.toLowerCase(),
      p_is_topup: isTopup,
      // deno-lint-ignore no-explicit-any
    } as any);

    if (error) {
      if (error.code === '42501') {
        throw new ApiFailure('internal', {
          message:
            'apply_revenuecat_event insert blocked by grants: only service_role may execute it, and ' +
            'this Edge Function does not hold SUPABASE_SERVICE_ROLE_KEY (CLAUDE.md rule 1). Needs a B1 ' +
            'migration granting a role this function can act as.',
          retryable: false,
        });
      }
      throw error;
    }

    return ok({});
  }),
);
