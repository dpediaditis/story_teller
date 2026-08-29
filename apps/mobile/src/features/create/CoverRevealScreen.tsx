import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { StoryDetailDto } from '@papercub/shared';
import { Screen, Text, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { apiClient } from '../../lib/api';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { colour, shadow, spacing } from '../../theme';

/** C4 — Cover reveal. */
export function CoverRevealScreen() {
  const { draft, reset } = useCreateFlow();
  const [story, setStory] = useState<StoryDetailDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!draft.storyId) return;
    apiClient
      .call('getStory', { id: draft.storyId })
      .then((res) => setStory(res.story))
      // CLAUDE.md: an unhandled network failure renders a state the user can
      // act on, never a permanent blank. A bare .then() here left the screen
      // stuck at `story === null` forever on any failure.
      .catch(() => setFailed(true));
  }, [draft.storyId]);

  const { urls: signedUrls } = useSignedMedia(story ? [story.cover?.storageKey] : []);

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

  return (
    <Screen background={colour.ink}>
      <View style={styles.body}>
        <EyebrowLabel color="rgba(246,241,231,.6)">READY TO READ</EyebrowLabel>
        <View style={styles.coverWrap}>
          <View style={[styles.cover, shadow.coverArt]}>
            {story.cover ? (
              <Image source={{ uri: signedUrls[story.cover.storageKey] }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
          </View>
        </View>
        <Text variant="readerCoverTitle" color={colour.paperElevated} style={{ marginTop: spacing.huge, textAlign: 'center' }}>
          {story.title}
        </Text>
        <Text variant="captionMono" color="rgba(246,241,231,.55)" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
          {story.pageCount} PAGES
        </Text>
      </View>
      <View style={styles.footer}>
        <Button label="Read it" onPress={() => { reset(); router.replace(`/story/${story.id}/reader`); }} />
        <Button
          label="Save for later"
          kind="secondary"
          onPress={() => { reset(); router.replace('/tabs'); }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section },
  coverWrap: { marginTop: spacing.huge },
  cover: { width: 220, height: 275, borderRadius: 10, overflow: 'hidden', backgroundColor: '#333' },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
