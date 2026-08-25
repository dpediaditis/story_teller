/**
 * The RevenueCat reconciler. This is money: a bug here either grants a paid
 * tier to someone who did not pay, or grants top-up stories repeatedly.
 *
 * The two properties under test are the ones the migration's own comment calls
 * out: the stored payload is never applied directly, and a top-up is granted
 * at most once.
 */

import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../logger';
import { confirmsTopup, mapSubscriberToEntitlement, reconcileOnce } from '../revenuecat/reconciler';
import type {
  ApplyEntitlementArgs,
  EntitlementStore,
  InboxRow,
  RevenueCatClient,
  RevenueCatSubscriber,
} from '../revenuecat/reconciler';
import { RevenueCatUnavailable } from '../revenuecat/reconciler';

const PARENT = '88888888-8888-4888-8888-888888888888';

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 'inbox-1',
    eventId: 'evt-1',
    appUserId: PARENT,
    eventType: 'INITIAL_PURCHASE',
    environment: 'PRODUCTION',
    attempts: 0,
    ...overrides,
  };
}

function activeSubscriber(expiresInDays = 30): RevenueCatSubscriber {
  return {
    subscriber: {
      subscriptions: {
        papercub_family_monthly: {
          expires_date: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
          period_type: 'NORMAL',
          store: 'app_store',
        },
      },
    },
  };
}

function fakeStore(rows: InboxRow[]) {
  const applied: ApplyEntitlementArgs[] = [];
  const processed: string[] = [];
  const failures: { id: string; error: string; retryable: boolean }[] = [];
  let applyThrows: Error | null = null;

  const store: EntitlementStore = {
    async claimPending() {
      return rows;
    },
    async markProcessed(id) {
      processed.push(id);
    },
    async recordFailure(id, error, retryable) {
      failures.push({ id, error, retryable });
    },
    async applyEntitlement(args) {
      if (applyThrows) throw applyThrows;
      applied.push(args);
    },
  };

  return {
    store,
    applied,
    processed,
    failures,
    setApplyThrows(err: Error | null) {
      applyThrows = err;
    },
  };
}

function fakeClient(snapshot: RevenueCatSubscriber | Error): RevenueCatClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchSubscriber(appUserId) {
      calls.push(appUserId);
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    },
  };
}

describe('the stored payload is never trusted', () => {
  it('re-fetches subscriber state from RevenueCat for every row', async () => {
    const s = fakeStore([row()]);
    const client = fakeClient(activeSubscriber());

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(client.calls).toEqual([PARENT]);
    expect(s.applied).toHaveLength(1);
  });

  it('applies the FETCHED state, not the event type in the payload', async () => {
    // A forged inbox row claiming INITIAL_PURCHASE for an account that in fact
    // has nothing must grant nothing.
    const s = fakeStore([row({ eventType: 'INITIAL_PURCHASE' })]);
    const client = fakeClient({ subscriber: { subscriptions: {} } });

    const result = await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(s.applied).toHaveLength(0);
    expect(result.skipped).toBe(1);
    // Still marked processed: there is nothing to retry, the account genuinely
    // holds none of our products.
    expect(s.processed).toEqual(['inbox-1']);
  });

  it('refuses a row whose app_user_id is not a Supabase uid', async () => {
    const s = fakeStore([row({ appUserId: 'not-a-uuid' })]);
    const client = fakeClient(activeSubscriber());

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(client.calls).toHaveLength(0);
    expect(s.applied).toHaveLength(0);
    expect(s.failures[0]?.retryable).toBe(false);
  });

  it('ignores products that are not ours', async () => {
    const s = fakeStore([row()]);
    const client = fakeClient({
      subscriber: {
        subscriptions: {
          some_other_app_premium: { expires_date: new Date(Date.now() + 1e9).toISOString() },
        },
      },
    });

    await reconcileOnce({ store: s.store, client, logger: silentLogger });
    expect(s.applied).toHaveLength(0);
  });
});

