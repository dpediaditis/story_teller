import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { CharacterDto, StorySummaryDto } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { apiClient } from '../../lib/api';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** E4 — Character detail. */
export function CharacterDetailScreen({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<CharacterDto | null>(null);
  const [stories, setStories] = useState<StorySummaryDto[]>([]);

  const load = useCallback(async () => {
    const res = await apiClient.call('getCharacter', { id: characterId });
    setCharacter(res.character);
    setStories(res.stories);
  }, [characterId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!character) return <Screen />;

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title={character.name} />
      <FlatList
        data={stories}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <View style={styles.thumb}>
              <Text variant="captionMono" color={inkAlpha.textLabel}>{character.name.toUpperCase()}</Text>
            </View>
            <Text variant="sectionHeading" style={{ marginTop: spacing.lgPlus }}>{character.name}</Text>
            {character.characterType ? (
              <Text variant="body" color={inkAlpha.textBody}>{character.characterType}</Text>
            ) : null}
            {character.personalityTraits.length ? (
              <Text variant="label" color={inkAlpha.textLabel} style={{ marginTop: spacing.xs }}>
                {character.personalityTraits.join(' · ')}
              </Text>
            ) : null}
            <View style={{ marginTop: spacing.huge }}>
              <Button
                label="Make a story"
                /* The NAME travels with the id. Starting a story from an
                 * existing character skips the create-flow screens that would
                 * normally populate the draft, so `draft.characterName` was
                 * empty and the confirm screen rendered " goes to Space — a
                 * short adventurous story." with a gap where the name belongs.
                 *
                 * Passed as a route param rather than written into the draft
                 * here: this screen lives under `tabs`, which is OUTSIDE
                 * CreateFlowProvider, so useCreateFlow() throws here. The
                 * adventure screen is inside it and does the write. */
                onPress={() =>
                  router.push(
                    `/create/adventure?characterId=${character.id}` +
                      `&characterName=${encodeURIComponent(character.name)}` +
                      // So the generating screen can show THEIR drawing. Coming
                      // in from here skips the capture flow, which is the only
                      // other place that cut-out is known.
                      `&cutoutKey=${encodeURIComponent(character.cutoutStorageKey)}`,
                  )
                }
              />
            </View>
            <EyebrowLabel style={{ marginTop: spacing.section }}>
              {stories.length ? 'STORIES' : 'NO STORIES YET'}
            </EyebrowLabel>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.storyRow}>
            <View style={styles.storyThumb} />
            <Text variant="body" style={{ flex: 1 }}>{item.title ?? 'Untitled'}</Text>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.xxl, paddingTop: spacing.sm },
  headerCard: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lgPlus,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: inkAlpha.hairline,
  },
  storyThumb: { width: 44, height: 56, borderRadius: 4, backgroundColor: colour.kraftLight },
});
