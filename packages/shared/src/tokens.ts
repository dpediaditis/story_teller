/**
 * Design tokens for Papercub, extracted from `design_v2/Papercub iOS MVP.dc.html`
 * (the canonical ~40-artboard iPhone MVP mock, 393pt-wide artboards, so px === pt).
 *
 * Every value below is copied verbatim from that file (grep the hex/px/rgba string
 * to find its artboard) — nothing here is invented. The one flagged exception is
 * `themeColour.dinosaurs.deep`, noted at its definition.
 *
 * ART DIRECTION (from the file's own DIRECTION panel, near the top):
 *   "The drawing is the only illustration the interface is allowed to have.
 *    Everything around it is paper: warm off-white grounds, hairline rules,
 *    no gradients, no glass. Story type is a bookish serif so the reader
 *    feels like a book and the app feels like a tool."
 *   Palette callout: "paper · ink · crayon violet (primary) · marigold (warn)
 *    · brick (destructive only)"
 *
 * RULES THE DESIGN HELD ITSELF TO (also from the file, keep the app consistent):
 *   - Child screens (camera, name, adventure, reader) work with glyphs and one
 *     word. Parent screens may use sentences.
 *   - Two type sizes for parents, four for the reader — the reader scales with
 *     Dynamic Type, everything else is fixed.
 *   - Child-facing tap targets 68px. Parent controls 52px.
 *   - The word "AI" appears nowhere in onboarding, the paywall, or any child screen.
 *   - Progress is described, never estimated. No percentages, no fake bars.
 *
 * GOVERNANCE: this file is the single source of truth for design values.
 * A new colour, size, or radius needed anywhere in the app must be added here
 * FIRST (with a comment pointing at where it appears in the .dc.html), then
 * consumed by name. Never hex-literal or magic-number a design value in
 * app/worker code.
 */

/* ── Colour ────────────────────────────────────────────────────────────── */

export const colour = {
  // Ink — the near-black text/ink colour used everywhere as `#22201c` or as
  // the base of the `inkAlpha` ramp below.
  ink: '#22201c',

  // Warm off-white grounds ("paper"). Multiple near-white surfaces are used
  // deliberately for stacked-paper depth (page bg vs. card vs. elevated chip).
  paperBody: '#efe9dc', // <body> background
  paperGround: '#fbf7f0', // most common screen/card background (55 occurrences)
  paperGroundAlt: '#f7f1e6', // reader screen background variant
  paperSurface: '#f6f1e7', // secondary surface / chip background
  paperCard: '#f1ead9', // card-on-ground background (e.g. character card)
  paperElevated: '#fdfbf7', // elevated / on-dark text colour, button label colour
  paperElevatedAlt: '#fdfcfa', // small elevated chip background (avatar tiles)

  // Violet accent ("crayon violet (primary)") and its variants.
  violet: '#6d47bd',
  violetHover: '#4b2d8c', // a:hover colour
  violetDeep: '#5b3aa2', // deeper violet used for text-on-tint (e.g. "Purple monster" pill text)
  violetTint: '#efe7fb', // pale violet tinted background (pill/badge fill)

  // Warning (marigold) and destructive (brick) — DIRECTION panel: "marigold
  // (warn) · brick (destructive only)".
  warning: '#d98c1f',
  warningDeep: '#8a5a10', // darker marigold used for on-warning-tint text
  danger: '#a8412f',

  // Success — capture-guidance "steady" indicator dot (C-flow "Hold still…").
  success: '#7ec98d',

  // Paper/kraft neutrals — used for illustration placeholders and dividers.
  kraft: '#e5d9c1',
  kraftDark: '#dccfb3',
  kraftLight: '#f0e6cc',
  kraftLighter: '#e9dfcc',
  kraftMid: '#e1d5be',
} as const;

/* ── Ink-at-opacity ────────────────────────────────────────────────────── */

/**
 * The design uses `rgba(34,32,28,X)` (ink at opacity) instead of a grey ramp.
 * Named by the role each opacity plays most often in the file. Frequencies
 * noted are occurrence counts in the .dc.html, to guide which are "load-bearing".
 */
