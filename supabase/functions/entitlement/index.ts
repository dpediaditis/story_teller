// POST /entitlement (refreshEntitlement). contract.ts: endpoints.refreshEntitlement.
// auth: 'user'. request: z.void() — no body.
//
// "Client asks the server to re-read RevenueCat after a purchase completes.
// This is a HINT to reconcile, not an assertion of entitlement" (contract.ts).
// The server's subscriptions table is kept current by revenuecat-webhook
// (apply_revenuecat_event), which is the actual source of truth per
// DECISIONS.md §8. This endpoint returns that authoritative state.
//
// NOTE: it does not itself call RevenueCat's server API to force a fetch —
// that would need REVENUECAT_SECRET_API_KEY server-to-server, which is a
// reasonable future enhancement (poll RevenueCat, upsert via
// apply_revenuecat_event if the webhook hasn't landed yet) but is out of
// scope for this pass; flagged in this agent's handover report.

import { requireUser } from '../_shared/auth.ts';
import { loadEntitlementAndQuota } from '../_shared/quota.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }
    const { supabase, userId } = await requireUser(req);
    const { entitlement, quota } = await loadEntitlementAndQuota(supabase, userId);
    return ok({ entitlement, quota });
  }),
);
