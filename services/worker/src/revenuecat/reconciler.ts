/**
 * The RevenueCat reconciler.
 *
 * THE STORED PAYLOAD IS UNTRUSTED. The migration that created
 * `revenuecat_event_inbox` says so in a table comment, and the reason is
 * structural: the webhook Edge Function holds no service-role key and no user
 * JWT, so it authenticates with a shared secret and writes through a
 * security-definer function granted to `anon`. If that secret ever leaked,
 * anyone could put a row in the inbox claiming any entitlement for any account.
 *
 * So a row here is a HINT THAT SOMETHING CHANGED, nothing more. For every row
 * we re-fetch the subscriber from the RevenueCat REST API with
 * REVENUECAT_SECRET_API_KEY and apply THAT. A forged row can then at most cause
 * a redundant reconciliation of an account whose real state we then read
 * anyway — DECISIONS.md §8: "RevenueCat is not an authorization source."
 *
 * TOP-UPS AND AT-MOST-ONCE. `apply_revenuecat_event(p_is_topup => true)` ADDS
 * three stories; it is not idempotent by design, because top-ups accumulate
 * (DECISIONS.md §1). That makes a retry of a top-up a free-stories bug, so a
 * top-up grant is claimed BEFORE it is applied and never retried on an
 * ambiguous outcome. The bias is deliberate: a top-up that needs a manual
 * re-grant is a support ticket, a top-up granted twice on every retry is a hole
 * in the paywall.
 */

import type {
  EntitlementTier,
  ProductId,
  StoreEnvironment,
  SubscriptionStatus,
} from '@papercub/shared';
import type { Logger } from '../logger';

export interface InboxRow {
  id: string;
  eventId: string;
  appUserId: string;
  eventType: string;
  environment: string;
  attempts: number;
}

/** What the reconciler needs from the database. */
export interface EntitlementStore {
  /** Unprocessed rows, oldest first, respecting the backoff schedule. */
  claimPending(limit: number): Promise<InboxRow[]>;
  markProcessed(id: string): Promise<void>;
  /** Records the failure and releases the row for another attempt. */
  recordFailure(id: string, error: string, retryable: boolean): Promise<void>;
  applyEntitlement(args: ApplyEntitlementArgs): Promise<void>;
}

export interface ApplyEntitlementArgs {
  parentId: string;
  productId: ProductId;
  tier: EntitlementTier;
  status: SubscriptionStatus;
  renewsAt: string | null;
  expiresAt: string | null;
  originalTransactionId: string | null;
  revenuecatAppUserId: string;
  environment: StoreEnvironment;
  isTopup: boolean;
  /** Store transaction ids for confirmed top-ups. Only unseen ones grant. */
  topupTransactionIds: string[];
}

/* ── The RevenueCat REST client ───────────────────────────────────────── */

export interface RevenueCatSubscriber {
  subscriber?: {
    original_app_user_id?: string;
    entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>;
    subscriptions?: Record<
      string,
      {
        expires_date?: string | null;
        purchase_date?: string;
        period_type?: string;
        store?: string;
        unsubscribe_detected_at?: string | null;
        billing_issues_detected_at?: string | null;
        refunded_at?: string | null;
        original_purchase_date?: string;
        is_sandbox?: boolean;
      }
    >;
    non_subscriptions?: Record<
      string,
      { id?: string; purchase_date?: string; store?: string; is_sandbox?: boolean }[]
    >;
  };
}

export interface RevenueCatClient {
  fetchSubscriber(appUserId: string): Promise<RevenueCatSubscriber>;
}

export class RevenueCatUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevenueCatUnavailable';
  }
}

