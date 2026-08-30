import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { NarratedPage, StoryDetailDto } from '@papercub/shared';
import type { NarrationTimings } from '@papercub/shared';
import {
  DEFAULT_NARRATION_VOICE_ID,
  NARRATION_VOICES,
  buildNarrationTimeline,
  pageIndexAtMs,
  parseNarrationTimings,
  wordAtMs,
} from '@papercub/shared';
import { Screen, Text, Button } from '../../components';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
 * The narration drives the book. One audio file covers the whole story, and
 * `buildNarrationTimeline` (packages/shared) models where each word and each
 * page falls inside it, so the reader can:
 *
 *   - wash the sentence being read and mark the word being said
 *   - turn the page by itself, in the silence between pages
 *   - jump to any word the child taps
 *
 * Those timings are a MODEL, not the provider's — Gemini TTS returns audio and
 * nothing else. The highlight is designed around that: the sentence carries the
 * wash and the word carries the mark, so a word cursor half a beat out still
 * sits inside the right sentence, which is the band the eye follows.
 */

/** Slower than life, because the audience is four. Tap to cycle. */
const SPEEDS = [0.75, 0.85, 1] as const;
const DEFAULT_SPEED_INDEX = 1;

/**
 * Stop after this long, in minutes. Off, then a few lengths of a bedtime.
 *
 * Standard on bedtime apps and obviously right here: a child who falls asleep
 * three pages in should not be read to by a phone for another six minutes, and
 * a parent who has crept out of the room cannot come back to press pause.
 */
const SLEEP_TIMERS = [0, 5, 10, 20] as const;

