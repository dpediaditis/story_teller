import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, Button, EyebrowLabel } from '../../src/components';
import { BoboDrawing, NightSky } from '../../src/components/illustrations';
import { colour, inkAlpha, radius, spacing, themeColour } from '../../src/theme';

/**
 * A1 — Welcome. The whole pitch is one before/after: the drawing a child made,
 * and that same drawing standing in a story.
 *
 * The character is the only illustration on the screen, which is the design
 * direction and also the product's argument — every competitor replaces the
 * child's drawing with a polished character, and this screen exists to show
 * that we do not. Bobo is therefore deliberately wonky in both panels, and it
 * is recognisably the SAME wonky drawing in each.
 *
 * The word "AI" appears nowhere here, by rule.
 */
export default function Welcome() {
  const rise = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (cancelled) return;
      reduceMotion.current = enabled;

      if (enabled) {
        rise.setValue(1);
        return;
      }

      // One orchestrated entrance: the paper settles, then the book panel
      // arrives beneath it. Staggered by the driver below, not by timers.
      Animated.timing(rise, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      // Bobo breathes. 3.4s cycle — slow enough to read as alive rather than
      // animated, which matters on a bedtime product.
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, {
            toValue: 1,
            duration: 1700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(float, {
            toValue: 0,
            duration: 1700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start();
    });

    return () => {
      cancelled = true;
    };
  }, [rise, float]);

  const paperStyle = {
    opacity: rise,
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { rotate: '-1.5deg' },
    ],
  };

  const bookStyle = {
    opacity: rise.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }),
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
    ],
  };

  const bob = {
    transform: [
      { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
    ],
  };

  return (
    <Screen>
      <View style={styles.content}>
        {/* ON PAPER — the drawing as it was made, taped down like a real one. */}
        <Animated.View style={[styles.paper, paperStyle]}>
          <View style={[styles.tape, styles.tapeLeft]} />
          <View style={[styles.tape, styles.tapeRight]} />
          <EyebrowLabel>ON PAPER</EyebrowLabel>
          <View style={styles.drawingWrap}>
            <BoboDrawing size={168} mood="paper" />
          </View>
        </Animated.View>

        {/* IN THEIR BOOK — the same drawing, now somewhere. */}
        <Animated.View style={[styles.book, bookStyle]}>
          <NightSky width={320} height={210} reduceMotion={reduceMotion.current} />
          <View style={styles.bookInner}>
            <EyebrowLabel color="rgba(246,241,231,.65)">IN THEIR BOOK</EyebrowLabel>
            <Animated.View style={[styles.bookCharacter, bob]}>
              <BoboDrawing size={118} mood="book" />
            </Animated.View>
            <Text variant="sectionHeading" color={colour.paperElevated} style={styles.bookLine}>
              Bobo checked behind the clouds.
            </Text>
          </View>
        </Animated.View>

        <View style={styles.copy}>
          <Text variant="sectionHeading" style={styles.headline}>
            Their drawing.{'\n'}Their story.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Start" onPress={() => router.push('/onboarding/how-it-works')} />
        <Text variant="captionMono" color={inkAlpha.textLabel} style={styles.footNote}>
          No account. Nothing shared with anyone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.xxl, justifyContent: 'center', gap: spacing.xl },

  paper: {
    backgroundColor: colour.paperElevated,
    borderRadius: radius.cardLg,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    alignSelf: 'center',
    width: '86%',
    shadowColor: colour.ink,
    shadowOpacity: 0.13,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  tape: {
    position: 'absolute',
    top: -9,
    width: 58,
    height: 20,
    backgroundColor: colour.kraft,
    opacity: 0.75,
  },
  tapeLeft: { left: 16, transform: [{ rotate: '-7deg' }] },
  tapeRight: { right: 16, transform: [{ rotate: '6deg' }] },
  drawingWrap: { alignItems: 'center', marginTop: spacing.xs },

  book: {
    backgroundColor: themeColour.space.fill,
    borderRadius: radius.cardLg,
    overflow: 'hidden',
    minHeight: 210,
  },
  bookInner: { padding: spacing.huge, alignItems: 'center', gap: spacing.sm },
  bookCharacter: { marginTop: spacing.xs },
  bookLine: { textAlign: 'center' },

  copy: { alignItems: 'center' },
  headline: { textAlign: 'center' },

  footer: { padding: spacing.xxl, gap: spacing.md },
  footNote: { textAlign: 'center' },
});
