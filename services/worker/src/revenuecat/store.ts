/**
 * The Supabase-backed EntitlementStore.
 *
 * `revenuecat_event_inbox` has RLS enabled with NO policy at all, so this table
 * is reachable only by the service-role key — which is the point. The worker is
 * the only component that holds it.
 */

import type { ServiceClient } from '../db';
import { backoffSeconds } from './reconciler';
import type { ApplyEntitlementArgs, EntitlementStore, InboxRow } from './reconciler';

export function createEntitlementStore(client: ServiceClient): EntitlementStore {
  // The generated Database type does not describe the security-definer RPC
  // return shapes, and the inbox table's rows are read positionally here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as any;

  return {
    async claimPending(limit: number): Promise<InboxRow[]> {
      const { data, error } = await anyClient
        .from('revenuecat_event_inbox')
        .select('id, event_id, app_user_id, event_type, environment, attempts, received_at')
        .is('processed_at', null)
        .order('received_at', { ascending: true })
        .limit(limit);

      if (error) throw new Error(`revenuecat_event_inbox select failed: ${error.message}`);

      const now = Date.now();

      return (data ?? [])
        // Respect the backoff schedule. A row that failed a moment ago is not
        // due yet; hammering it just burns RevenueCat rate limit.
        .filter((row: { attempts: number; received_at: string }) => {
          if (row.attempts === 0) return true;
          const due = Date.parse(row.received_at) + backoffSeconds(row.attempts) * 1000;
          return now >= due;
        })
        .map(
          (row: {
            id: string;
            event_id: string;
            app_user_id: string;
            event_type: string;
            environment: string;
            attempts: number;
          }) => ({
            id: row.id,
            eventId: row.event_id,
            appUserId: row.app_user_id,
            eventType: row.event_type,
            environment: row.environment,
            attempts: row.attempts,
          }),
        );
    },

    async markProcessed(id: string) {
      const { error } = await anyClient
        .from('revenuecat_event_inbox')
        .update({ processed_at: new Date().toISOString(), last_error: null })
        .eq('id', id);
      if (error) throw new Error(`revenuecat_event_inbox mark processed failed: ${error.message}`);
    },

    async recordFailure(id: string, errorText: string, retryable: boolean) {
      const current = await anyClient
        .from('revenuecat_event_inbox')
        .select('attempts')
        .eq('id', id)
        .single();

      const attempts = (current.data?.attempts ?? 0) + 1;

      const patch: Record<string, unknown> = {
        attempts,
        last_error: errorText.slice(0, 2000),
      };
      // Not retryable: stamp processed_at so the loop stops picking it up. The
      // row stays in the table with its error for a human to look at.
      if (!retryable) patch.processed_at = new Date().toISOString();

      const { error } = await anyClient
        .from('revenuecat_event_inbox')
        .update(patch)
        .eq('id', id);
      if (error) throw new Error(`revenuecat_event_inbox failure update failed: ${error.message}`);
    },

    async applyEntitlement(args: ApplyEntitlementArgs) {
      const { error } = await anyClient.rpc('apply_revenuecat_event', {
        p_parent_id: args.parentId,
        p_product_id: args.productId,
        p_tier: args.tier,
        p_status: args.status,
        p_renews_at: args.renewsAt,
        p_expires_at: args.expiresAt,
        p_original_transaction_id: args.originalTransactionId,
        p_revenuecat_app_user_id: args.revenuecatAppUserId,
        p_environment: args.environment,
        p_is_topup: args.isTopup,
        p_topup_transaction_ids: args.topupTransactionIds ?? [],
      });
      if (error) throw new Error(`apply_revenuecat_event failed: ${error.message}`);
    },
  };
}
