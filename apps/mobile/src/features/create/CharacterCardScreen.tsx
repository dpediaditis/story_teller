import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** B5 — Character card. The bridge from capture into story creation. */
export function CharacterCardScreen() {
  const { draft, reset } = useCreateFlow();

  return (
    <Screen>
      <View style={styles.body}>
        <EyebrowLabel>NEW CHARACTER</EyebrowLabel>
        <View style={styles.card}>
          <View style={styles.thumb}>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{draft.characterName.toUpperCase()}</Text>
          </View>
          <Text variant="sectionHeading" style={{ marginTop: spacing.lgPlus }}>{draft.characterName}</Text>
          {draft.characterType ? (
            <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.xs }}>
              {draft.characterType}
            </Text>
          ) : null}
          {draft.personalityTraits.length ? (
            <Text variant="label" color={inkAlpha.textLabel} style={{ marginTop: spacing.xs }}>
              {draft.personalityTraits.join(' · ')}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.footer}>
        <Button label="Make a story" onPress={() => router.push('/create/adventure')} />
        <Button
          label="Add another character"
          kind="ghost"
          onPress={() => {
            reset();
            router.replace('/create/camera');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
  card: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.section, marginTop: spacing.lgPlus },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
