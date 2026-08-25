import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Text, Button } from '../src/components';
import { colour, inkAlpha, radius, spacing } from '../src/theme';

/** F3 — Parental gate. A simple arithmetic check, not a security control. */
export default function ParentalGate() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const [answer, setAnswer] = useState('');
  const [wrong, setWrong] = useState(false);

  const { a, b, sum } = useMemo(() => {
    const a = 12 + Math.floor(Math.random() * 20);
    const b = 8 + Math.floor(Math.random() * 20);
    return { a, b, sum: a + b };
  }, []);

  function submit() {
    if (Number(answer) === sum) {
      router.replace(typeof redirect === 'string' && redirect.length > 0 ? redirect : '/tabs/family');
    } else {
      setWrong(true);
    }
  }

  return (
    <Screen background="rgba(20,18,16,0.6)">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={12}>
            <Text variant="button">×</Text>
          </Pressable>
          <Text variant="sectionHeading">Ask a grown-up.</Text>
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm }}>
            This part of the app is for the person paying the bills.
          </Text>
          <Text variant="label" style={{ marginTop: spacing.section, textAlign: 'center' }}>
            {a} + {b} = ?
          </Text>
          <TextInput
            value={answer}
            onChangeText={(t) => {
              setAnswer(t);
              setWrong(false);
            }}
            keyboardType="number-pad"
            style={styles.input}
            maxLength={4}
          />
          {wrong ? (
            <Text variant="label" color={colour.danger} style={{ textAlign: 'center' }}>Not quite — try again.</Text>
          ) : null}
          <Button label="Continue" onPress={submit} disabled={!answer} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colour.paperGround,
    borderRadius: radius.sheet,
    padding: spacing.section,
    gap: spacing.md,
  },
  closeBtn: { position: 'absolute', right: spacing.lgPlus, top: spacing.lgPlus },
  input: {
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.input,
    paddingVertical: spacing.md,
    fontSize: 22,
    textAlign: 'center',
    color: colour.ink,
  },
});
