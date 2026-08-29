import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname, useLocalSearchParams } from 'expo-router';
import { PRODUCTS, QUOTA, type ProductId } from '@papercub/shared';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { apiClient, ApiCallError, errorCopy } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useSession } from '../session/SessionProvider';
import { purchasesClient, type Offerings, type PurchaseFailureReason, type PurchasePackage } from '../../lib/purchases';
import { colour, inkAlpha, radius, spacing } from '../../theme';

const FEATURES = [
  `${QUOTA.family.storiesPerPeriod} stories a month`,
  `${QUOTA.family.charactersTotal} saved characters`,
  'Short, normal and bedtime lengths',
  'Read-aloud narration',
  // Named, because a locked voice on the confirm screen is one of the routes
  // into this paywall — landing here with no mention of voices makes the tap
  // look like it went nowhere.
  'Five more reading voices',
  'PDF export, for printing and keeping',
];

interface PaywallScreenProps {
  variant: 'after-first-story' | 'quota-reached';
  storyTitle?: string;
}

/** Local, in-screen state — never a substitute for the server's `EntitlementSnapshot`. */
type ScreenState =
  | { kind: 'idle' }
  | { kind: 'purchasing' }
  | { kind: 'restoring' }
  | { kind: 'reconciling' }
  | { kind: 'pending' }
  | { kind: 'nothingToRestore' }
  | { kind: 'error'; message: string; retryable: boolean };

/** `PurchaseFailureReason` -> copy. Our own domain, not an `ApiError.copyKey`, so plain strings are fine here. */
function purchaseFailureCopy(reason: PurchaseFailureReason): { message: string; retryable: boolean } {
  switch (reason) {
    case 'network_error':
      return { message: "Couldn't reach the App Store. Check your connection and try again.", retryable: true };
    case 'store_unavailable':
      return { message: 'The App Store is unavailable right now. Try again shortly.', retryable: true };
    case 'not_allowed':
      return { message: 'Purchases are turned off on this device (Screen Time restrictions).', retryable: false };
    case 'already_subscribed':
      return { message: 'This App Store account already has Papercub Family.', retryable: false };
    case 'unknown':
    default:
      return { message: "That didn't go through. Try again.", retryable: true };
  }
}