export const inkAlpha = {
  hairline: 'rgba(34,32,28,0.1)', // 1px borders/dividers (87 occurrences)
  divider: 'rgba(34,32,28,0.07)', // faint separators / icon-button fills
  border: 'rgba(34,32,28,0.12)', // card/sheet borders (54 occurrences)
  borderStrong: 'rgba(34,32,28,0.14)', // input/track borders, pressed chip borders
  focusRing: 'rgba(34,32,28,0.18)',
  overlayLight: 'rgba(34,32,28,0.2)',
  inactiveDot: 'rgba(34,32,28,0.22)', // pagination dots, inactive state
  disabled: 'rgba(34,32,28,0.28)', // home-indicator bar, disabled fill
  textFaint: 'rgba(34,32,28,0.3)',
  textMuted: 'rgba(34,32,28,0.4)', // secondary label ink (62 occurrences)
  textSecondary: 'rgba(34,32,28,0.45)', // mono eyebrow / caption ink (34 occurrences)
  textLabel: 'rgba(34,32,28,0.5)', // timestamps, small captions (62 occurrences)
  textBody: 'rgba(34,32,28,0.55)', // most common body/secondary copy ink (82 occurrences)
  textStrong: 'rgba(34,32,28,0.6)',
  textEmphasis: 'rgba(34,32,28,0.65)',
  textHeavy: 'rgba(34,32,28,0.7)',
  scrim: 'rgba(20,18,16,0.34)', // full-bleed modal scrim, `box-shadow:0 0 0 9999px`
} as const;

/* ── Per-theme adventure card colours ─────────────────────────────────── */

/**
 * The six adventure themes (`StoryTheme` enum), each with a card `fill` and a
 * darker `deep` used as a left "spine" edge / accent (book-spine motif).
 * Extracted from the "Pick an adventure" (C1) artboard and the library
 * book-spine artboards.
 */
export const themeColour = {
  space: { fill: '#2b3560', deep: '#1d2545' },
  dinosaurs: {
    fill: '#3d5b3f',
    // NOTE: no literal "deep dinosaurs" hex appears anywhere in the .dc.html —
    // every other theme pairs a fill with a spine colour at ~73% of its RGB
    // channels (see space/underwater/magic/pirates/jungle below); this value
    // is derived by that same ratio, NOT copied from the file. Flag for design
    // confirmation before shipping a dinosaur book-spine or pressed state.
    deep: '#2d422e',
  },
  underwater: { fill: '#1f5163', deep: '#163c4a' },
  magic: { fill: '#4b3179', deep: '#38235c' },
  pirates: { fill: '#7c3a2c', deep: '#5e2a1f' },
  jungle: { fill: '#4f5c25', deep: '#3b4519' },
} as const;

/* ── Font families ─────────────────────────────────────────────────────── */

export const fontFamily = {
  ui: 'Nunito, system-ui, sans-serif', // all chrome, labels, buttons
  reader: 'Newsreader, Georgia, serif', // story prose, titles, headlines
  mono: 'ui-monospace, Menlo, monospace', // section-label eyebrows ("C1", "READY TO READ")
} as const;

/* ── Type scale ────────────────────────────────────────────────────────── */

/**
 * Each entry mirrors a `font:` shorthand literally present in the .dc.html.
 * `dynamicType: true` is set ONLY for the four reader tokens the design calls
 * out ("story text scales with Dynamic Type"): page prose, cover title, the
 * active narrated sentence, and the page counter. Every other token is fixed
 * ("Two type sizes for parents, four for the reader").
 */
