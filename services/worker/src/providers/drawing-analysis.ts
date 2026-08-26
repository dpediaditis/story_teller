/**
 * Normalises what a vision model actually returns into the shape
 * `DrawingAnalysis` requires.
 *
 * PLAN.html §8 puts provider quirks in the adapter, and this is the clearest
 * case of it in the codebase. `character_build` failed 100% of the time —
 * never once succeeded — because Gemini answers honestly and off-schema:
 *
 *   dominantColours: ["purple", "white", "dark grey"]   <- not #rrggbb
 *   suggestedTraits: [4 items]                          <- cap is 3
 *   subjectGuess:    59 characters                      <- cap is 60
 *
 * The first two are the reported failures. The third is the one that matters
 * more: a measured 59 against a 60 cap is a coin flip, so the next run fails
 * somewhere else and the bug looks like a different bug.
 *
 * The contract stays strict. What is absorbed here is only ever DECORATIVE or
 * a PROPOSAL: `palette` tints a card, and `suggestedTraits` are suggestions a
 * parent explicitly approves. Failing a whole character build — the very first
 * thing a real user does, photograph a drawing and wait — over the string
 * "dark grey" is disproportionate to what the field is for.
 *
 * What is NOT absorbed: `distinguishingFeatures` becomes `feature_anchor`, which
 * every later illustration prompt is conditioned on. It is load-bearing, so it
 * is clamped at a word boundary rather than being dropped or truncated
 * mid-word, and an empty one still fails the parse in character.ts.
 */

import type { DrawingAnalysis } from '@papercub/shared';

/**
 * The CSS named colours, which is what a vision model reaches for when asked
 * for a colour and not told to use hex. Canonical values — a partial table
 * would silently drop legitimate palette entries.
 */
const CSS_COLOUR_NAMES: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff',
  aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc',
  bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd',
  blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
  chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc', crimson: '#dc143c', cyan: '#00ffff',
  darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f',
  darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
  deepskyblue: '#00bfff', dimgray: '#696969', dodgerblue: '#1e90ff',
  firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff',
  gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
  green: '#008000', greenyellow: '#adff2f', honeydew: '#f0fff0',
  hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
  ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd',
  lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90',
  lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa', lightslategray: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
  oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
  palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9',
  peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460',
  seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
  silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080',
  thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0',
  violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',};

/**
 * Terms a model uses that CSS has no entry for. Deliberately short: a guess
 * here becomes a wrong colour on a child's character card, which is worse than
 * one fewer swatch.
 */
const COLOUR_ALIASES: Record<string, string> = {
  offwhite: '#f5f5f5',
  cream: '#fffdd0',
  darkbrown: '#5c4033',
  lightbrown: '#b5651d',
  peach: '#ffdab9',
  mustard: '#ffdb58',
  burgundy: '#800020',
  charcoal: '#36454f',
  skin: '#f1c27d',
  multicoloured: '',
  multicolored: '',
  rainbow: '',
  transparent: '',
  none: '',
};

const HEX = /^[0-9a-f]+$/;

/**
 * One colour string -> `#rrggbb`, or null if it cannot be known.
 *
 * Handles `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, the same four without the
 * hash, `rgb()`/`rgba()`, and a colour name. Alpha is dropped rather than
 * composited: `palette` has nothing to composite against.
 */
export function toHexColour(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  // rgb(124, 79, 196) / rgba(124 79 196 / 0.5)
  const rgb = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (rgb) {
    const parts = rgb[1]!
      .split(/[,/\s]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((p) => {
      const pct = p.endsWith('%');
      const n = Number.parseFloat(pct ? p.slice(0, -1) : p);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(255, Math.round(pct ? (n / 100) * 255 : n)));
    });
    if (channels.some((c) => c === null)) return null;
    return `#${channels.map((c) => c!.toString(16).padStart(2, '0')).join('')}`;
  }

  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;

  if (HEX.test(body)) {
    // 4 and 8 carry alpha; drop it. 3 is shorthand; expand it.
    if (body.length === 3 || body.length === 4) {
      return `#${[...body.slice(0, 3)].map((c) => c + c).join('')}`;
    }
    if (body.length === 6 || body.length === 8) return `#${body.slice(0, 6)}`;
    return null;
  }

  // "dark grey", "Light-Blue", "dark_grey" all name the same CSS colour once
  // the separators go. `grey` -> `gray` because CSS spells it the American way
  // and the model, asked for British copy, does not.
  const word = body.replace(/[\s_-]+/g, '').replace(/grey/g, 'gray');
  const named = CSS_COLOUR_NAMES[word] ?? COLOUR_ALIASES[word];
  // An alias mapping to '' is a known non-colour ("rainbow"): recognised, and
  // deliberately dropped rather than guessed at.
  return named && named.length > 0 ? named : null;
}

/** Trims to `max` on a word boundary, so a feature anchor never ends mid-word. */
function clampText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function clampList(raw: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text = clampText(item, maxChars);
    if (text.length === 0) continue;
    if (out.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

const MEDIA = ['crayon', 'marker', 'pencil', 'paint', 'mixed', 'unknown'] as const;
const LINE_QUALITIES = ['bold', 'light', 'sketchy', 'mixed'] as const;

/**
 * Coerces a raw vision response into the DrawingAnalysis shape. Caps mirror
 * contract.ts exactly — if one moves there, it moves here.
 *
 * This never throws: an unusable response still produces a parseable object,
 * and `DrawingAnalysis.safeParse` in character.ts remains the real gate. What
 * it cannot do is invent `distinguishingFeatures` — a response with none still
 * fails there, which is correct, because that is the field the whole character
 * is rebuilt from.
 */
export function normaliseDrawingAnalysis(raw: unknown): DrawingAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>;

  const colours: string[] = [];
  for (const candidate of Array.isArray(o.dominantColours) ? o.dominantColours : []) {
    const hex = toHexColour(candidate);
    if (hex && !colours.includes(hex)) colours.push(hex);
    if (colours.length === 6) break;
  }

  return {
    subjectGuess: clampText(o.subjectGuess, 60),
    dominantColours: colours,
    distinguishingFeatures: clampList(o.distinguishingFeatures, 6, 60),
    medium: oneOf(o.medium, MEDIA, 'unknown'),
    lineQuality: oneOf(o.lineQuality, LINE_QUALITIES, 'mixed'),
    suggestedTraits: clampList(o.suggestedTraits, 3, 30),
    suggestedType: clampText(o.suggestedType, 30),
  };
}
