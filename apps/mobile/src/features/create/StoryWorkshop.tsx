import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';
import type { JobProgressEvent } from '@papercub/shared';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/**
 * The book being made, on a desk.
 *
 * REBUILT after the first version did not read as anything. That one put a
 * manuscript, a cover and a stack of pages in three different places and let
 * each fade in where it stood — three islands, no relationship between them,
 * and nothing ever moved from one place to another. Every element was correct
 * and the whole thing had no flow, because flow is direction, not motion.
 *
 * So this version has ONE place to look and ONE direction of travel:
 *
 *   the manuscript BECOMES the book   — it crossfades into the stack rather
 *                                       than sitting next to it, so the writing
 *                                       turns into the thing being written
 *   pages FLY IN from the right       — arcing down onto the pile, so every
 *                                       arrival travels the same path
 *   the character watches from the left and hops when one lands
 *
 * The desk is a thin shelf now, not a slab: it was a third of the frame and
 * competing with the book for attention.
 *
 * The rule underneath is unchanged (enums.ts, docs/ARCHITECTURE.md): "Never
 * invent progress." Nothing is on a timer pretending to be work.
 *
 *   the manuscript appears  when the job reaches `writing_story`
 *   the cover lands         when `coverReady` arrives — the real gate-4 pass
 *   a page flies in         once per index in `readablePageIndexes`, one for one
 *
 * The pile IS the progress bar, and it cannot show a page the server has not
 * finished. That is why there is still no percentage.
 */

const STAGES_WITH_BOOK = [
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
  const started = STAGES_WITH_BOOK.includes(stage);
  // The manuscript is only the manuscript until there is a cover; after that it
  // has become the book, so it stops being drawn separately.
  const writing = started && !coverReady;

  return (
    <View style={styles.scene} pointerEvents="none" accessibilityElementsHidden>
      <View style={styles.shelf} />

      <View style={styles.stage}>
        {writing ? (
          <Manuscript active={stage === 'writing_story'} reduceMotion={reduceMotion} />
        ) : null}
        {coverReady ? <Leaf kind="cover" depth={0} reduceMotion={reduceMotion} /> : null}
        {readable.map((pageIndex, i) => (
          <Leaf key={pageIndex} kind="page" depth={i + 1} reduceMotion={reduceMotion} />
        ))}
      </View>

      <Character
        uri={cutoutUri}
        landedCount={readable.length}
        listening={stage === 'narrating'}
        reduceMotion={reduceMotion}
      />
    </View>
  );
}

/**
 * The story being written. Sits exactly where the book will be, so when the
 * cover replaces it the eye reads a transformation rather than a swap.
 */
function Manuscript({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 0 : 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.leaf,
        styles.manuscript,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { rotate: '-2deg' },
          ],
        },
      ]}
    >
      {[0, 1, 2, 3, 4].map((line) => (
        <InkLine key={line} order={line} active={active} reduceMotion={reduceMotion} />
      ))}
    </Animated.View>
  );
}

/** One line of writing, scaling from the left so it reads as a pen moving. */
function InkLine({
  order,
  active,
  reduceMotion,
}: {
  order: number;
  active: boolean;
  reduceMotion: boolean;
}) {
  const draw = useRef(new Animated.Value(reduceMotion || !active ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion || !active) {
      draw.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(order * 170),
        Animated.timing(draw, {
          toValue: 1,
          duration: 560,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay((4 - order) * 170 + 500),
        Animated.timing(draw, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [draw, order, active, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.inkLine,
        order === 4 && { width: '52%' },
        { opacity: draw, transform: [{ scaleX: draw }] },
      ]}
    />
  );
}

/**
 * A finished leaf of the book arriving.
 *
 * Every one travels the same path — in from the right, arcing down and
 * untwisting onto the pile — which is what turns a set of appearing rectangles
 * into a book being built. `depth` lifts and shrinks it slightly so the pile
 * has thickness.
 */
function Leaf({
  kind,
  depth,
  reduceMotion,
}: {
  kind: 'cover' | 'page';
  depth: number;
  reduceMotion: boolean;
}) {
  const fly = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(fly, {
      toValue: 1,
      duration: reduceMotion ? 0 : 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fly, reduceMotion]);

  const settledTilt = ((depth % 3) - 1) * 2;

  return (
    <Animated.View
      style={[
        styles.leaf,
        kind === 'cover' ? styles.cover : styles.page,
        {
          bottom: depth * 6,
          zIndex: depth,
          opacity: fly,
          transform: [
            { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [140, 0] }) },
            { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [-56, 0] }) },
            {
              rotate: fly.interpolate({
                inputRange: [0, 1],
                outputRange: ['16deg', `${settledTilt}deg`],
              }),
            },
            { scale: fly.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1 - depth * 0.012] }) },
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
          duration: listening ? 620 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: listening ? 620 : 1500,
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
    // Tied to a page that genuinely finished, so the celebration is earned.
    Animated.sequence([
      Animated.timing(hop, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(hop, {
        toValue: 0,
        duration: 340,
        easing: Easing.bounce,
        useNativeDriver: true,
      }),
    ]).start();
  }, [landedCount, hop, reduceMotion]);

  const lift = Animated.add(
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }),
  );

  if (!uri) {
    // No drawing to show yet — better an empty stage than a grey box standing
    // in for a child's character.
    return null;
  }

  return (
    <Animated.View style={[styles.character, { transform: [{ translateY: lift }] }]}>
      <Image source={{ uri }} style={styles.characterImage} resizeMode="contain" />
    </Animated.View>
  );
}

const LEAF_W = 104;
const LEAF_H = 130;

const styles = StyleSheet.create({
  scene: { height: 236, marginTop: spacing.lgPlus, marginBottom: spacing.sm },
  // A shelf line, not a slab. The first version gave this a third of the frame
  // and it competed with the book for attention.
  shelf: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 26,
    height: 10,
    borderRadius: 5,
    backgroundColor: colour.kraftLight,
  },
  /** Everything the book is made of shares one anchor, so it reads as one object. */
  stage: {
    position: 'absolute',
    right: '16%',
    bottom: 32,
    width: LEAF_W,
    height: LEAF_H,
  },
  leaf: {
    position: 'absolute',
    left: 0,
    width: LEAF_W,
    height: LEAF_H,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  manuscript: {
    bottom: 0,
    backgroundColor: colour.paperElevated,
    borderColor: inkAlpha.border,
    padding: spacing.md,
    gap: 8,
    justifyContent: 'center',
  },
  inkLine: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    backgroundColor: inkAlpha.border,
    transformOrigin: 'left',
  },
  cover: { backgroundColor: colour.ink, borderColor: colour.ink },
  page: { backgroundColor: colour.paperElevated, borderColor: inkAlpha.border },
  character: { position: 'absolute', left: '13%', bottom: 30 },
  characterImage: { width: 96, height: 96 },
});
