import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { StoryDetailDto } from '@papercub/shared';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { apiClient } from '../../lib/api';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/** D3 — The end. */
export function TheEndScreen({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<StoryDetailDto | null>(null);

  useEffect(() => {
    apiClient.call('getStory', { id: storyId }).then((res) => setStory(res.story));
  }, [storyId]);

  if (!story) return <Screen />;
  const leadCharacterId = story.characters[0]?.characterId;
  const leadName = story.characterNames[0] ?? 'Your character';

  return (
    <Screen>
      <View style={styles.body}>
        <EyebrowLabel>THE END</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>{story.title}</Text>

        <View style={styles.characterCard}>
          <View style={styles.thumb}>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{leadName.toUpperCase()}</Text>
          </View>
          <Text variant="label" style={{ marginTop: spacing.sm }}>{leadName}</Text>
        </View>

        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.huge, textAlign: 'center' }}>
          {leadName} hasn't been to the bottom of the sea yet.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Read it again" kind="secondary" onPress={() => router.replace(`/story/${storyId}/reader`)} />
        <Button
          label={`Make another story with ${leadName}`}
          onPress={() =>
            leadCharacterId
              ? router.push(`/create/adventure?characterId=${leadCharacterId}`)
              : router.replace('/tabs')
          }
        />
        <Button label="Library" kind="ghost" onPress={() => router.replace('/tabs')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section },
  characterCard: { alignItems: 'center', marginTop: spacing.section },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radius.card,
    backgroundColor: colour.kraftLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
