import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import type { CharacterDto, QuotaSnapshot } from '@papercub/shared';
import { Screen, Text, EyebrowLabel, Button } from '../../components';
import { apiClient } from '../../lib/api';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { useSession } from '../session/SessionProvider';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** E3 — Characters. Creation lives here: this is the entry point to /create. */
export function CharactersScreen() {
  const { session, refresh } = useSession();
  const [characters, setCharacters] = useState<CharacterDto[] | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(session?.quota ?? null);

  const load = useCallback(async () => {
    const res = await apiClient.call('listCharacters', { includeArchived: false });
    setCharacters(res.characters);
    await refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      setQuota(session?.quota ?? null);
    }, [session]),
  );

  /* The tile showed the character's name in a beige box. A child looking for
   * their own drawing was reading a label, in a product whose whole promise is
   * that the drawing itself comes back. One batched sign for the grid — the
   * bucket is private, so a storage key is not a URL. */
  const { urls: portraitUrls } = useSignedMedia(
    (characters ?? []).map((c) => portraitKey(c)),
  );

  const atCharacterLimit = quota ? quota.charactersUsed >= quota.charactersLimit : false;

  function startCreate() {
    if (atCharacterLimit) {
      router.push('/paywall/quota-reached');
      return;
    }
    router.push('/create/camera');
  }

  if (characters === null) return <Screen />;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="sectionHeading">Characters</Text>
      </View>

      {atCharacterLimit ? (
        <View style={styles.quotaBanner}>
          <EyebrowLabel>FOR THE GROWN-UP</EyebrowLabel>
          <Text variant="body" style={{ marginTop: spacing.xs }}>
            {characters.length} of {quota?.charactersLimit} used — a new character needs the full plan.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={characters}
        keyExtractor={(c) => c.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: spacing.lgPlus }}
        renderItem={({ item }) => (
          <CharacterTile character={item} portraitUrl={portraitUrls[portraitKey(item)] ?? null} />
        )}
        ListFooterComponent={
          <View style={{ paddingTop: spacing.huge }}>
            <Button label="Add a character" onPress={startCreate} audience="parent" />
          </View>
        }
      />
    </Screen>
  );
}

/**
 * The reference sheet if the build finished, the child's own cut-out until
 * then. The cut-out is whatever came off the camera — with the Vision module
 * still a stub it is the raw photograph, background and all — so the drawn
 * character is the better picture the moment it exists.
 */
function portraitKey(character: CharacterDto): string {
  return character.primaryAsset?.storageKey ?? character.cutoutStorageKey;
}

function CharacterTile({
  character,
  portraitUrl,
}: {
  character: CharacterDto;
  portraitUrl: string | null;
}) {
  return (
    <Pressable style={styles.tile} onPress={() => router.push(`/tabs/characters/${character.id}`)}>
      <View style={styles.thumb}>
        {portraitUrl ? (
          // `contain`, never `cover`: a cut-out is a shape on transparency and
          // cropping it takes the head off.
          <Image source={{ uri: portraitUrl }} style={styles.thumbImage} contentFit="contain" />
        ) : (
          <Text variant="captionMono" color={inkAlpha.textLabel} style={{ fontWeight: '700' }}>
            {character.status === 'building' ? 'MAKING…' : character.name.toUpperCase()}
          </Text>
        )}
      </View>
      <Text variant="sectionHeading" style={styles.tileName}>{character.name}</Text>
      <Text variant="label" color={inkAlpha.textLabel} style={{ marginTop: 5 }}>
        {character.status === 'building'
          ? 'Getting ready…'
          : character.storyCount === 0
            ? 'No stories yet'
            : `${character.storyCount} ${character.storyCount === 1 ? 'story' : 'stories'}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xxl, paddingTop: spacing.md, paddingBottom: spacing.lgPlus },
  quotaBanner: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lgPlus,
    padding: spacing.lgPlus,
    borderRadius: radius.card,
    backgroundColor: colour.paperCard,
  },
  grid: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.section, gap: spacing.lgPlus },
  // `flex: 1` alone made a lone character stretch the full row, so one drawing
  // filled the screen as a poster instead of sitting in a grid of two.
  tile: {
    flex: 1,
    maxWidth: '48%',
    backgroundColor: colour.paperCard,
    borderRadius: radius.cardLg,
    padding: spacing.md,
  },
  thumb: {
    aspectRatio: 1,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '88%', height: '88%' },
  tileName: { fontSize: 21, marginTop: spacing.sm },
});
