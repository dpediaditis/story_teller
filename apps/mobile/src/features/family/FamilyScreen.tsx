import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, EyebrowLabel } from '../../components';
import { useSession } from '../session/SessionProvider';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** F4 — Family. Parent-only zone; entry to the parental gate for anything destructive. */
export function FamilyScreen() {
  const { session } = useSession();
  const entitlement = session?.entitlement;
  const quota = session?.quota;
  const isFamily = entitlement?.tier === 'family';

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="sectionHeading">Family</Text>
      </View>

      <View style={styles.body}>
        {isFamily ? (
          <View style={styles.subCard}>
            <View style={{ flex: 1 }}>
              <EyebrowLabel color="rgba(246,241,231,.55)">SUBSCRIPTION</EyebrowLabel>
              <Text variant="label" color={colour.paperElevated} style={{ marginTop: spacing.sm, fontSize: 19 }}>
                Papercub Family
              </Text>
              {quota?.periodEnd ? (
                <Text variant="body" color="rgba(246,241,231,.65)" style={{ marginTop: spacing.xs, fontSize: 13 }}>
                  Renews {new Date(quota.periodEnd).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
            <View style={styles.activePill}>
              <Text variant="label" color={colour.paperElevated}>Active</Text>
            </View>
          </View>
        ) : (
          <Pressable style={styles.upsellCard} onPress={() => router.push('/paywall/after-first-story')}>
            <EyebrowLabel>FREE</EyebrowLabel>
            <Text variant="body" style={{ marginTop: spacing.xs }}>
              Subscribe for 5 stories a month, narration and PDF export.
            </Text>
          </Pressable>
        )}

        {quota ? (
          <View style={styles.row}>
            <Text variant="body">Stories this period</Text>
            <Text variant="label">{quota.storiesUsed} of {quota.storiesLimit}</Text>
          </View>
        ) : null}

        <EyebrowLabel style={styles.sectionLabel}>CHILDREN</EyebrowLabel>
        {(session?.children ?? []).map((child) => (
          <View key={child.id} style={styles.childRow}>
            <View style={styles.avatar}>
              <Text variant="label" color={colour.violetDeep}>
                {(child.displayName ?? '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: '700' }}>{child.displayName ?? 'Unnamed'}</Text>
              <Text variant="label" color={inkAlpha.textLabel}>
                {child.ageBand.replace('_', '–')}
              </Text>
            </View>
            <Text variant="button" color={inkAlpha.textFaint}>›</Text>
          </View>
        ))}

        <EyebrowLabel style={styles.sectionLabel}>SETTINGS</EyebrowLabel>
        <SettingsRow label="Privacy & data" onPress={() => router.push('/tabs/family/privacy')} />
        <SettingsRow label="Manage subscription" onPress={() => {}} />
        <SettingsRow label="Account & sign-in" onPress={() => router.push('/tabs/family/account')} />
        <SettingsRow label="Help & support" onPress={() => {}} />
      </View>
    </Screen>
  );
}

function SettingsRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.settingsRow} onPress={onPress}>
      <Text variant="body">{label}</Text>
      <Text variant="button" color={inkAlpha.textFaint}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.md, paddingBottom: spacing.lgPlus },
  body: { paddingHorizontal: spacing.xxl, gap: spacing.md },
  subCard: {
    flexDirection: 'row',
    backgroundColor: colour.ink,
    borderRadius: radius.cardLg,
    padding: spacing.huge,
    alignItems: 'flex-start',
  },
  activePill: { backgroundColor: 'rgba(246,241,231,0.16)', paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  upsellCard: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  sectionLabel: { marginTop: spacing.huge, marginBottom: spacing.xs },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lgPlus,
    borderTopWidth: 1,
    borderTopColor: inkAlpha.hairline,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colour.violetTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.lgPlus,
    borderTopWidth: 1,
    borderTopColor: inkAlpha.hairline,
  },
});
