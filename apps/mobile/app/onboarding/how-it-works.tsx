import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, Button, EyebrowLabel } from '../../src/components';
import { inkAlpha, radius, spacing, colour } from '../../src/theme';

const STEPS = [
  { label: 'DRAW', copy: 'They draw on paper. Any paper.' },
  { label: 'BUILD', copy: 'We build the world around it — a story, pictures, a voice.' },
  { label: 'READ', copy: 'It still looks like they drew it.' },
];

/** A2 — How it works. */
export default function HowItWorks() {
  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="sectionHeading">Three things{'\n'}happen.</Text>
        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={step.label} style={styles.step}>
              <View style={styles.stepBadge}>
                <Text variant="label" color={colour.paperElevated}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <EyebrowLabel>{step.label}</EyebrowLabel>
                <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.xs }}>
                  {step.copy}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.footer}>
        <Button label="Next" onPress={() => router.push('/onboarding/who-is-this-for')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center', gap: spacing.section },
  steps: { gap: spacing.huge },
  step: { flexDirection: 'row', gap: spacing.lgPlus, alignItems: 'flex-start' },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colour.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { padding: spacing.xxl },
});
