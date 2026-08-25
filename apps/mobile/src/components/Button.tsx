import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colour, hitTarget, radius, spacing, type } from '../theme';
import { Text } from './Text';

type Kind = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Audience = 'child' | 'parent';

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: Kind;
  /** Drives minimum tap-target height — 68pt child, 52pt parent (RULES panel). */
  audience?: Audience;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  testID?: string;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  audience = 'parent',
  disabled,
  loading,
  icon,
  fullWidth = true,
  testID,
}: ButtonProps) {
  const minHeight = audience === 'child' ? hitTarget.child : hitTarget.parent;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { minHeight },
        fullWidth && styles.fullWidth,
        kindStyle[kind],
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? colour.paperElevated : colour.ink} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text
            variant="button"
            color={kind === 'primary' ? colour.paperElevated : kind === 'destructive' ? colour.paperElevated : colour.ink}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.huge,
  },
  fullWidth: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});

const kindStyle = StyleSheet.create({
  primary: { backgroundColor: colour.ink },
  secondary: { backgroundColor: colour.paperCard, borderWidth: 1.5, borderColor: 'rgba(34,32,28,0.14)' },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colour.danger },
});

export { type ButtonProps };
