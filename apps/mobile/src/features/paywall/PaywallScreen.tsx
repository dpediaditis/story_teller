import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { PRODUCTS, QUOTA, type ProductId } from '@papercub/shared';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { __mockSetEntitlement, apiClient } from '../../lib/api';
import { colour, inkAlpha, radius, spacing } from '../../theme';

const FEATURES = [
  `${QUOTA.family.storiesPerPeriod} stories a month`,
  `${QUOTA.family.charactersTotal} saved characters`,
  'Short, normal and bedtime lengths',
  'Read-aloud narration',
  'PDF export, for printing and keeping',
];

interface PaywallScreenProps {
  variant: 'after-first-story' | 'quota-reached';
  storyTitle?: string;
}

/** F1 / F2 — Paywall. Copy is the DECISIONS.md §4-revised set, not the design's original draft. */
export function PaywallScreen({ variant, storyTitle }: PaywallScreenProps) {
  const [plan, setPlan] = useState<ProductId>('papercub_family_annual');
  const [purchasing, setPurchasing] = useState(false);

  async function subscribe() {
    setPurchasing(true);
    try {
      // RevenueCat is not used in the mock — DECISIONS.md §8 keeps the server
      // authoritative; this just flips the demo entitlement locally.
      __mockSetEntitlement('family');
      await apiClient.call('refreshEntitlement', undefined);
    } finally {
      setPurchasing(false);
      router.back();
    }
  }

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
            <Text variant="sectionHeading" style={{ marginTop: spacing.xs }}>You've used your free story.</Text>
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.lgPlus }}>
              Everything already made stays readable — subscribe and carry on tonight.
            </Text>
            <View style={styles.usedRow}>
              <Text variant="label">1/1 · Free story used</Text>
              <Text variant="label" color={inkAlpha.textLabel}>Does not renew</Text>
            </View>
          </>
        )}

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
      </View>

      <View style={styles.footer}>
        <Button label={`Subscribe ${plan === 'papercub_family_annual' ? 'yearly' : 'monthly'}`} onPress={subscribe} loading={purchasing} />
        {variant === 'quota-reached' ? (
          <Button label="Read something we already made" kind="ghost" onPress={() => router.replace('/tabs')} />
        ) : null}
        <View style={styles.legalRow}>
          <Text variant="captionMono" color={inkAlpha.textLabel}>Restore Purchases</Text>
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
  footer: { padding: spacing.xxl, gap: spacing.sm },
  legalRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lgPlus, marginTop: spacing.sm },
});
