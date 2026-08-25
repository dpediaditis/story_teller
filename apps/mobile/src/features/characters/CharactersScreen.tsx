import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { CharacterDto, QuotaSnapshot } from '@papercub/shared';
import { Screen, Text, EyebrowLabel, Button } from '../../components';
import { apiClient } from '../../lib/api';
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
        renderItem={({ item }) => <CharacterTile character={item} />}
        ListFooterComponent={
          <View style={{ paddingTop: spacing.huge }}>
            <Button label="Add a character" onPress={startCreate} audience="parent" />
          </View>
        }
      />
    </Screen>
  );
}

function CharacterTile({ character }: { character: CharacterDto }) {
  return (
    <Pressable style={styles.tile} onPress={() => router.push(`/tabs/characters/${character.id}`)}>
      <View style={styles.thumb}>
        <Text variant="captionMono" color={inkAlpha.textLabel} style={{ fontWeight: '700' }}>
          {character.name.toUpperCase()}
        </Text>
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
  tile: { flex: 1, backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.md },
  thumb: {
    aspectRatio: 1,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { fontSize: 21, marginTop: spacing.sm },
});