/** F1 / F2 — Paywall. Copy is the DECISIONS.md §4-revised set, not the design's original draft. */
export function PaywallScreen({ variant, storyTitle }: PaywallScreenProps) {
  const [plan, setPlan] = useState<ProductId>('papercub_family_annual');
  const [state, setState] = useState<ScreenState>({ kind: 'idle' });
  const [offerings, setOfferings] = useState<Offerings>({ loaded: false, packages: [] });

  const { session, refresh: refreshSession } = useSession();
  const { supabaseSession } = useAuth();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ gated?: string; intent?: string }>();
  const gatePassed = params.gated === '1';
  const ranGatedIntent = useRef(false);

  const isSubscriber = session?.entitlement.tier === 'family';

  // Identify the RevenueCat app user id as our own Supabase parent uid
  // (brief item 2 / DECISIONS.md §8) before doing anything else store-side.
  // Real Supabase auth uid wins when it exists; the mock session's parentId
  // is a reasonable stand-in in Expo-Go-only preview, where there is no real
  // Supabase auth session at all (DECISIONS.md §13).
  const parentUid = supabaseSession?.user?.id ?? session?.parentId ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (parentUid) {
        await purchasesClient.identify(parentUid);
      }
      const o = await purchasesClient.getOfferings();
      if (!cancelled) setOfferings(o);
    })();
    return () => {
      cancelled = true;
    };
  }, [parentUid]);

  /** Ask the server what's actually true. Never skipped after a purchase/restore, purchased or not. */
  const reconcile = useCallback(async () => {
    setState({ kind: 'reconciling' });
    try {
      await apiClient.call('refreshEntitlement', undefined);
      await refreshSession();
      setState({ kind: 'idle' });
      return true;
    } catch (err) {
      const copyKey = err instanceof ApiCallError ? err.apiError.copyKey : undefined;
      const retryable = err instanceof ApiCallError ? err.apiError.retryable : true;
      setState({ kind: 'error', message: errorCopy(copyKey), retryable });
      return false;
    }
  }, [refreshSession]);

  const runPurchase = useCallback(
    async (pkg: PurchasePackage) => {
      setState({ kind: 'purchasing' });
      const outcome = await purchasesClient.purchasePackage(pkg);
      switch (outcome.status) {
        case 'purchased': {
          const ok = await reconcile();
          if (ok) router.back();
          return;
        }
        case 'pending':
          // Ask to Buy / bank confirmation still in flight. Not entitled yet,
          // not an error — reconcile now in case a fast webhook already
          // landed, but keep the user on a "waiting" state either way.
          await reconcile();
          setState({ kind: 'pending' });
          return;
        case 'cancelled':
          setState({ kind: 'idle' });
          return;
        case 'failed': {
          if (outcome.reason === 'already_subscribed') {
            // Nothing was charged twice — reconcile picks up whatever the
            // server already has (this is exactly the Family Sharing case:
            // a second parent whose device already carries the entitlement).
            const ok = await reconcile();
            if (ok) router.back();
            return;
          }
          const copy = purchaseFailureCopy(outcome.reason);
          setState({ kind: 'error', message: copy.message, retryable: copy.retryable });
          return;
        }
        default:
          setState({ kind: 'idle' });
      }
    },
    [reconcile],
  );

  const runRestore = useCallback(async () => {
    setState({ kind: 'restoring' });
    const outcome = await purchasesClient.restorePurchases();
    switch (outcome.status) {
      case 'purchased': {
        const ok = await reconcile();
        if (ok) router.back();
        return;
      }
      case 'nothing_to_restore':
        setState({ kind: 'nothingToRestore' });
        return;
      case 'cancelled':
        setState({ kind: 'idle' });
        return;
      case 'failed': {
        const copy = purchaseFailureCopy(outcome.reason);
        setState({ kind: 'error', message: copy.message, retryable: copy.retryable });
        return;
      }
      default:
        setState({ kind: 'idle' });
    }
  }, [reconcile]);

  // Parental gate: a child must never be able to trigger a purchase. Tapping
  // Subscribe/Restore before the gate is passed sends the parent through
  // `/parental-gate`, which redirects back here with `gated=1` — at which
  // point the originally-requested action runs once, automatically.
  useEffect(() => {
    if (!gatePassed || ranGatedIntent.current) return;
    ranGatedIntent.current = true;
    if (params.intent === 'restore') {
      void runRestore();
    } else if (params.intent === 'subscribe') {
      const pkg = offerings.packages.find((p) => p.productId === plan);
      if (pkg) void runPurchase(pkg);
      else setState({ kind: 'error', message: purchaseFailureCopy('store_unavailable').message, retryable: true });
    } else if (params.intent === 'topup') {
      const pkg = offerings.packages.find((p) => p.productId === 'papercub_topup_3');
      if (pkg) void runPurchase(pkg);
      else setState({ kind: 'error', message: purchaseFailureCopy('store_unavailable').message, retryable: true });
    }
    // offerings may still be loading on first render; re-run once it lands.
  }, [gatePassed, params.intent, offerings, plan, runPurchase, runRestore]);

  function requestGate(intent: 'subscribe' | 'restore' | 'topup') {
    const redirect = `${pathname}?gated=1&intent=${intent}`;
    router.push(`/parental-gate?redirect=${encodeURIComponent(redirect)}`);
  }

  function onSubscribePress() {
    setState({ kind: 'idle' });
    if (!gatePassed) {
      requestGate('subscribe');
      return;
    }
    const pkg = offerings.packages.find((p) => p.productId === plan);
    if (!pkg) {
      setState({ kind: 'error', ...purchaseFailureCopy('store_unavailable') });
      return;
    }
    void runPurchase(pkg);
  }

  function onTopupPress() {
    setState({ kind: 'idle' });
    if (!gatePassed) {
      requestGate('topup');
      return;
    }
    const pkg = offerings.packages.find((p) => p.productId === 'papercub_topup_3');
    if (!pkg) {
      setState({ kind: 'error', ...purchaseFailureCopy('store_unavailable') });
      return;
    }
    void runPurchase(pkg);
  }

  function onRestorePress() {
    setState({ kind: 'idle' });
    if (!gatePassed) {
      requestGate('restore');
      return;
    }
    void runRestore();
  }

  const busy = state.kind === 'purchasing' || state.kind === 'restoring' || state.kind === 'reconciling';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.closeBtn}>
          <Text variant="button">×</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {variant === 'after-first-story' ? (
          <>
            <EyebrowLabel>YOU MADE</EyebrowLabel>
            <Text variant="sectionHeading" style={{ marginTop: spacing.xs }}>{storyTitle ?? 'a story'}</Text>
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.lgPlus }}>
              Keep making them. Papercub Family, one subscription for the whole household.
            </Text>
          </>
        ) : (
          <>
            <EyebrowLabel>FOR THE GROWN-UP</EyebrowLabel>
            <Text variant="sectionHeading" style={{ marginTop: spacing.xs }}>
              {isSubscriber ? "That's all your stories for this period." : "You've used your free story."}
            </Text>
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.lgPlus }}>
              {isSubscriber
                ? 'Top up now, or wait for your quota to reset.'
                : 'Everything already made stays readable — subscribe and carry on tonight.'}
            </Text>
            {!isSubscriber ? (
              <View style={styles.usedRow}>
                <Text variant="label">1/1 · Free story used</Text>
                <Text variant="label" color={inkAlpha.textLabel}>Does not renew</Text>
              </View>
            ) : null}
          </>
        )}

        {isSubscriber && variant === 'quota-reached' ? (
          <View style={styles.topupCard}>
            <Text variant="label">Top up</Text>
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.xs }}>
              +3 stories, no expiry. For subscribers only.
            </Text>
            <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>
              {PRODUCTS.papercub_topup_3.displayPriceEUR}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.features}>
              {FEATURES.map((f) => (
                <Text key={f} variant="body" color={inkAlpha.textBody} style={styles.featureLine}>
                  ✓ {f}
                </Text>
              ))}
            </View>

            <View style={styles.plans}>
              <PlanCard
                label="Yearly"
                price={PRODUCTS.papercub_family_annual.displayPriceEUR}
                badge="SAVE 17%"
                selected={plan === 'papercub_family_annual'}
                onPress={() => setPlan('papercub_family_annual')}
              />
              <PlanCard
                label="Monthly"
                price={PRODUCTS.papercub_family_monthly.displayPriceEUR}
                selected={plan === 'papercub_family_monthly'}
                onPress={() => setPlan('papercub_family_monthly')}
              />
            </View>
            <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.sm }}>
              Cancel any time
            </Text>
          </>
        )}

        {state.kind === 'pending' ? (
          <View style={styles.banner}>
            <Text variant="label" color={colour.warningDeep}>Waiting for approval — this can take a moment.</Text>
          </View>
        ) : null}
        {state.kind === 'nothingToRestore' ? (
          <View style={styles.banner}>
            <Text variant="label" color={inkAlpha.textBody}>No previous purchase found on this account.</Text>
          </View>
        ) : null}
        {state.kind === 'error' ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Text variant="label" color={colour.danger}>{state.message}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {isSubscriber && variant === 'quota-reached' ? (
          <Button label="Buy 3 more stories" onPress={onTopupPress} loading={busy} />
        ) : (
          <Button
            label={`Subscribe ${plan === 'papercub_family_annual' ? 'yearly' : 'monthly'}`}
            onPress={onSubscribePress}
            loading={busy}
          />
        )}
        {variant === 'quota-reached' ? (
          <Button label="Read something we already made" kind="ghost" onPress={() => router.replace('/tabs')} disabled={busy} />
        ) : null}
        <View style={styles.legalRow}>
          <Pressable hitSlop={8} onPress={onRestorePress} disabled={busy}>
            {state.kind === 'restoring' ? (
              <ActivityIndicator size="small" color={colour.ink} />
            ) : (
              <Text variant="captionMono" color={inkAlpha.textLabel}>Restore Purchases</Text>
            )}
          </Pressable>
          <Text variant="captionMono" color={inkAlpha.textLabel}>Terms</Text>
          <Text variant="captionMono" color={inkAlpha.textLabel}>Privacy</Text>
        </View>
      </View>
    </Screen>
  );
}

