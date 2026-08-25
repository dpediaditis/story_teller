import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { useSession } from '../session/SessionProvider';
import { inkAlpha, spacing } from '../../theme';

/**
 * H7 — Account, inside Family. Sign-in itself lives under `app/(auth)/**`,
 * owned by B5 (auth) — this screen only surfaces status and links out to it.
 * Reading is never gated behind sign-in (RULES panel); this screen is purely
 * account management, not a reading gate.
 */
export function AccountScreen() {
  const { session } = useSession();
  const isAnonymous = session?.isAnonymous ?? true;

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Account" />
      <View style={styles.body}>
        <EyebrowLabel>{isAnonymous ? 'ON THIS PHONE' : 'SIGNED IN'}</EyebrowLabel>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm }}>
          {isAnonymous
            ? 'This library lives only on this device right now. Sign in to keep it if you get a new phone.'
            : 'Signed in — nothing was lost.'}
        </Text>
        {isAnonymous ? (
          <View style={{ marginTop: spacing.huge }}>
            <Button
              label="Sign in to keep the library"
              kind="secondary"
              onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { reason: 'library' } })}
            />
          </View>
        ) : null}
        <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.huge }}>
          We store your name and email, and nothing else about you. No child data is attached to the account.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl },
});
