import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Text, Button, EyebrowLabel } from '../../src/components';
import { inkAlpha, spacing } from '../../src/theme';

/**
 * "Signed in — nothing was lost." Terminal state for every successful
 * upgrade path: a plain `linkIdentity` (no conflict — `merged=0`, nothing to
 * report) and a completed merge (`merged=1`, with counts). Both read the
 * same reassurance, because in both cases nothing on the phone was thrown
 * away — that is the whole point of the flow being first-class rather than
 * an error path.
 */
export default function MergeSuccessScreen() {
  const { merged, characters, stories } = useLocalSearchParams<{
    merged?: string;
    characters?: string;
    stories?: string;
  }>();

  const didMerge = merged === '1';

  return (
    <Screen>
      <View style={styles.body}>
        <EyebrowLabel>SIGNED IN</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>
          Signed in — nothing was lost
        </Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.md }}>
          {didMerge
            ? `Everything from this phone is now in your account${
                characters && stories ? ` — ${characters} characters and ${stories} stories in total.` : '.'
              }`
            : "Your library is now tied to your account, exactly as it was on this phone."}
        </Text>
        <View style={{ marginTop: spacing.huge }}>
          <Button label="Continue" kind="primary" onPress={() => router.replace('/tabs')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
});
