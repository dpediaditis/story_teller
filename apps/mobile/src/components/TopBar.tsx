import { Pressable, StyleSheet, View } from 'react-native';
import { colour, inkAlpha, spacing } from '../theme';
import { Text } from './Text';

interface TopBarProps {
  title?: string;
  onBack?: () => void;
  onClose?: () => void;
  right?: React.ReactNode;
}

/** Shared header: back chevron (‹) or close (×), title, optional right slot. */
export function TopBar({ title, onBack, onClose, right }: TopBarProps) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable hitSlop={12} onPress={onBack} style={styles.circleBtn}>
            <Text variant="button" color={colour.ink}>‹</Text>
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable hitSlop={12} onPress={onClose} style={styles.circleBtn}>
            <Text variant="button" color={colour.ink}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {title ? (
        <Text variant="label" style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.side, styles.rightSide]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  side: { width: 40, alignItems: 'flex-start' },
  rightSide: { width: undefined, minWidth: 40, alignItems: 'flex-end', flex: 0 },
  title: { flex: 1, textAlign: 'center' },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: inkAlpha.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
