import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { STORY_SHAPE, type StoryLength, type StoryMood, type StoryTheme } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel, Chip } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { colour, inkAlpha, radius, spacing, themeColour } from '../../theme';

const THEMES: { value: StoryTheme; label: string }[] = [
  { value: 'space', label: 'Space' },
  { value: 'dinosaurs', label: 'Dinosaurs' },
  { value: 'underwater', label: 'Underwater' },
  { value: 'magic', label: 'Magic' },
  { value: 'pirates', label: 'Pirates' },
  { value: 'jungle', label: 'Jungle' },
];

const MOODS: { value: StoryMood; label: string }[] = [
  { value: 'funny', label: 'Funny' },
  { value: 'adventurous', label: 'Adventurous' },
  { value: 'calm', label: 'Calm' },
];

/** Page counts/minutes come from STORY_SHAPE — never the artboard's text. */
const LENGTHS: { value: StoryLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'bedtime', label: 'Bedtime' },
];

/** C1 / C1b — Pick an adventure. One scrolling screen; C1b is just further down. */
export function AdventureScreen({ characterIdParam }: { characterIdParam?: string }) {
  const { draft, update } = useCreateFlow();

  useEffect(() => {
    if (characterIdParam && !draft.characterId) {
      update({ characterId: characterIdParam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterIdParam]);

  const name = draft.characterName || 'your character';

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title={name} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="sectionHeading">Where should {name} go?</Text>
        <View style={styles.themeGrid}>
          {THEMES.map((t) => {
            const spine = themeColour[t.value];
            const selected = draft.theme === t.value;
            return (
              <View key={t.value} style={styles.themeCell}>
                <Pressable
                  onPress={() => update({ theme: t.value })}
                  style={[
                    styles.themeCard,
                    { backgroundColor: spine.fill, borderColor: selected ? colour.violet : 'transparent' },
                  ]}
                >
                  {selected ? (
                    <View style={styles.checkBadge}>
                      <Text variant="label" color={colour.violet}>✓</Text>
                    </View>
                  ) : null}
                </Pressable>
                <Text variant="label" style={{ marginTop: spacing.xs }}>{t.label}</Text>
              </View>
            );
          })}
        </View>

        <EyebrowLabel style={styles.sectionLabel}>HOW SHOULD IT FEEL</EyebrowLabel>
        <View style={styles.chipsRow}>
          {MOODS.map((m) => (
            <Chip key={m.value} label={m.label} selected={draft.mood === m.value} onPress={() => update({ mood: m.value })} />
          ))}
        </View>

        <EyebrowLabel style={styles.sectionLabel}>HOW LONG</EyebrowLabel>
        <View style={{ gap: spacing.sm }}>
          {LENGTHS.map((l) => {
            const shape = STORY_SHAPE[l.value];
            const selected = draft.length === l.value;
            return (
              <Pressable
                key={l.value}
                onPress={() => update({ length: l.value })}
                style={[styles.lengthRow, selected && styles.lengthRowSelected]}
              >
                <Text variant="label">{l.label}</Text>
                <Text variant="body" color={inkAlpha.textLabel} style={{ marginTop: 2, fontSize: 12.5 }}>
                  {shape.pageCount} pages · about {shape.approxMinutes} min
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Next" disabled={!draft.theme} onPress={() => router.push('/create/confirm')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl, paddingBottom: spacing.section },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lgPlus, marginTop: spacing.lgPlus },
  themeCell: { width: '30%' },
  themeCard: { aspectRatio: 1, borderRadius: radius.card, borderWidth: 2 },
  checkBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colour.paperElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { marginTop: spacing.section, marginBottom: spacing.sm },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  lengthRow: {
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.card,
    padding: spacing.lgPlus,
  },
  lengthRowSelected: { borderColor: colour.violet, backgroundColor: colour.violetTint },
  footer: { padding: spacing.xxl },
});