export function ReaderScreen({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<StoryDetailDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [autoTurn, setAutoTurn] = useState(true);
  const [speedIndex, setSpeedIndex] = useState<number>(DEFAULT_SPEED_INDEX);
  const [favourited, setFavourited] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sleepIndex, setSleepIndex] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduceMotion(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Before the early return: hooks may not be conditional. One batched
  // media-sign for the whole book — private buckets, so a storage key is not a
  // URL and never can be.
  const { urls: signedUrls } = useSignedMedia(
    story
      ? [
          story.cover?.storageKey,
          story.narration?.storageKey,
          story.narration?.wordTimingsKey,
          ...story.pages.map((p) => p.illustration?.storageKey),
        ]
      : [],
  );

  /* The measured sentence boundaries, when the worker found any.
   *
   * A few hundred bytes of JSON beside the audio, signed in the same batch as
   * everything else on this screen. Failing to fetch it is not an error the
   * reader has to show: the timeline falls back to the model, which is what
   * every story narrated before alignment existed uses anyway. */
  const timingsUrl = story?.narration?.wordTimingsKey
    ? (signedUrls[story.narration.wordTimingsKey] ?? null)
    : null;
  const [timings, setTimings] = useState<NarrationTimings | null>(null);

  useEffect(() => {
    if (!timingsUrl) return;
    let cancelled = false;
    fetch(timingsUrl)
      .then((res) => res.json())
      .then((json: unknown) => {
        const parsed = parseNarrationTimings(json);
        if (!cancelled && parsed) setTimings(parsed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [timingsUrl]);

  /* REAL playback. This screen shipped with a play button that only toggled a
   * boolean and ran a setInterval — the progress bar moved and no sound ever
   * came out. `expo-audio` was already a dependency; nothing was ever wired to
   * it.
   *
   * playsInSilentMode is not optional for this product: a bedtime story is read
   * on a phone that lives on silent, and "I pressed play and heard nothing" is
   * indistinguishable from broken. */
  const narrationUrl = story?.narration ? (signedUrls[story.narration.storageKey] ?? null) : null;
  const player = useAudioPlayer(narrationUrl ? { uri: narrationUrl } : null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const positionMs = Math.round((status.currentTime ?? 0) * 1000);
  const playing = status.playing ?? false;

  const speed = SPEEDS[speedIndex] ?? 1;
  useEffect(() => {
    /* Slowing the audio is the only lever we have: the synthesiser reads the
     * delivery direction aloud instead of following it (see the note above
     * `synthesise` in providers/gemini.ts). Pitch correction is what keeps
     * 0.85x sounding like a slower reader rather than a bigger one.
     *
     * Gated on `isLoaded` because setting a rate on a player with no ready
     * item is not defined to do anything useful, and the failure mode if it
     * does go wrong here is the worst one this screen has: a play button that
     * produces no sound and no error.
     */
    if (!status.isLoaded) return;
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(speed, 'high');
  }, [player, speed, status.isLoaded]);

  /* The timeline depends only on the text and the measured duration, so it is
   * built once per story and not on every tick of the clock. */
  const timeline = useMemo(() => {
    if (!story) return null;
    const readable = story.pages.filter((p) => p.status === 'ready');
    if (readable.length === 0 || !story.narration) return null;
    return buildNarrationTimeline(
      readable.map((p) => ({ index: p.index, text: p.text })),
      story.narration.durationMs,
      timings,
    );
  }, [story, timings]);

  const turn = useCallback(
    (next: number, seek: boolean) => {
      if (!story) return;
      const clamped = Math.max(1, Math.min(next, story.pageCount));
      setPageIndex(clamped);
      /* Turning the page by hand moves the narration with it. Without this the
       * voice keeps reading page two while page five is on screen, and the
       * highlight — which follows the audio, not the page — sits on nothing. */
      if (seek && timeline && narrationUrl) {
        const target = timeline.pages.find((p) => p.pageIndex === clamped);
        if (target) void player.seekTo(target.startMs / 1000);
      }
    },
    [story, timeline, narrationUrl, player],
  );

  /* Auto-turn. `pageIndexAtMs` returns the page about to start during the
   * silence between two pages, so the turn lands while nobody is speaking. */
  useEffect(() => {
    if (!autoTurn || !playing || !timeline) return;
    const shouldBe = pageIndexAtMs(timeline, positionMs);
    if (shouldBe !== null && shouldBe !== pageIndex) setPageIndex(shouldBe);
  }, [autoTurn, playing, timeline, positionMs, pageIndex]);

  /* The sleep timer. Measured from when it was set, not from the start of the
   * story, so turning it on halfway through means what it says. */
  const sleepMinutes = SLEEP_TIMERS[sleepIndex] ?? 0;
  useEffect(() => {
    if (sleepMinutes === 0) return;
    const handle = setTimeout(() => {
      player.pause();
      setSleepIndex(0);
    }, sleepMinutes * 60_000);
    return () => clearTimeout(handle);
  }, [sleepMinutes, player]);

  /* The book closes itself. Reaching the end of the audio is the end of the
   * story, and a child who has been listening should not have to find a button
   * to be told so. `didJustFinish` is the player's own signal — comparing the
   * position against the duration misses whenever the last tick lands short. */
  const endedRef = useRef(false);
  useEffect(() => {
    if (!status.didJustFinish || endedRef.current) return;
    endedRef.current = true;
    router.replace(`/story/${storyId}/end`);
  }, [status.didJustFinish, storyId]);

  /* A page arriving, rather than a page being replaced. Runs on every page
   * change, whoever caused it, so an automatic turn and a swipe look the
   * same. */
  const enter = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pageIndex, enter, reduceMotion]);

  /* Swipe to turn, because that is what a book does. `onMoveShouldSet` only
   * fires once a finger has travelled, so taps still reach the words
   * underneath. */
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -48) turn(pageIndex + 1, true);
          else if (g.dx >= 48) turn(pageIndex - 1, true);
        },
      }),
    [turn, pageIndex],
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
  const pageReady = page?.status === 'ready';
  const timedPage = timeline?.pages.find((p) => p.pageIndex === pageIndex) ?? null;
  const durationMs = timeline?.totalMs ?? story.narration?.durationMs ?? 0;

  const format = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  async function toggleFavourite() {
    const next = !favourited;
    setFavourited(next);
    try {
      await apiClient.call('setStoryFavourite', { id: storyId, favourited: next });
    } catch {
      // Put the heart back rather than showing a state the server rejected.
      setFavourited(!next);
    }
  }

  function seekToWord(startMs: number) {
    if (!narrationUrl) return;
    void player.seekTo(startMs / 1000);
    if (!playing) player.play();
  }

  return (
    <Screen background={colour.paperGroundAlt} edges={['top', 'bottom']}>
      <View style={styles.tapZone} {...swipe.panHandlers}>
        {controlsVisible ? (
          <View style={styles.topBar}>
            <Pressable hitSlop={12} onPress={() => router.back()}>
              <Text variant="button">‹</Text>
            </Pressable>
            <Text variant="readerPageCounter">
              Page {pageIndex} of {story.pageCount}
            </Text>
            {/* `setStoryFavourite` existed on the server and in the client's
                route table and no screen had ever called it, so the library's
                heart filter could only ever be empty. */}
            <Pressable
              hitSlop={12}
              onPress={() => void toggleFavourite()}
              accessibilityLabel={favourited ? 'Remove from favourites' : 'Add to favourites'}
            >
              <Text variant="button" color={favourited ? colour.violet : inkAlpha.textFaint}>
                {favourited ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => setControlsVisible((v) => !v)}>
          <Animated.View
            style={{
              opacity: enter,
              transform: [
                { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
              ],
            }}
          >
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
              {pageReady && timedPage ? (
                <NarratedProse
                  page={timedPage}
                  positionMs={playing ? positionMs : -1}
                  onWordPress={seekToWord}
                />
              ) : (
                <Text variant="readerPageProse">
                  {pageReady
                    ? page?.text
                    : 'This page is still being written — the rest of the book is on its way.'}
                </Text>
              )}
            </View>
          </Animated.View>
        </Pressable>
      </View>

      {controlsVisible ? (
        <View style={styles.controls}>
          <View style={styles.progressRow}>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{format(positionMs)}</Text>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: durationMs ? `${Math.min(100, (positionMs / durationMs) * 100)}%` : '0%' }]} />
            </View>
            <Text variant="captionMono" color={inkAlpha.textLabel}>{format(durationMs)}</Text>
          </View>

          <View style={styles.controlsRow}>
            <Pressable onPress={() => turn(pageIndex - 1, true)} style={styles.navBtn}>
              <Text variant="button">‹</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!narrationUrl) return;
                if (playing) player.pause();
                else {
                  endedRef.current = false;
                  player.play();
                }
              }}
              style={[styles.playBtn, !narrationUrl && { opacity: 0.4 }]}
            >
              <Text variant="button" color={colour.paperElevated}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (pageIndex >= story.pageCount) router.replace(`/story/${storyId}/end`);
                else turn(pageIndex + 1, true);
              }}
              style={styles.navBtn}
            >
              <Text variant="button">›</Text>
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            {/* The DISPLAY name, never the id. This rendered
                "Voice · papercub_default" — an internal identifier on a screen
                a child looks at, and against CLAUDE.md's rule that the app owns
                all copy. */}
            <Text variant="label" color={inkAlpha.textLabel}>
              Voice ·{' '}
              {story.narration
                ? NARRATION_VOICES[story.narration.voiceId].displayName
                : NARRATION_VOICES[DEFAULT_NARRATION_VOICE_ID].displayName}
            </Text>
            {/* Both of these were static labels describing settings that did not
                exist. They are controls now. */}
            <Pressable hitSlop={10} onPress={() => setSpeedIndex((i) => (i + 1) % SPEEDS.length)}>
              <Text variant="label" color={inkAlpha.textLabel}>Speed · {speed}×</Text>
            </Pressable>
            <Pressable hitSlop={10} onPress={() => setAutoTurn((v) => !v)}>
              <Text variant="label" color={autoTurn ? colour.violet : inkAlpha.textLabel}>
                Auto-turn · {autoTurn ? 'On' : 'Off'}
              </Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              onPress={() => setSleepIndex((i) => (i + 1) % SLEEP_TIMERS.length)}
            >
              <Text variant="label" color={sleepMinutes ? colour.violet : inkAlpha.textLabel}>
                Sleep · {sleepMinutes ? `${sleepMinutes}m` : 'Off'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * The page, word by word.
 *
 * Nested `Text` keeps this one paragraph as far as layout is concerned, so the
 * prose still wraps and still scales with Dynamic Type — rendering each word in
 * its own view would turn a story into a word grid.
 *
 * Two levels of highlight, and the reason is drift: the sentence wash is what
 * the eye tracks, and it is right for seconds at a time, while the word mark is
 * a model of where the voice is and can be a beat out. Getting the sentence
 * right is what makes being slightly wrong about the word forgivable.
 *
 * `positionMs` of -1 means "not playing" — no highlight, plain prose.
 */
function NarratedProse({
  page,
  positionMs,
  onWordPress,
}: {
  page: NarratedPage;
  positionMs: number;
  onWordPress: (startMs: number) => void;
}) {
  const active = positionMs < 0 ? null : wordAtMs(page, positionMs);

  return (
    <Text variant="readerPageProse">
      {page.words.map((word, i) => {
        const isWord = active?.index === word.index;
        const isSentence = active !== null && active.sentenceIndex === word.sentenceIndex;
        return (
          <Text
            key={word.index}
            variant="readerPageProse"
            /* Tapping a word plays from there. It costs nothing given the
               timeline already exists, and it turns the page into something a
               child can poke at rather than only watch. */
            onPress={() => onWordPress(word.startMs)}
            suppressHighlighting
            style={
              isWord ? styles.wordActive : isSentence ? styles.sentenceActive : undefined
            }
          >
            {word.text}
            {i < page.words.length - 1 ? ' ' : ''}
          </Text>
        );
      })}
    </Text>
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
  // The marigold wash the design asks for, on the sentence being read.
  sentenceActive: { backgroundColor: 'rgba(217,140,31,0.18)' },
  // The word inside it. Stronger, but still a wash rather than a colour change:
  // recolouring the ink makes the word jump out of the line and breaks reading.
  wordActive: { backgroundColor: 'rgba(217,140,31,0.52)' },
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
  metaRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
});
