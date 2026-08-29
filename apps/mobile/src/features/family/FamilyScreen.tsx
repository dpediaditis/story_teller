import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { ChildAvatar } from '@papercub/shared';
import { CHILD_AVATAR_EMOJI, CHILD_AVATAR_LIST } from '@papercub/shared';
import { Screen, Text, EyebrowLabel } from '../../components';
import { apiClient } from '../../lib/api';
import { useSession } from '../session/SessionProvider';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** F4 — Family. Parent-only zone; entry to the parental gate for anything destructive. */
export function FamilyScreen() {
  const { session, refresh } = useSession();
  const entitlement = session?.entitlement;
  const quota = session?.quota;
  const isFamily = entitlement?.tier === 'family';

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="sectionHeading">Family</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {isFamily ? (
          <View style={styles.subCard}>
            <View style={{ flex: 1 }}>
              <EyebrowLabel color="rgba(246,241,231,.55)">SUBSCRIPTION</EyebrowLabel>
              <Text
                variant="label"
                color={colour.paperElevated}
                /* fontSize alone leaves the variant's ~13px lineHeight in
                   place, so at 19px the plan name climbed into the
                   SUBSCRIPTION eyebrow above it. */
                style={{ marginTop: spacing.sm, fontSize: 19, lineHeight: 25 }}
              >
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
          <ChildRow key={child.id} child={child} onChanged={refresh} />
        ))}

        <EyebrowLabel style={styles.sectionLabel}>SETTINGS</EyebrowLabel>
        <SettingsRow label="Privacy & data" onPress={() => router.push('/tabs/family/privacy')} />
        <SettingsRow label="Manage subscription" onPress={() => {}} />
        <SettingsRow label="Account & sign-in" onPress={() => router.push('/tabs/family/account')} />
        <SettingsRow label="Help & support" onPress={() => {}} />
      </ScrollView>
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


/**
 * One child, with a picture they can actually recognise.
 *
 * This was the first letter of the display name in a circle — an adult
 * convention. A child who cannot read yet cannot find themselves in a list of
 * letters, and a child with no name set showed "?" beside "Unnamed".
 *
 * The picture is saved through `upsertChild` like any other field, so the
 * server owns it and it survives a reinstall. Optimistic locally so the tap
 * feels instant, then reconciled by refreshing the session.
 */
function ChildRow({
  child,
  onChanged,
}: {
  child: NonNullable<ReturnType<typeof useSession>['session']>['children'][number];
  onChanged: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<ChildAvatar | null>(child.avatar);
  const [saving, setSaving] = useState(false);

  async function choose(next: ChildAvatar) {
    const previous = avatar;
    setAvatar(next);
    setOpen(false);
    setSaving(true);
    try {
      await apiClient.call('upsertChild', {
        id: child.id,
        displayName: child.displayName,
        ageBand: child.ageBand,
        avatar: next,
      });
      await onChanged();
    } catch {
      // Put it back rather than showing a picture the server did not accept.
      setAvatar(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Pressable style={styles.childRow} onPress={() => setOpen((v) => !v)} disabled={saving}>
        <View style={styles.avatar}>
          {avatar ? (
            <Text variant="sectionHeading">{CHILD_AVATAR_EMOJI[avatar]}</Text>
          ) : (
            <Text variant="label" color={colour.violetDeep}>
              {(child.displayName ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ fontWeight: '700' }}>{child.displayName ?? 'Unnamed'}</Text>
          <Text variant="label" color={inkAlpha.textLabel}>
            {child.ageBand.replace('_', '–')}
          </Text>
        </View>
        <Text variant="button" color={inkAlpha.textFaint}>{open ? '⌄' : '›'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.avatarPicker}>
          {CHILD_AVATAR_LIST.map((option) => (
            <Pressable
              key={option}
              onPress={() => void choose(option)}
              style={[styles.avatarOption, avatar === option && styles.avatarOptionActive]}
            >
              <Text variant="sectionHeading">{CHILD_AVATAR_EMOJI[option]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.lgPlus,
  },
  avatarOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.paperCard,
    borderWidth: 1,
    borderColor: inkAlpha.border,
  },
  avatarOptionActive: { borderColor: colour.violetDeep, borderWidth: 2 },
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.md, paddingBottom: spacing.lgPlus },
  /* Was a plain View, so "Account & sign-in" and "Help & support" were below
   * the fold with nothing to scroll — two settings rows that did not exist as
   * far as a parent could tell. */
  body: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.section,
    gap: spacing.md,
  },
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