export function createRevenueCatClient(opts: {
  secretApiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): RevenueCatClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  return {
    async fetchSubscriber(appUserId: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(
          `${opts.baseUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`,
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${opts.secretApiKey}`,
              'content-type': 'application/json',
            },
            signal: controller.signal,
          },
        );
        if (res.status >= 500 || res.status === 429) {
          throw new RevenueCatUnavailable(`RevenueCat returned ${res.status}`);
        }
        if (!res.ok) {
          throw new Error(`RevenueCat returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
        return (await res.json()) as RevenueCatSubscriber;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ── Mapping ──────────────────────────────────────────────────────────── */

const SUBSCRIPTION_PRODUCTS: ProductId[] = ['papercub_family_monthly', 'papercub_family_annual'];
const TOPUP_PRODUCT: ProductId = 'papercub_topup_3';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Turns the subscriber snapshot into the entitlement we will store.
 *
 * Only OUR product ids are considered. RevenueCat will happily report products
 * from any app configured against the same account, and a product we do not
 * recognise must never map to a tier.
 */
export function mapSubscriberToEntitlement(
  parentId: string,
  appUserId: string,
  snapshot: RevenueCatSubscriber,
  environment: StoreEnvironment,
): Omit<ApplyEntitlementArgs, 'isTopup' | 'topupTransactionIds'> | null {
  const subs = snapshot.subscriber?.subscriptions ?? {};
  const now = Date.now();

  let best: { productId: ProductId; expiresMs: number; entry: (typeof subs)[string] } | null = null;

  for (const productId of SUBSCRIPTION_PRODUCTS) {
    const entry = subs[productId];
    if (!entry) continue;
    const expiresMs = entry.expires_date ? Date.parse(entry.expires_date) : Number.POSITIVE_INFINITY;
    if (!best || expiresMs > best.expiresMs) best = { productId, expiresMs, entry };
  }

  if (!best) return null;

  const { entry, productId, expiresMs } = best;

  let status: SubscriptionStatus;
  if (entry.refunded_at) {
    status = 'revoked';
  } else if (expiresMs < now) {
    status = 'expired';
  } else if (entry.billing_issues_detected_at) {
    // Still inside the entitlement window with a billing problem: grace period.
    status = 'in_grace_period';
  } else if (entry.unsubscribe_detected_at) {
    // Cancelled but paid up. They keep what they bought until it runs out.
    status = 'active';
  } else {
    status = 'active';
  }

  // Only a genuinely active subscription grants the family tier. Grace period
  // deliberately keeps it — we do not take a paying family's library away over
  // a card that needs updating.
  const tier: EntitlementTier =
    status === 'active' || status === 'in_grace_period' ? 'family' : 'free';

  const expiresAt = entry.expires_date ?? null;

  return {
    parentId,
    productId,
    tier,
    status,
    // renews_at is meaningful only while the subscription will actually renew.
    renewsAt: status === 'active' && !entry.unsubscribe_detected_at ? expiresAt : null,
    expiresAt,
    originalTransactionId: null,
    revenuecatAppUserId: appUserId,
    environment,
  };
}

/**
 * WHICH top-up purchases RevenueCat confirms — not merely whether any exist.
 *
 * DECISIONS.md §15 finding 5: this used to return a boolean, so replaying one
 * genuine NON_RENEWING_PURCHASE event granted three more stories every time it
 * arrived. A subscription is a snapshot and re-applying it is idempotent; a
 * top-up is an INCREMENT, and "has ever bought one" is not a fact you can
 * safely increment on.
 *
 * The store's own transaction ids go to `apply_revenuecat_event`, which grants
 * only the ones it has not seen — enforced by a primary key on
 * `topup_grants.transaction_id`, so a replay grants exactly zero regardless of
 * what this function or the reconciler get wrong.
 */
export function confirmedTopupTransactionIds(snapshot: RevenueCatSubscriber): string[] {
  const purchases = snapshot.subscriber?.non_subscriptions?.[TOPUP_PRODUCT] ?? [];
  return purchases
    .map((p) => p.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** Kept as a thin predicate over the ids above, for the event-type check. */
export function confirmsTopup(snapshot: RevenueCatSubscriber): boolean {
  return confirmedTopupTransactionIds(snapshot).length > 0;
}

/* ── The reconciler ───────────────────────────────────────────────────── */

export interface ReconcilerOptions {
  store: EntitlementStore;
  client: RevenueCatClient;
  logger: Logger;
  batchSize?: number;
  maxAttempts?: number;
}

export interface ReconcileResult {
  processed: number;
  failed: number;
  skipped: number;
}

export async function reconcileOnce(opts: ReconcilerOptions): Promise<ReconcileResult> {
  const { store, client, logger } = opts;
  const batchSize = opts.batchSize ?? 20;
  const maxAttempts = opts.maxAttempts ?? 5;

  const rows = await store.claimPending(batchSize);
  const result: ReconcileResult = { processed: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    // app_user_id is expected to BE the Supabase auth uid (how the app
    // configures RevenueCat). Anything else is not an account we can apply to,
    // and guessing would be exactly the "trust the payload" mistake.
    if (!isUuid(row.appUserId)) {
      await store.recordFailure(row.id, 'app_user_id is not a Supabase uid', false);
      result.skipped += 1;
      continue;
    }

    const environment: StoreEnvironment =
      row.environment.toUpperCase() === 'PRODUCTION' ? 'production' : 'sandbox';

    let snapshot: RevenueCatSubscriber;
    try {
      snapshot = await client.fetchSubscriber(row.appUserId);
    } catch (err) {
      const retryable = err instanceof RevenueCatUnavailable && row.attempts + 1 < maxAttempts;
      const reason = err instanceof Error ? err.message : String(err);
      // Nothing has been granted, so this is always safe to retry.
      await store.recordFailure(row.id, `fetch failed: ${reason}`, retryable);
      result.failed += 1;
      logger.warn('revenuecat fetch failed', { eventId: row.eventId, retryable, reason });
      continue;
    }

    const topupTransactionIds = confirmedTopupTransactionIds(snapshot);
    const isTopup = topupTransactionIds.length > 0 && row.eventType === 'NON_RENEWING_PURCHASE';

    const entitlement = mapSubscriberToEntitlement(
      row.appUserId,
      row.appUserId,
      snapshot,
      environment,
    );

    if (!entitlement && !isTopup) {
      // The subscriber holds none of our products. Nothing to apply — and
      // importantly, nothing to fail either: this is the correct outcome for a
      // TEST event or a webhook about a product from another app.
      await store.markProcessed(row.id);
      result.skipped += 1;
      logger.info('revenuecat event carried no applicable entitlement', { eventId: row.eventId });
      continue;
    }

    if (isTopup) {
      // AT-MOST-ONCE. Claim before applying: an ambiguous outcome must not be
      // retried, because the retry would grant three more stories. See header.
      await store.markProcessed(row.id);
      try {
        await store.applyEntitlement({
          ...(entitlement ?? {
            parentId: row.appUserId,
            productId: TOPUP_PRODUCT,
            tier: 'family',
            status: 'active',
            renewsAt: null,
            expiresAt: null,
            originalTransactionId: null,
            revenuecatAppUserId: row.appUserId,
            environment,
          }),
          productId: TOPUP_PRODUCT,
          isTopup: true,
          // The database decides how many of these are new. Sending the whole
          // confirmed set every pass is deliberate: it is self-healing if a
          // previous pass died between claiming the row and granting.
          topupTransactionIds,
        });
        result.processed += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Left processed on purpose. Recorded loudly so it can be re-granted
        // by hand rather than silently re-granted three times by a retry loop.
        await store.recordFailure(row.id, `topup apply failed, NOT retried: ${reason}`, false);
        result.failed += 1;
        logger.error('revenuecat topup apply failed and will not be retried', {
          eventId: row.eventId,
          appUserId: row.appUserId,
          reason,
        });
      }
      continue;
    }

    try {
      await store.applyEntitlement({ ...entitlement!, isTopup: false, topupTransactionIds: [] });
      await store.markProcessed(row.id);
      result.processed += 1;
      logger.info('revenuecat entitlement applied', {
        eventId: row.eventId,
        tier: entitlement!.tier,
        status: entitlement!.status,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Subscription state is a SNAPSHOT — applying it twice is a no-op — so
      // this one is safe to retry.
      await store.recordFailure(row.id, `apply failed: ${reason}`, row.attempts + 1 < maxAttempts);
      result.failed += 1;
      logger.error('revenuecat apply failed', { eventId: row.eventId, reason });
    }
  }

  return result;
}

/** Exponential backoff between attempts, capped. Used by the SQL claim query. */
export function backoffSeconds(attempts: number): number {
  return Math.min(2 ** attempts * 30, 3600);
}
