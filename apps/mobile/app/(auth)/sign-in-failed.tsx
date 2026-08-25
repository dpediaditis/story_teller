import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../src/components';
import { inkAlpha, spacing } from '../../src/theme';

/**
 * Sign-in / merge failure. Reachable from `sign-in.tsx` (linkIdentity or the
 * post-conflict sign-in threw something other than a cancel/unavailable) and
 * from `merge-conflict.tsx` (mergeAccounts failed, including the server's
 * own 42501 `forbidden` re-check). Never a dead end: the anonymous session
 * is always still there, untouched, so "Not now" is always a safe exit —
 * reading is never gated behind sign-in.
 */
export default function SignInFailedScreen() {
  const { message } = useLocalSearchParams<{ message?: string }>();

  return (
    <Screen>
      <TopBar onClose={() => router.dismissAll()} title="Sign-in" />
      <View style={styles.body}>
        <EyebrowLabel>DIDN'T GO THROUGH</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>
          That didn't work
        </Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.md }}>
          {message || "Something went wrong. Let's try again."} Nothing on this phone was affected — your library is
          exactly as it was.
        </Text>
        <View style={{ marginTop: spacing.huge, gap: spacing.md }}>
          <Button label="Try again" kind="primary" onPress={() => router.replace('/(auth)/sign-in')} />
          <Button label="Not now" kind="ghost" onPress={() => router.dismissAll()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.xxl },
});
