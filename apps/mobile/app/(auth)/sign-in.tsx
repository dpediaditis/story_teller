import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../src/components';
import { inkAlpha, spacing } from '../../src/theme';
import { beginAccountUpgrade, ProviderUnavailableError, SignInCancelledError, type LinkableProvider } from '../../src/lib/auth';
import { setPendingMerge } from '../../src/lib/auth/mergeFlowState';
import { ApiCallError, errorCopy } from '../../src/lib/api';

/**
 * H — "Sign in to keep the library". Reached from the paywall and from
 * Account's "Sign in to keep the library" action — NEVER from launch
 * (DECISIONS.md §12). Both buttons run the same upgrade sequence
 * (`beginAccountUpgrade`); the only branch is what happens after.
 */
export default function SignInScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const [pendingProvider, setPendingProvider] = useState<LinkableProvider | null>(null);
  const [unavailable, setUnavailable] = useState<LinkableProvider | null>(null);

  const subtitle =
    reason === 'paywall'
      ? "Sign in so your subscription and library travel with you to a new phone."
      : 'This library lives only on this phone right now. Sign in to keep it if you get a new phone — nothing here is lost either way.';

  async function handle(provider: LinkableProvider) {
    setUnavailable(null);
    setPendingProvider(provider);
    try {
      const outcome = await beginAccountUpgrade(provider);
      if (outcome.kind === 'linked') {
        router.replace({ pathname: '/(auth)/merge-success', params: { merged: '0' } });
        return;
      }
      setPendingMerge({ mergeToken: outcome.mergeToken, preview: outcome.preview });
      router.replace('/(auth)/merge-conflict');
    } catch (e) {
      if (e instanceof SignInCancelledError) {
        setPendingProvider(null);
        return;
      }
      if (e instanceof ProviderUnavailableError) {
        setUnavailable(provider);
        setPendingProvider(null);
        return;
      }
      const copyKey = e instanceof ApiCallError ? e.apiError.copyKey : undefined;
      router.replace({ pathname: '/(auth)/sign-in-failed', params: { message: errorCopy(copyKey) } });
    }
  }

  return (
    <Screen>
      <TopBar onClose={() => router.back()} title="Sign in" />
      <View style={styles.body}>
        <EyebrowLabel>KEEP YOUR LIBRARY</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>
          Sign in to keep the library
        </Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.md }}>
          {subtitle}
        </Text>

        <View style={{ marginTop: spacing.huge, gap: spacing.md }}>
          <Button
            label="Continue with Apple"
            kind="primary"
            loading={pendingProvider === 'apple'}
            disabled={pendingProvider !== null && pendingProvider !== 'apple'}
            onPress={() => handle('apple')}
          />
          <Button
            label="Continue with Google"
            kind="secondary"
            loading={pendingProvider === 'google'}
            disabled={pendingProvider !== null && pendingProvider !== 'google'}
            onPress={() => handle('google')}
          />
        </View>

        {unavailable ? (
          <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.xl }}>
            {unavailable === 'apple'
              ? "Sign in with Apple isn't available on this device right now."
              : "Google sign-in isn't set up in this build yet."}
          </Text>
        ) : null}

        <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.huge }}>
          We store your name and email, and nothing else about you. No child data is ever attached to the account.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl, flex: 1 },
});