describe('entitlement mapping', () => {
  it('maps an active subscription to the family tier', () => {
    const result = mapSubscriberToEntitlement(PARENT, PARENT, activeSubscriber(), 'production');
    expect(result).toMatchObject({ tier: 'family', status: 'active' });
  });

  it('maps an expired subscription to free', () => {
    const result = mapSubscriberToEntitlement(PARENT, PARENT, activeSubscriber(-1), 'production');
    expect(result).toMatchObject({ tier: 'free', status: 'expired' });
  });

  it('keeps the family tier during a billing grace period', () => {
    // We do not take a paying family's library away over a card that needs
    // updating.
    const snapshot: RevenueCatSubscriber = {
      subscriber: {
        subscriptions: {
          papercub_family_monthly: {
            expires_date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            billing_issues_detected_at: new Date().toISOString(),
          },
        },
      },
    };
    const result = mapSubscriberToEntitlement(PARENT, PARENT, snapshot, 'production');
    expect(result).toMatchObject({ tier: 'family', status: 'in_grace_period' });
  });

  it('revokes on a refund', () => {
    const snapshot: RevenueCatSubscriber = {
      subscriber: {
        subscriptions: {
          papercub_family_monthly: {
            expires_date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            refunded_at: new Date().toISOString(),
          },
        },
      },
    };
    const result = mapSubscriberToEntitlement(PARENT, PARENT, snapshot, 'production');
    expect(result).toMatchObject({ tier: 'free', status: 'revoked' });
  });

  it('keeps a cancelled-but-paid-up subscriber active with no renewal date', () => {
    const snapshot: RevenueCatSubscriber = {
      subscriber: {
        subscriptions: {
          papercub_family_monthly: {
            expires_date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            unsubscribe_detected_at: new Date().toISOString(),
          },
        },
      },
    };
    const result = mapSubscriberToEntitlement(PARENT, PARENT, snapshot, 'production');
    expect(result?.status).toBe('active');
    expect(result?.renewsAt).toBeNull();
    expect(result?.expiresAt).not.toBeNull();
  });
});

describe('top-ups are granted at most once', () => {
  const topupSnapshot: RevenueCatSubscriber = {
    subscriber: {
      subscriptions: {
        papercub_family_monthly: {
          expires_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      },
      non_subscriptions: {
        papercub_topup_3: [{ id: 'txn-1', purchase_date: new Date().toISOString() }],
      },
    },
  };

  it('grants a top-up only when RevenueCat itself confirms the purchase', () => {
    expect(confirmsTopup(topupSnapshot)).toBe(true);
    expect(confirmsTopup(activeSubscriber())).toBe(false);
  });

  it('does not grant a top-up on payload event type alone', async () => {
    // The row claims a top-up; RevenueCat says there is no such purchase.
    const s = fakeStore([row({ eventType: 'NON_RENEWING_PURCHASE' })]);
    const client = fakeClient(activeSubscriber());

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]!.isTopup).toBe(false);
  });

  it('claims the row BEFORE applying, so an ambiguous failure is never retried', async () => {
    // apply_revenuecat_event(is_topup) ADDS three stories — it is not
    // idempotent. A retry would grant three more. So the row is marked
    // processed first and a failure is recorded as non-retryable.
    const s = fakeStore([row({ eventType: 'NON_RENEWING_PURCHASE' })]);
    const client = fakeClient(topupSnapshot);
    const markProcessed = vi.spyOn(s.store, 'markProcessed');

    s.setApplyThrows(new Error('connection reset'));
    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(markProcessed).toHaveBeenCalledWith('inbox-1');
    expect(s.failures[0]?.retryable).toBe(false);
    expect(s.failures[0]?.error).toContain('NOT retried');
  });

  it('grants exactly one top-up on the happy path', async () => {
    const s = fakeStore([row({ eventType: 'NON_RENEWING_PURCHASE' })]);
    const client = fakeClient(topupSnapshot);

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    const topups = s.applied.filter((a) => a.isTopup);
    expect(topups).toHaveLength(1);
    expect(topups[0]!.productId).toBe('papercub_topup_3');
  });
});

describe('retries and backoff', () => {
  it('retries a transient RevenueCat outage', async () => {
    const s = fakeStore([row()]);
    const client = fakeClient(new RevenueCatUnavailable('RevenueCat returned 503'));

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(s.failures[0]?.retryable).toBe(true);
    expect(s.applied).toHaveLength(0);
  });

  it('stops retrying after the attempt limit', async () => {
    const s = fakeStore([row({ attempts: 5 })]);
    const client = fakeClient(new RevenueCatUnavailable('RevenueCat returned 503'));

    await reconcileOnce({ store: s.store, client, logger: silentLogger, maxAttempts: 5 });

    expect(s.failures[0]?.retryable).toBe(false);
  });

  it('retries a failed subscription apply — snapshots are idempotent', async () => {
    const s = fakeStore([row()]);
    const client = fakeClient(activeSubscriber());
    s.setApplyThrows(new Error('deadlock detected'));

    await reconcileOnce({ store: s.store, client, logger: silentLogger });

    expect(s.failures[0]?.retryable).toBe(true);
    // NOT marked processed: unlike a top-up, re-applying a subscription
    // snapshot changes nothing, so retrying is free.
    expect(s.processed).toHaveLength(0);
  });
});
