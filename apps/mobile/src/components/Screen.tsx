import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colour } from '../theme';

interface ScreenProps {
  children?: ReactNode;
  background?: string;
  edges?: Edge[];
  style?: ViewStyle;
}

/** Standard paper-ground screen wrapper. Every route renders one of these. */
export function Screen({ children, background = colour.paperGround, edges, style }: ScreenProps) {
  return (
    <SafeAreaView
      edges={edges ?? ['top', 'left', 'right', 'bottom']}
      style={[styles.root, { backgroundColor: background }, style]}
    >
      <View style={styles.fill}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
});
