import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { inkAlpha, radius, spacing, colour } from '../../theme';

/** F5 — Privacy & data, with delete confirmation. */
export function PrivacyScreen() {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Privacy & data" />
      <View style={styles.body}>
        <Fact title="Drawings live on this phone.">
          Photos and cut-outs are stored locally. They are not backed up to us.
        </Fact>
        <Fact title="Making a story sends one drawing.">
          Finished books are stored for you, so you can re-read them on a new phone. Nobody else can open them.
        </Fact>
        <Fact title="No adverts, no sale of data, no other people's children.">
          There is no feed, no sharing and no public profile in this app.
        </Fact>

        {!confirming ? (
          <Button
            label="Delete everything"
            kind="destructive"
            onPress={() => setConfirming(true)}
          />
        ) : (
          <View style={styles.confirmCard}>
            <Text variant="label" style={{ marginBottom: spacing.xs }}>Delete everything?</Text>
            <Text variant="body" color={inkAlpha.textBody}>
              Removes every drawing, character and book, here and on our servers.
            </Text>
            <EyebrowLabel style={{ marginTop: spacing.lgPlus }}>TYPE DELETE TO CONFIRM</EyebrowLabel>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              style={styles.input}
              placeholder="DELETE"
              placeholderTextColor={inkAlpha.textFaint}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lgPlus }}>
              <View style={{ flex: 1 }}>
                <Button label="Keep it all" kind="secondary" onPress={() => setConfirming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Delete"
                  kind="destructive"
                  disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
                  onPress={() => router.replace('/onboarding/welcome')}
                />
              </View>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

function Fact({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="label">{title}</Text>
      <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.xs }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl, gap: spacing.huge },
  fact: { paddingBottom: spacing.md },
  confirmCard: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge },
  input: {
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: spacing.lgPlus,
    paddingVertical: spacing.md,
    fontSize: 16,
    letterSpacing: 1,
    color: colour.ink,
  },
});
