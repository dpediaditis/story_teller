import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { StoryDetailDto } from '@papercub/shared';
import { Screen, Text, Button } from '../../components';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { apiClient } from '../../lib/api';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/**
 * D1/D2 — Reader, controls-hidden and narrating folded into one screen: a
 * tap toggles the chrome. Also covers "reading ahead of the render" (a page
 * whose illustration/text isn't ready yet shows a calm placeholder, never a
 * broken image) and G9 (largest accessibility size) — the page-prose/counter
 * tokens are the ONLY ones that scale with Dynamic Type (see src/theme),
 * so this screen needs no separate large-text layout.
 *
 * Narration playback itself is mocked (a running clock, no real audio
 * decode) — there's no real audio asset behind the mock's storageKey yet;
 * wiring `expo-audio` (useAudioPlayer) to a real file is the remaining step
 * once the worker produces narration.
 */
export function ReaderScreen({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<StoryDetailDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    apiClient
      .call('getStory', { id: storyId })
      .then((res) => setStory(res.story))
      // CLAUDE.md: an unhandled network failure renders a state the user can
      // act on, never a permanent blank. A bare .then() here left the screen
      // stuck at `story === null` forever on any failure.
      .catch(() => setFailed(true));
  }, [storyId]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setElapsedMs((e) => e + 1000), 1000);
    return () => clearInterval(t);
  }, [playing]);

  // Before the early return: hooks may not be conditional. One batched
  // media-sign for the whole book — private buckets, so a storage key is not a
  // URL and never can be.
  const { urls: signedUrls } = useSignedMedia(
    story ? [story.cover?.storageKey, ...story.pages.map((p) => p.illustration?.storageKey)] : [],
  );

  if (failed) {
    return (
      <Screen background={colour.paperGroundAlt}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <Text variant="sectionHeading" style={{ textAlign: 'center' }}>
            We couldn’t open this story.
          </Text>
          <Button label="Back to stories" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (!story) return <Screen background={colour.paperGroundAlt} />;

  const page = story.pages.find((p) => p.index === pageIndex);
  const isLast = pageIndex >= story.pageCount;
  const pageReady = page?.status === 'ready';

  function next() {
    if (isLast) {
      router.replace(`/story/${storyId}/end`);
      return;
    }
    setPageIndex((i) => Math.min(i + 1, story!.pageCount));
    setElapsedMs(0);
  }
  function prev() {
    setPageIndex((i) => Math.max(1, i - 1));
    setElapsedMs(0);
  }

  const durationMs = story.narration?.durationMs ?? 0;
  const format = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <Screen background={colour.paperGroundAlt} edges={['top', 'bottom']}>
      <Pressable style={styles.tapZone} onPress={() => setControlsVisible((v) => !v)}>
        {controlsVisible ? (
          <View style={styles.topBar}>
            <Pressable hitSlop={12} onPress={() => router.back()}>
              <Text variant="button">‹</Text>
            </Pressable>
            <Text variant="readerPageCounter">
              Page {pageIndex} of {story.pageCount}
            </Text>
            <View style={{ width: 24 }} />
          </View>
        ) : null}

        <View style={styles.artFrame}>
          {pageReady && page?.illustration && signedUrls[page.illustration.storageKey] ? (
            <Image
              source={{ uri: signedUrls[page.illustration.storageKey] }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <View style={styles.artPlaceholder}>
              <Text variant="captionMono" color={inkAlpha.textLabel}>Still being drawn…</Text>
            </View>
          )}
        </View>

        <View style={styles.textBlock}>
          <Text variant={playing ? 'readerActiveSentence' : 'readerPageProse'} style={playing ? styles.activeHighlight : undefined}>
            {pageReady ? page?.text : 'This page is still being written — the rest of the book is on its way.'}
          </Text>
        </View>
      </Pressable>

      {controlsVisible ? (
        <View style={styles.controls}>
          <View style={styles.progressRow}>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{format(elapsedMs)}</Text>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: durationMs ? `${Math.min(100, (elapsedMs / durationMs) * 100)}%` : '0%' }]} />
            </View>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{format(durationMs)}</Text>
          </View>

          <View style={styles.controlsRow}>
            <Pressable onPress={prev} style={styles.navBtn}>
              <Text variant="button">‹</Text>
            </Pressable>
            <Pressable onPress={() => setPlaying((p) => !p)} style={styles.playBtn}>
              <Text variant="button" color={colour.paperElevated}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable onPress={next} style={styles.navBtn}>
              <Text variant="button">›</Text>
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <Text variant="label" color={inkAlpha.textLabel}>Voice · {story.narration?.voiceId ?? 'Ivy'}</Text>
            <Text variant="label" color={inkAlpha.textLabel}>Speed · 0.9×</Text>
            <Text variant="label" color={inkAlpha.textLabel}>Auto-turn</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tapZone: { flex: 1, padding: spacing.xxl },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  artFrame: {
    marginTop: spacing.lgPlus,
    aspectRatio: 4 / 3,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    backgroundColor: colour.paperCard,
  },
  artPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textBlock: { marginTop: spacing.section },
  activeHighlight: { backgroundColor: 'rgba(217,140,31,0.18)' },
  controls: { padding: spacing.xxl, gap: spacing.lgPlus },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: inkAlpha.divider },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colour.warning },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.section },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colour.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-around' },
});