export const type = {
  // Mono eyebrow / section-label — e.g. "C1", "DIRECTION", "READY TO READ".
  labelEyebrow: {
    family: fontFamily.mono,
    weight: 800,
    size: 10.5,
    lineHeight: 1,
    letterSpacing: 1.2,
    dynamicType: false,
  },
  // Mono caption — artboard sub-copy, small metadata.
  captionMono: {
    family: fontFamily.mono,
    weight: 400,
    size: 11.5,
    lineHeight: 1.45,
    letterSpacing: 0,
    dynamicType: false,
  },
  // Nunito body copy (parent-facing sentences).
  body: {
    family: fontFamily.ui,
    weight: 400,
    size: 15,
    lineHeight: 1.5,
    letterSpacing: 0,
    dynamicType: false,
  },
  // Small UI label (chip text, "Page 3 of 6" style non-reader labels).
  label: {
    family: fontFamily.ui,
    weight: 700,
    size: 13.5,
    lineHeight: 1,
    letterSpacing: 0,
    dynamicType: false,
  },
  // Primary button label.
  button: {
    family: fontFamily.ui,
    weight: 800,
    size: 17,
    lineHeight: 1,
    letterSpacing: 0,
    dynamicType: false,
  },
  // Large glyph/one-word child-facing UI (adventure card titles, etc).
  childGlyph: {
    family: fontFamily.ui,
    weight: 800,
    size: 18,
    lineHeight: 1,
    letterSpacing: 0,
    dynamicType: false,
  },
  // Section heading (e.g. "Library", "Reading" section titles).
  sectionHeading: {
    family: fontFamily.reader,
    weight: 500,
    size: 24,
    lineHeight: 1.1,
    letterSpacing: 0,
    dynamicType: false,
  },

  /* — Reader tokens: the four that scale with Dynamic Type — */

  // Story page prose, D1/D2 reader artboards: `font:400 1.42em/1.5 Newsreader`.
  // `size` is expressed in rem/em multiplier (1.42) — apply on top of the
  // platform's Dynamic Type base size, not as an absolute px value.
  readerPageProse: {
    family: fontFamily.reader,
    weight: 400,
    size: 1.42, // em multiplier, not px
    lineHeight: 1.5,
    letterSpacing: -0.2,
    dynamicType: true,
  },
  // The currently-narrated sentence gets a marigold highlight wash, not a
  // different ink colour — same type size as readerPageProse.
  readerActiveSentence: {
    family: fontFamily.reader,
    weight: 400,
    size: 1.42, // em multiplier, matches readerPageProse
    lineHeight: 1.52,
    letterSpacing: 0,
    dynamicType: true,
  },
  // Story cover title, C4 "Cover reveal": `font:500 32px/1.08 Newsreader`.
  readerCoverTitle: {
    family: fontFamily.reader,
    weight: 500,
    size: 32,
    lineHeight: 1.08,
    letterSpacing: 0,
    dynamicType: true,
  },
  // Reader page counter, D2 "Page 3 of 6": `font:700 13.5px/1 Nunito`.
  readerPageCounter: {
    family: fontFamily.ui,
    weight: 700,
    size: 13.5,
    lineHeight: 1,
    letterSpacing: 0,
    dynamicType: true,
  },
} as const;

/* ── Spacing ───────────────────────────────────────────────────────────── */

/** Common `gap`/`padding` step values observed across the artboards. */
export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  smMd: 9,
  md: 12,
  lg: 14,
  lgPlus: 16,
  xl: 18,
  xxl: 20,
  xxxl: 22,
  huge: 24,
  section: 30,
} as const;

/* ── Layout ────────────────────────────────────────────────────────────── */

export const layout = {
  screenWidth: 393, // iPhone artboard width in pt, matches px in the .dc.html
  screenHeight: 852,
  // "Child-facing tap targets 68px. Parent controls 52px." (RULES panel).
  hitTarget: {
    child: 68,
    parent: 52,
  },
  contentInset: 14, // margin used around full-bleed art (e.g. reader image slot)
} as const;

/* ── Radius ────────────────────────────────────────────────────────────── */

export const radius = {
  xs: 2,
  sm: 4,
  chip: 6,
  input: 10,
  cardSm: 14,
  card: 18,
  cardLg: 22,
  sheet: 20,
  screenFrame: 46, // device-frame corner radius used throughout the artboards
  pill: 999,
} as const;

/* ── Elevation ─────────────────────────────────────────────────────────── */

/** Box-shadow recipes, copied verbatim from the .dc.html. */
export const elevation = {
  // The device-frame shadow used on almost every artboard mock (44 occurrences).
  card: '0 20px 44px -20px rgba(34,32,28,0.4)',
  cardSubtle: '0 6px 16px -8px rgba(34,32,28,0.35)',
  raisedChip: '0 10px 22px -10px rgba(34,32,28,0.5)',
  sheetUp: '0 -6px 22px -12px rgba(34,32,28,0.3)',
  modalScrim: '0 0 0 9999px rgba(20,18,16,0.34)',
  coverArt: '0 30px 54px -18px rgba(0,0,0,0.7)', // book-cover artboard drop shadow
  focusHalo: '0 0 0 5px rgba(217,140,31,0.28)', // marigold focus/active-sentence halo
} as const;

/* ── Motion ────────────────────────────────────────────────────────────── */

/** Animation durations copied from the .dc.html `@keyframes` usages. */
export const motion = {
  blinkFast: 1100, // pcbl 1.1s steps(1,end) infinite — recording indicator
  blinkSlow: 1800, // pcbl 1.8s ease-in-out infinite
  blinkMedium: 1200, // pcbl 1.2s ease-in-out infinite
  spinFast: 1400, // pcsp 1.4s linear infinite
  spinSlow: 2600, // pcsp 2.6s linear infinite
  ringPulse: 1500, // pcring 1.5s ease-out infinite — capture guidance ring
} as const;

/* ── Aggregate export ──────────────────────────────────────────────────── */

export const tokens = {
  colour,
  inkAlpha,
  themeColour,
  fontFamily,
  type,
  spacing,
  layout,
  radius,
  elevation,
  motion,
} as const;

export type Tokens = typeof tokens;
