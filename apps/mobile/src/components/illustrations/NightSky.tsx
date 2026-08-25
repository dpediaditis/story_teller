import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The space scene Bobo is standing in on the "in their book" panel.
 *
 * Illustrated rather than photographic, and kept quiet: the character is the
 * subject, the world is the backdrop. Stars breathe slowly (a 4s cycle) so the
 * page feels alive without becoming a game screen — the design direction rules
 * out overstimulating motion, and a bedtime product especially cannot flicker.
 *
 * Honours prefers-reduced-motion by simply not starting the animation.
 */

const STARS = [
  { x: 18, y: 22, r: 2.2, delay: 0 },
  { x: 46, y: 12, r: 1.4, delay: 900 },
  { x: 74, y: 26, r: 1.8, delay: 1800 },
  { x: 88, y: 54, r: 1.3, delay: 600 },
  { x: 12, y: 58, r: 1.6, delay: 2400 },
  { x: 62, y: 44, r: 1.1, delay: 1400 },
  { x: 32, y: 40, r: 1.3, delay: 3000 },
];

type Props = { width: number; height: number; reduceMotion?: boolean };

export function NightSky({ width, height, reduceMotion = false }: Props) {
  const twinkle = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(twinkle, {
          toValue: 0.45,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, twinkle]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: twinkle }]}>
        <Svg width={width} height={height} viewBox="0 0 100 70">
          {STARS.map((s, i) => (
            <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f6f1e7" />
          ))}
        </Svg>
      </Animated.View>

      {/* The missing moon, half behind a cloud — the story's own premise. */}
      <Svg width={width} height={height} viewBox="0 0 100 70" style={StyleSheet.absoluteFill}>
        <Circle cx={80} cy={18} r={9} fill="#f0e6cc" opacity={0.9} />
        <Path
          d="M62 24 C66 18, 76 18, 79 24 C86 23, 90 28, 86 32 L60 32 C55 30, 57 24, 62 24 Z"
          fill="#3a4675"
          opacity={0.85}
        />
      </Svg>
    </View>
  );
}
