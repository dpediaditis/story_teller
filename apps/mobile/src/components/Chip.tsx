import { Pressable, StyleSheet } from 'react-native';
import { colour, inkAlpha, radius, spacing } from '../theme';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  audience?: 'child' | 'parent';
}

/** Pill selector used for adventure themes, moods, lengths. */
export function Chip({ label, selected, onPress, audience = 'parent' }: ChipProps) {
  const minHeight = audience === 'child' ? 68 : 44;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.base, { minHeight }, selected ? styles.selected : styles.unselected]}
    >
      <Text variant="label" color={selected ? colour.paperElevated : colour.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colour.ink },
  unselected: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: inkAlpha.borderStrong },
});
