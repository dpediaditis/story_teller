import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { CharacterDto, StorySummaryDto } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { Image } from 'expo-image';
import { apiClient } from '../../lib/api';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** E4 — Character detail. */
export function CharacterDetailScreen({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<CharacterDto | null>(null);
  const [stories, setStories] = useState<StorySummaryDto[]>([]);

  /* The character card was an empty beige square, and the story rows were an
   * empty beige square each — on the one screen whose entire job is to show a
   * child their character and the books it is in. */
  // The reference sheet once the build has produced one, their own cut-out
  // until then — same choice as the grid, so the picture does not change
  // between tapping a tile and landing on it.
  const portraitStorageKey = character
    ? (character.primaryAsset?.storageKey ?? character.cutoutStorageKey)
    : null;
  const { urls } = useSignedMedia([
    portraitStorageKey,
    ...stories.map((st) => st.cover?.storageKey),
  ]);

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
            {/* One picture, not two. The old beige square with the name in it
                stayed above the portrait, so the screen opened with an empty
                placeholder sitting on top of the real thing. */}
            <View style={styles.portrait}>
              {portraitStorageKey && urls[portraitStorageKey] ? (
                <Image
                  source={{ uri: urls[portraitStorageKey] }}
                  style={styles.portraitImage}
                  contentFit="contain"
                />
              ) : (
                <Text variant="captionMono" color={inkAlpha.textLabel}>
                  {character.status === 'building' ? 'MAKING…' : character.name.toUpperCase()}
                </Text>
              )}
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
        renderItem={({ item }) => {
          const generating =
            item.status === 'queued' || item.status === 'generating' || item.status === 'partial';
          const cover = item.cover ? (urls[item.cover.storageKey] ?? null) : null;
          return (
            /* These rows had no onPress at all — tapping a story here did
               nothing, which reads as the app being broken rather than as a
               list that happens not to be interactive. */
            <Pressable
              style={styles.storyRow}
              onPress={() =>
                router.push(
                  generating
                    ? `/create/generating?storyId=${item.id}`
                    : `/story/${item.id}/reader`,
                )
              }
            >
              <View style={styles.storyThumb}>
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.storyThumbImage} contentFit="cover" />
                ) : null}
              </View>
              <Text variant="body" style={{ flex: 1 }}>{item.title ?? 'Untitled'}</Text>
              <Text variant="label" color={inkAlpha.textLabel}>
                {generating ? 'Making…' : '›'}
              </Text>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  portrait: {
    height: 168,
    borderRadius: radius.cardLg,
    backgroundColor: colour.paperCard,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  portraitImage: { width: '86%', height: '86%' },
  storyThumbImage: { width: '100%', height: '100%' },
  // The last story row sat under the tab bar with only the screen's own
  // padding below it — the third book in the list was half a title.
  list: {
    padding: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.section,
  },
  headerCard: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge },
  storyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lgPlus,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: inkAlpha.hairline,
  },
  // overflow: the cover fills the whole thumb, and without this it squares off
  // the rounded corners.
  storyThumb: {
    width: 44,
    height: 56,
    borderRadius: 4,
    backgroundColor: colour.kraftLight,
    overflow: 'hidden',
  },
});