function PlanCard({
  label,
  price,
  badge,
  selected,
  onPress,
}: {
  label: string;
  price: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.planCard, selected && styles.planCardSelected]}>
      {badge ? (
        <View style={styles.badge}>
          <Text variant="label" color={colour.paperElevated} style={{ fontSize: 10.5 }}>{badge}</Text>
        </View>
      ) : null}
      <Text variant="label">{label}</Text>
      <Text variant="body" color={inkAlpha.textBody}>{price}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.xxl },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: inkAlpha.divider, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: spacing.xxl },
  usedRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lgPlus },
  features: { marginTop: spacing.section, gap: spacing.sm },
  featureLine: {},
  plans: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.section },
  planCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.card,
    padding: spacing.lgPlus,
  },
  planCardSelected: { borderColor: colour.violet, backgroundColor: colour.violetTint },
  badge: { alignSelf: 'flex-start', backgroundColor: colour.warning, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs },
  topupCard: {
    marginTop: spacing.section,
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.card,
    padding: spacing.lgPlus,
  },
  banner: { marginTop: spacing.lgPlus, padding: spacing.md, borderRadius: radius.card, backgroundColor: inkAlpha.divider },
  bannerError: { backgroundColor: 'rgba(168,65,47,0.12)' },
  footer: { padding: spacing.xxl, gap: spacing.sm },
  legalRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lgPlus, marginTop: spacing.sm },
});
