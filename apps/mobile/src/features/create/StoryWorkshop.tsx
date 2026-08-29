import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';
import type { JobProgressEvent } from '@papercub/shared';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/**
 * The book being made, on a desk.
 *
 * The rule this has to respect is the same one the stage list respects
 * (enums.ts, and repeated in docs/ARCHITECTURE.md): "Each message shown to a
 * user must correspond to a stage that is ACTUALLY RUNNING. Never invent
 * progress." So nothing here is on a timer pretending to be work:
 *
 *   the sheet appears   when the job reaches `writing_story`
 *   the cover flips up  when `coverReady` arrives — the real gate-4 pass
 *   a page lands        once per index in `readablePageIndexes`, one for one
 *
 * The stack of pages IS the progress bar, and it cannot show a page the server
 * has not finished. That is why there is no percentage: the pile is the honest
 * version of one.
 *
 * The character on the desk is the child's OWN cut-out, the file the flow just
 * uploaded. Roughly a hundred seconds is a long time for a five-year-old, and
 * the thing that makes it bearable is not a spinner — it is watching their own
 * drawing sit there while the book piles up next to it.
 *
 * Built on React Native's own Animated rather than Reanimated: everything here
 * is transform and opacity, which `useNativeDriver` runs off the JS thread
 * anyway, and Reanimated 4 would need the worklets babel plugin plus a native
 * rebuild to earn its keep. Motion is skipped entirely when the OS asks for
 * reduced motion — the same elements still appear, they just do not move.
 */

const STAGES_WITH_SHEET = [
  'writing_story',
  'moderating_text',
  'illustrating_cover',
  'illustrating_pages',
  'moderating_images',
  'narrating',
  'assembling',
  'done',
];

export function StoryWorkshop({
  event,
  cutoutUri,
}: {
  event: JobProgressEvent | null;
  cutoutUri: string | null;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const stage = event?.stage ?? 'queued';
  const readable = event?.readablePageIndexes ?? [];
  const coverReady = event?.coverReady ?? false;
  const sheetOut = STAGES_WITH_SHEET.includes(stage);

  return (
    <View style={styles.scene} pointerEvents="none" accessibilityElementsHidden>
      <View style={styles.desk} />

      {sheetOut ? <Sheet writing={stage === 'writing_story'} reduceMotion={reduceMotion} /> : null}
      {coverReady ? <Card kind="cover" index={0} reduceMotion={reduceMotion} /> : null}
      {readable.map((pageIndex, i) => (
        <Card key={pageIndex} kind="page" index={i + 1} reduceMotion={reduceMotion} />
      ))}

      <Character
        uri={cutoutUri}
        landedCount={readable.length}
        listening={stage === 'narrating'}
        reduceMotion={reduceMotion}
      />
    </View>
  );
}

/** The manuscript. Ink lines fill in while the story is actually being written. */
function Sheet({ writing, reduceMotion }: { writing: boolean; reduceMotion: boolean }) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, {
      toValue: 1,
      duration: reduceMotion ? 0 : 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rise, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          opacity: rise,
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
            { rotate: '-3deg' },
          ],
        },
      ]}
    >
      {[0, 1, 2, 3].map((line) => (
        <InkLine key={line} order={line} writing={writing} reduceMotion={reduceMotion} />
      ))}
    </Animated.View>
  );
}

/**
 * One line of writing. Scales along the X axis so it reads as a pen moving
 * left to right; the lines are staggered so it looks like prose, not a loader.
 */
function InkLine({
  order,
  writing,
  reduceMotion,
}: {
  order: number;
  writing: boolean;
  reduceMotion: boolean;
}) {
  const draw = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      draw.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(order * 190),
        Animated.timing(draw, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay((3 - order) * 190 + 400),
        Animated.timing(draw, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]),
    );
    // Once the writing stage is over the lines stay drawn — the page is written.
    if (writing) loop.start();
    else Animated.timing(draw, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    return () => loop.stop();
  }, [draw, order, writing, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.inkLine,
        // The last line is short, the way a paragraph ends.
        order === 3 && { width: '55%' },
        { opacity: draw, transform: [{ scaleX: draw }] },
      ]}
    />
  );
}

/**
 * A finished page landing on the pile. Each one is offset and tilted a little
 * so the stack looks handled rather than machine-stacked.
 */
function Card({
  kind,
  index,
  reduceMotion,
}: {
  kind: 'cover' | 'page';
  index: number;
  reduceMotion: boolean;
}) {
  const drop = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(drop, {
      toValue: 1,
      duration: reduceMotion ? 0 : 460,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [drop, reduceMotion]);

  const tilt = ((index % 3) - 1) * 2.5;

  return (
    <Animated.View
      style={[
        styles.card,
        kind === 'cover' ? styles.cardCover : styles.cardPage,
        {
          bottom: 96 + index * 7,
          opacity: drop,
          transform: [
            { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-70, 0] }) },
            { rotate: `${tilt}deg` },
            { scale: drop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
          ],
        },
      ]}
    />
  );
}

/** Their drawing, waiting with them. Hops each time a page lands. */
function Character({
  uri,
  landedCount,
  listening,
  reduceMotion,
}: {
  uri: string | null;
  landedCount: number;
  listening: boolean;
  reduceMotion: boolean;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const previousLanded = useRef(landedCount);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: listening ? 700 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: listening ? 700 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, listening, reduceMotion]);

  useEffect(() => {
    if (landedCount === previousLanded.current) return;
    previousLanded.current = landedCount;
    if (reduceMotion) return;
    // A little celebration, tied to a page that genuinely finished.
    Animated.sequence([
      Animated.timing(hop, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(hop, {
        toValue: 0,
        duration: 320,
        easing: Easing.bounce,
        useNativeDriver: true,
      }),
    ]).start();
  }, [landedCount, hop, reduceMotion]);

  const lift = Animated.add(
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }),
  );

  return (
    <Animated.View style={[styles.character, { transform: [{ translateY: lift }] }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.characterImage} resizeMode="contain" />
      ) : (
        <View style={[styles.characterImage, styles.characterFallback]} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scene: { height: 300, marginTop: spacing.lgPlus, justifyContent: 'flex-end' },
  desk: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
    backgroundColor: colour.kraftLight,
    borderTopLeftRadius: radius.cardLg,
    borderTopRightRadius: radius.cardLg,
  },
  sheet: {
    position: 'absolute',
    left: '12%',
    bottom: 104,
    width: 150,
    height: 104,
    borderRadius: radius.card,
    backgroundColor: colour.paperElevated,
    borderWidth: 1,
    borderColor: inkAlpha.border,
    padding: spacing.md,
    gap: 7,
  },
  inkLine: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    backgroundColor: inkAlpha.border,
    transformOrigin: 'left',
  },
  card: {
    position: 'absolute',
    right: '14%',
    borderRadius: radius.card,
    borderWidth: 1,
  },
  cardCover: {
    width: 116,
    height: 142,
    backgroundColor: colour.ink,
    borderColor: colour.ink,
  },
  cardPage: {
    width: 108,
    height: 132,
    backgroundColor: colour.paperElevated,
    borderColor: inkAlpha.border,
  },
  character: { position: 'absolute', left: '16%', bottom: 68 },
  characterImage: { width: 92, height: 92 },
  characterFallback: { backgroundColor: colour.kraftMid, borderRadius: radius.card },
});
