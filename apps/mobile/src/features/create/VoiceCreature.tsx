import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import type { NarrationVoiceId } from '@papercub/shared';
import { colour } from '../../theme';

/**
 * A face for every voice.
 *
 * A four-year-old cannot read "Marlow — smooth, an old-fashioned storyteller",
 * and will not choose from a list of names. They can absolutely choose the
 * green one with the leaf. So each voice gets a paper-cutout creature, built
 * from the same shapes the rest of the product is made of, and the selected one
 * MOVES ITS MOUTH — which is the whole tell that this thing is going to talk to
 * you.
 *
 * Deliberately not illustrations: these are Views with border radii, so they
 * cost nothing to load, scale to any size, and cannot fail to fetch. The paper
 * character in a Papercub story is the child's own drawing — these are the
 * app's furniture, and they should not compete with it.
 */

interface CreatureLook {
  body: string;
  /** Accent shape above the head. Each voice is recognisable by silhouette. */
  crown: 'ears' | 'leaf' | 'antenna' | 'droop' | 'brim' | 'tuft';
  /** Wide creatures read as friendly, narrow ones as quick. */
  width: number;
  height: number;
}

const LOOKS: Record<NarrationVoiceId, CreatureLook> = {
  papercub_default: { body: '#c9873f', crown: 'ears', width: 46, height: 44 }, // Ivy
  papercub_bramble: { body: '#4a7350', crown: 'leaf', width: 44, height: 46 }, // Bramble
  papercub_pip: { body: '#e0664a', crown: 'antenna', width: 38, height: 48 }, // Pip
  papercub_juniper: { body: '#6d84b0', crown: 'droop', width: 46, height: 42 }, // Juniper
  papercub_marlow: { body: '#6d47bd', crown: 'brim', width: 42, height: 46 }, // Marlow
  papercub_fig: { body: '#b8447e', crown: 'tuft', width: 48, height: 42 }, // Fig
};

export function VoiceCreature({
  voiceId,
  speaking,
}: {
  voiceId: NarrationVoiceId;
  speaking: boolean;
}) {
  const look = LOOKS[voiceId];
  const mouth = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
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
      mouth.setValue(0);
      bob.setValue(0);
      return;
    }
    // Irregular on purpose. A mouth opening on a perfect metronome reads as a
    // loading indicator; uneven timings read as talking.
    const talk = Animated.loop(
      Animated.sequence([
        Animated.timing(mouth, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.35, duration: 110, useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.9, duration: 190, useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.2, duration: 130, useNativeDriver: true }),
      ]),
    );
    const sway = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    talk.start();
    sway.start();
    return () => {
      talk.stop();
      sway.stop();
    };
  }, [speaking, mouth, bob]);

  return (
    <Animated.View
      style={[
        styles.wrap,
        { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] },
      ]}
    >
      <Crown kind={look.crown} tint={look.body} />
      <View
        style={[
          styles.body,
          { backgroundColor: look.body, width: look.width, height: look.height },
        ]}
      >
        <View style={styles.eyes}>
          <View style={styles.eye} />
          <View style={styles.eye} />
        </View>
        <Animated.View
          style={[
            styles.mouth,
            {
              transform: [
                { scaleY: mouth.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.9] }) },
              ],
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

/** The silhouette that makes each voice recognisable before you can read. */
function Crown({ kind, tint }: { kind: CreatureLook['crown']; tint: string }) {
  if (kind === 'ears') {
    return (
      <View style={styles.crownRow}>
        <View style={[styles.ear, { backgroundColor: tint }]} />
        <View style={{ width: 18 }} />
        <View style={[styles.ear, { backgroundColor: tint }]} />
      </View>
    );
  }
  if (kind === 'leaf') {
    return <View style={[styles.leaf, { backgroundColor: tint }]} />;
  }
  if (kind === 'antenna') {
    return (
      <View style={styles.crownRow}>
        <View style={[styles.antennaStalk, { backgroundColor: tint }]} />
        <View style={[styles.antennaTip, { backgroundColor: tint }]} />
      </View>
    );
  }
  if (kind === 'droop') {
    return (
      <View style={styles.crownRow}>
        <View style={[styles.droop, { backgroundColor: tint }]} />
        <View style={{ width: 22 }} />
        <View style={[styles.droop, { backgroundColor: tint }]} />
      </View>
    );
  }
  if (kind === 'brim') {
    return <View style={[styles.brim, { backgroundColor: tint }]} />;
  }
  return (
    <View style={styles.crownRow}>
      <View style={[styles.tuft, { backgroundColor: tint }]} />
      <View style={[styles.tuft, { backgroundColor: tint, height: 12 }]} />
      <View style={[styles.tuft, { backgroundColor: tint }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-end', height: 66 },
  crownRow: { flexDirection: 'row', alignItems: 'flex-end', height: 14 },
  body: { borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 4 },
  eyes: { flexDirection: 'row', gap: 9 },
  eye: { width: 6, height: 6, borderRadius: 3, backgroundColor: colour.paperElevated },
  mouth: {
    width: 12,
    height: 5,
    borderRadius: 3,
    backgroundColor: colour.paperElevated,
    opacity: 0.9,
  },
  ear: { width: 12, height: 12, borderRadius: 6 },
  leaf: { width: 10, height: 16, borderRadius: 6, transform: [{ rotate: '18deg' }] },
  antennaStalk: { width: 3, height: 13, borderRadius: 2 },
  antennaTip: { width: 8, height: 8, borderRadius: 4, marginLeft: -2, marginBottom: 7 },
  droop: { width: 9, height: 14, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  brim: { width: 34, height: 6, borderRadius: 3 },
  tuft: { width: 6, height: 9, borderRadius: 3, marginHorizontal: 1 },
});
