import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { StoryDetailDto, StoryTheme } from '@papercub/shared';
import { STORY_THEME_EMOJI, STORY_THEME_INVITATION, STORY_THEME_LIST } from '@papercub/shared';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { apiClient } from '../../lib/api';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** D3 — The end. */
export function TheEndScreen({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<StoryDetailDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [favourited, setFavourited] = useState(false);

  const { urls } = useSignedMedia([story?.cover?.storageKey]);

  useEffect(() => {
    apiClient
      .call('getStory', { id: storyId })
      .then((res) => {
        setStory(res.story);
        setFavourited(res.story.favouritedAt !== null);
      })
      // CLAUDE.md: an unhandled network failure renders a state the user can
      // act on, never a permanent blank. A bare .then() here left the screen
      // stuck at `story === null` forever on any failure.
      .catch(() => setFailed(true));
  }, [storyId]);

  if (failed) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <Text variant="sectionHeading" style={{ textAlign: 'center' }}>
            We couldn’t open this story.
          </Text>
          <Button label="Back" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (!story) return <Screen />;
  const leadCharacterId = story.characters[0]?.characterId;
  const leadName = story.characterNames[0] ?? 'Your character';
  const coverUrl = story.cover ? (urls[story.cover.storageKey] ?? null) : null;
  const nextTheme = suggestNextTheme(story.theme, story.id);

  async function toggleFavourite() {
    const next = !favourited;
    setFavourited(next);
    try {
      await apiClient.call('setStoryFavourite', { id: storyId, favourited: next });
    } catch {
      setFavourited(!next);
    }
  }

  return (
    <Screen>
      <View style={styles.body}>
        <EyebrowLabel>THE END</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>{story.title}</Text>

        {/* The book they just finished, not a beige square with a name in it. */}
        <View style={styles.characterCard}>
          <View style={styles.thumb}>
            {coverUrl ? (
              <Image source={{ uri: coverUrl }} style={styles.thumbImage} contentFit="cover" />
            ) : (
              <Text variant="captionMono" color={inkAlpha.textLabel}>{leadName.toUpperCase()}</Text>
            )}
          </View>
          <Text variant="label" style={{ marginTop: spacing.sm }}>{leadName}</Text>
        </View>

        {/* Keeping a story is a thing you decide the moment it ends, so the
            heart belongs here as well as in the reader. */}
        <Pressable
          onPress={() => void toggleFavourite()}
          style={[styles.keepRow, favourited && styles.keepRowOn]}
          accessibilityLabel={favourited ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Text variant="button" color={favourited ? colour.violet : inkAlpha.textFaint}>
            {favourited ? '♥' : '♡'}
          </Text>
          <Text variant="label" color={favourited ? colour.violet : inkAlpha.textLabel}>
            {favourited ? 'Kept' : 'Keep this one'}
          </Text>
        </Pressable>

        {/* This read "hasn't been to the bottom of the sea yet" on every story,
            including the ones set underwater. It names a place this story did
            not go, and the place it names is stable per story rather than
            re-rolled on every render. */}
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.huge, textAlign: 'center' }}>
          {STORY_THEME_EMOJI[nextTheme]}  {leadName} hasn't been{' '}
          {STORY_THEME_INVITATION[nextTheme]} yet.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Read it again" kind="secondary" onPress={() => router.replace(`/story/${storyId}/reader`)} />
        <Button
          label={`Make another story with ${leadName}`}
          /* The name travels with the id, as it does from the character
             screen: the create flow is skipped past the screens that would
             normally fill in `draft.characterName`, and the confirm screen
             renders it. */
          onPress={() =>
            leadCharacterId
              ? router.push(
                  `/create/adventure?characterId=${leadCharacterId}` +
                    `&characterName=${encodeURIComponent(leadName)}`,
                )
              : router.replace('/tabs')
          }
        />
        <Button label="Library" kind="ghost" onPress={() => router.replace('/tabs')} />
      </View>
    </Screen>
  );
}

/**
 * A place this story did not go.
 *
 * Keyed off the story id so it does not change while the screen is open, and
 * does not offer a different adventure every time the child comes back to a
 * book they like.
 */
function suggestNextTheme(current: StoryTheme, storyId: string): StoryTheme {
  const others = STORY_THEME_LIST.filter((t) => t !== current);
  if (others.length === 0) return current;
  let hash = 0;
  for (let i = 0; i < storyId.length; i += 1) hash = (hash * 31 + storyId.charCodeAt(i)) >>> 0;
  return others[hash % others.length]!;
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section },
  characterCard: { alignItems: 'center', marginTop: spacing.section },
  thumb: {
    width: 104,
    height: 130,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  keepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lgPlus,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lgPlus,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: inkAlpha.border,
  },
  keepRowOn: { borderColor: colour.violet },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
