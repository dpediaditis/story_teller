import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text as RNText } from 'react-native';
import type { NarrationVoiceId } from '@papercub/shared';

/**
 * A face for every voice.
 *
 * These were hand-built from Views — circles, ears, a mouth — and the result was
 * genuinely unsettling: flat geometry with two dots and a slot reads as uncanny,
 * not friendly, which is the opposite of what a four-year-old should feel about
 * the thing that is going to read to them.
 *
 * Replaced with system emoji, which is the researched answer rather than the
 * lazy one. The alternatives were bundled sets:
 *
 *   Twemoji    CC BY 4.0     — permissive, but redistribution and an
 *                              attribution notice shipped in the app
 *   OpenMoji   CC BY-SA 4.0  — ShareAlike, which is a licence question nobody
 *                              wants attached to a commercial kids' product
 *
 * System emoji has neither problem: rendering text in the platform font is not
 * redistribution, so there is nothing to bundle, nothing to attribute, and no
 * asset that can fail to load. They are professionally drawn, warm, and already
 * familiar to children. On iOS they are Apple's, which also means they match
 * the rest of the phone.
 *
 * Trade-off, stated: emoji look different per platform, so this is not a way to
 * express brand. That is the right call here — the paper character in a
 * Papercub story is the child's OWN drawing, and the app's furniture should
 * never compete with it.
 */

/** Chosen for how the voice READS, not at random. */
const FACES: Record<NarrationVoiceId, string> = {
  papercub_default: '🐻', // Ivy — warm and steady
  papercub_bramble: '🐨', // Bramble — gentle, for winding down
  papercub_pip: '🦜', // Pip — bright and playful
  papercub_juniper: '🐑', // Juniper — soft and hushed
  papercub_marlow: '🦉', // Marlow — smooth, an old-fashioned storyteller
  papercub_fig: '🦊', // Fig — quick and funny
};

export function VoiceCreature({
  voiceId,
  speaking,
  size = 40,
}: {
  voiceId: NarrationVoiceId;
  speaking: boolean;
  size?: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!cancelled) reduceMotion.current = on;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!speaking || reduceMotion.current) {
      pulse.setValue(0);
      return;
    }
    /* Irregular on purpose. A perfectly even bounce reads as a loading
     * indicator; uneven timing reads as somebody talking. */
    const talk = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.25, duration: 150, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.8, duration: 230, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 170, useNativeDriver: true }),
        Animated.delay(120),
      ]),
    );
    talk.start();
    return () => talk.stop();
  }, [speaking, pulse]);

  return (
    <Animated.View
      style={{
        transform: [
          { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) },
          { translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
        ],
      }}
    >
      <RNText style={[styles.face, { fontSize: size, lineHeight: size * 1.22 }]}>
        {FACES[voiceId]}
      </RNText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  face: { textAlign: 'center' },
});
