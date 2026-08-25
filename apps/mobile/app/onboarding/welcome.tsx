import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, Button, EyebrowLabel } from '../../src/components';
import { colour, inkAlpha, radius, spacing, themeColour } from '../../src/theme';

/**
 * A1 — Welcome. "The whole pitch is one before/after." No word "AI" anywhere
 * — a positioning decision (CLAUDE.md / RULES panel), not a style note.
 */
export default function Welcome() {
  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.beforeAfter}>
          <View style={[styles.panel, { backgroundColor: colour.kraftLight }]}>
            <EyebrowLabel>ON PAPER</EyebrowLabel>
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm }}>
              A paper drawing on a kitchen table.
            </Text>
          </View>
          <View style={[styles.panel, { backgroundColor: themeColour.space.fill }]}>
            <EyebrowLabel color="rgba(246,241,231,.6)">IN THEIR BOOK</EyebrowLabel>
            <Text variant="sectionHeading" color={colour.paperElevated} style={{ marginTop: spacing.sm }}>
              Bobo checked behind the clouds. No moon there either.
            </Text>
          </View>
        </View>

        <View style={styles.copy}>
          <Text variant="sectionHeading">Their drawing.{'\n'}Their story.</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Start" onPress={() => router.push('/onboarding/how-it-works')} />
        <Text variant="captionMono" color={inkAlpha.textLabel} style={styles.footNote}>
          No account. Nothing shared with anyone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center', gap: spacing.section },
  beforeAfter: { gap: spacing.lgPlus },
  panel: { borderRadius: radius.cardLg, padding: spacing.huge, minHeight: 160, justifyContent: 'flex-end' },
  copy: { alignItems: 'center' },
  footer: { padding: spacing.xxl, gap: spacing.md },
  footNote: { textAlign: 'center' },
});
