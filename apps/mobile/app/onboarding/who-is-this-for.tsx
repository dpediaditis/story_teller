import { useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { router } from 'expo-router';
import type { AgeBand } from '@papercub/shared';
import { Screen, Text, Button, Chip, EyebrowLabel } from '../../src/components';
import { apiClient, ApiCallError, errorCopy } from '../../src/lib/api';
import { useSession } from '../../src/features/session/SessionProvider';
import { inkAlpha, radius, spacing, colour } from '../../src/theme';

const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: '4_5', label: '4–5' },
  { value: '6_7', label: '6–7' },
  { value: '8_plus', label: '8+' },
];

/**
 * A3 — Who's this for. Nickname + age band, both skippable. Age band tunes
 * vocabulary only — never a gate. No birth date is ever collected
 * (DECISIONS.md §10 / CLAUDE.md rule 3): this screen offers AgeBand only.
 */
export default function WhoIsThisFor() {
  const [name, setName] = useState('');
  const [ageBand, setAgeBand] = useState<AgeBand>('6_7');
  const { refresh } = useSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Both fields are optional, and the copy above says so — but a child ROW is
   * not optional. Everything downstream hangs off `child_id`: createCharacter,
   * createUploadUrl and claim_story_quota all take one, and the create flow
   * reads `session.children[0]`.
   *
   * "Skip this" used to navigate without creating one, so a parent who skipped
   * reached "What's their name?", tapped the button, and nothing happened —
   * ever. `confirm()` read an undefined childId and returned silently. Skipping
   * means "use the defaults", not "have no child", so both paths write the row
   * and only the values differ.
   */
  async function saveChild(displayName: string | null) {
    setSaving(true);
    setError(null);
    try {
      await apiClient.call('upsertChild', { displayName, ageBand });
      // The session was fetched at launch, BEFORE this child existed, and
      // nothing else re-reads it — AuthSessionProvider only refreshes on a
      // Supabase auth change, which creating a child is not. Without this the
      // whole app carries `children: []` for the rest of its life, and the
      // create flow's `session.children[0]` is undefined two screens later.
      await refresh();
      router.push('/onboarding/camera-permission');
    } catch (err) {
      // Deliberately does NOT navigate on failure. The old `finally` marched on
      // regardless, which produced the same silent dead end two screens later,
      // with nothing to connect it back to this moment.
      setError(err instanceof ApiCallError ? errorCopy(err.apiError.copyKey) : errorCopy(undefined));
    } finally {
      setSaving(false);
    }
  }

  function continueOn() {
    return saveChild(name.trim().length ? name.trim() : null);
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="sectionHeading">Who are we{'\n'}making stories for?</Text>
        <Text variant="body" color={inkAlpha.textBody}>
          Both optional. It only changes how the stories sound.
        </Text>

        <View style={styles.field}>
          <EyebrowLabel>FIRST NAME OR NICKNAME</EyebrowLabel>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Mia"
            placeholderTextColor={inkAlpha.textFaint}
            style={styles.input}
            maxLength={40}
          />
        </View>

        <View style={styles.field}>
          <EyebrowLabel>HOW OLD, ROUGHLY</EyebrowLabel>
          <View style={styles.chips}>
            {AGE_BANDS.map((b) => (
              <Chip key={b.value} label={b.label} selected={ageBand === b.value} onPress={() => setAgeBand(b.value)} />
            ))}
          </View>
          <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.sm }}>
            No birth date, ever. We never ask for one.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        {error ? (
          <Text variant="label" color={colour.danger} style={{ textAlign: 'center' }}>
            {error}
          </Text>
        ) : null}
        <Button label="Continue" onPress={continueOn} loading={saving} />
        <Button label="Skip this" kind="ghost" disabled={saving} onPress={() => saveChild(null)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: spacing.xxl, gap: spacing.huge },
  field: { gap: spacing.sm },
  input: {
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: spacing.lgPlus,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colour.ink,
  },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
