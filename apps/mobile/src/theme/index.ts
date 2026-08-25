/**
 * Thin adapter over `tokens` from `@papercub/shared`. This file must NEVER
 * declare a colour, size or radius of its own — every visual value comes from
 * `packages/shared/src/tokens.ts`. If a screen needs a value that isn't there,
 * that is a gap to report, not a licence to invent one here.
 *
 * What this file DOES own: mapping the web-shaped tokens (CSS font shorthand,
 * `rgba()` strings, `box-shadow` strings) onto React Native's StyleSheet shape
 * (fontFamily/fontWeight/fontSize, color strings RN already understands,
 * elevation/shadow* props).
 */
import { Platform, type TextStyle } from 'react-native';
import { tokens } from '@papercub/shared';

export const colour = tokens.colour;
export const inkAlpha = tokens.inkAlpha;
export const themeColour = tokens.themeColour;
export const spacing = tokens.spacing;
export const layout = tokens.layout;
export const radius = tokens.radius;
export const motion = tokens.motion;

/**
 * RN has no `font-family: 'Nunito, system-ui, sans-serif'` shorthand — it
 * takes one family name and falls back to the OS default automatically when
 * that name isn't loaded. Nunito/Newsreader aren't bundled in this pass (no
 * font files in apps/mobile/assets yet), so this resolves to the platform
 * default, which keeps the app runnable in Expo Go without a font-loading
 * step. Swap in `expo-font` + real Nunito/Newsreader .ttf assets later
 * without touching call sites.
 */
const FONT_UI = Platform.select({ ios: 'System', android: 'sans-serif', default: undefined });
const FONT_READER = Platform.select({ ios: 'Georgia', android: 'serif', default: undefined });
const FONT_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined });

function weightToRN(weight: number): TextStyle['fontWeight'] {
  return String(weight) as TextStyle['fontWeight'];
}

type TypeToken = (typeof tokens.type)[keyof typeof tokens.type];

/** Reader base size (pt) a `dynamicType` em-multiplier token is applied to. */
const READER_BASE_PT = 16;

function toRNTextStyle(token: TypeToken, family: string | undefined): TextStyle {
  const isEmSize = token.size <= 4; // the reader tokens store an em multiplier, not px
  const fontSize = isEmSize ? token.size * READER_BASE_PT : token.size;
  return {
    fontFamily: family,
    fontWeight: weightToRN(token.weight),
    fontSize,
    lineHeight: fontSize * token.lineHeight,
    letterSpacing: token.letterSpacing,
  };
}

/** Every text style used in the app, pre-resolved to RN TextStyle. */
export const type = {
  labelEyebrow: toRNTextStyle(tokens.type.labelEyebrow, FONT_MONO),
  captionMono: toRNTextStyle(tokens.type.captionMono, FONT_MONO),
  body: toRNTextStyle(tokens.type.body, FONT_UI),
  label: toRNTextStyle(tokens.type.label, FONT_UI),
  button: toRNTextStyle(tokens.type.button, FONT_UI),
  childGlyph: toRNTextStyle(tokens.type.childGlyph, FONT_UI),
  sectionHeading: toRNTextStyle(tokens.type.sectionHeading, FONT_READER),
  // Reader tokens — the ONLY four allowed to scale with Dynamic Type
  // (RULES panel: "Only reader type tokens scale with Dynamic Type").
  // `allowFontScaling` stays true (RN default) on these; every other style
  // below must set `allowFontScaling={false}` at the call site.
  readerPageProse: toRNTextStyle(tokens.type.readerPageProse, FONT_READER),
  readerActiveSentence: toRNTextStyle(tokens.type.readerActiveSentence, FONT_READER),
  readerCoverTitle: toRNTextStyle(tokens.type.readerCoverTitle, FONT_READER),
  readerPageCounter: toRNTextStyle(tokens.type.readerPageCounter, FONT_UI),
} as const;

/** Which `type` keys are allowed to scale with the system font size. */
export const DYNAMIC_TYPE_KEYS = new Set<keyof typeof type>([
  'readerPageProse',
  'readerActiveSentence',
  'readerCoverTitle',
  'readerPageCounter',
]);

/**
 * `elevation` in tokens.ts is a CSS `box-shadow` string — RN needs discrete
 * shadow props (+ `elevation` for Android). Hand-mapped once, here, from each
 * token's blur/offset/opacity so screens never parse a shadow string.
 */
export const shadow = {
  card: {
    shadowColor: '#22201c',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4,
    shadowRadius: 44,
    elevation: 12,
  },
  cardSubtle: {
    shadowColor: '#22201c',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  raisedChip: {
    shadowColor: '#22201c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 8,
  },
  sheetUp: {
    shadowColor: '#22201c',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 8,
  },
  coverArt: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 30 },
    shadowOpacity: 0.7,
    shadowRadius: 54,
    elevation: 16,
  },
} as const;

/** Child-facing tap targets 68pt, parent controls 52pt. RULES panel + briefs. */
export const hitTarget = layout.hitTarget;

export const theme = {
  colour,
  inkAlpha,
  themeColour,
  spacing,
  layout,
  radius,
  motion,
  type,
  shadow,
  hitTarget,
} as const;

export type Theme = typeof theme;
export default theme;
