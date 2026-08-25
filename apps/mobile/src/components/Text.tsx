import { Text as RNText, type TextProps } from 'react-native';
import { colour, inkAlpha, type, DYNAMIC_TYPE_KEYS } from '../theme';

type Variant = keyof typeof type;

interface AppTextProps extends TextProps {
  variant?: Variant;
  color?: string;
}

/**
 * Every piece of copy in the app should render through this component so type
 * tokens and the Dynamic-Type allow-list stay centralised. `allowFontScaling`
 * is forced false for every variant except the four reader tokens
 * (RULES panel: "Only reader type tokens scale with Dynamic Type").
 */
export function Text({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const variantStyle = type[variant];
  const allowFontScaling = DYNAMIC_TYPE_KEYS.has(variant);
  return (
    <RNText
      {...rest}
      allowFontScaling={allowFontScaling}
      style={[variantStyle, { color: color ?? colour.ink }, style]}
    />
  );
}

export function EyebrowLabel(props: AppTextProps) {
  return <Text variant="labelEyebrow" color={inkAlpha.textSecondary} {...props} />;
}

export function BodyMuted(props: AppTextProps) {
  return <Text variant="body" color={inkAlpha.textBody} {...props} />;
}
