/**
 * The price table, and the only place a provider usage response is turned into
 * money.
 *
 * DECISIONS.md §3.1: the per-account ceiling is enforced on MEASURED cost. That
 * is only true if "measured" means "the provider told us how much it billed,
 * and we multiplied it by the price we actually pay". Nothing in this file may
 * fall back to `STORY_SHAPE[...].estimatedCostCents` — an estimate that leaks
 * in here would silently turn the ceiling back into a guess, and the runaway
 * retry scenario the ceiling exists to stop would pass it.
 *
 * DECISIONS.md §6: a provider price change is a repricing trigger. When one of
 * these numbers moves, re-run the §2 table before accepting it.
 *
 * Units are US cents. Fractions are deliberate and are preserved all the way to
 * src/cost.ts, which rounds only the running total.
 */

/** Cents per one million tokens. */
export interface TokenPrice {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
}

/** Cents per generated image. */
export interface ImagePrice {
  centsPerImage: number;
}

/** Cents per one million characters of synthesised speech. */
export interface SpeechPrice {
  centsPerMChar: number;
}

export interface PriceEntry {
  provider: string;
  text?: TokenPrice;
  image?: ImagePrice;
  speech?: SpeechPrice;
}

/**
 * Keyed by the exact model id sent on the wire, so a model swap in config.ts
 * without a price entry is a loud failure rather than a silent zero.
 */
export const PRICE_TABLE: Record<string, PriceEntry> = {
  /* ── Google ─────────────────────────────────────────────────────────── */
  'gemini-2.5-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
  'gemini-2.5-flash-lite': {
    provider: 'google',
    text: { inputCentsPerMTok: 10, outputCentsPerMTok: 40 },
  },
  /** Premium tier. Cover only — DECISIONS.md §2 prices exactly one per story. */
  'gemini-2.5-flash-image': { provider: 'google', image: { centsPerImage: 3.9 } },
  /** Fast tier. Interior pages. The cheap half of the split. */
  'gemini-2.5-flash-lite-image': { provider: 'google', image: { centsPerImage: 3.9 } },
  'gemini-2.5-flash-preview-tts': { provider: 'google', speech: { centsPerMChar: 1000 } },

  /* ── Google, 3.x ──────────────────────────────────────────────────────
   * Added after the first live run: the table held only 2.5-* entries, so
   * every 3.x model threw UnknownModelPriceError before any provider call
   * completed. The guard worked exactly as intended — it refused to record a
   * zero — but the table had not kept up with the models actually configured.
   *
   * VERIFY THESE against Google's current pricing page before launch.
   * DECISIONS.md §14 item 1 still stands: these are researched figures, not
   * numbers read off an invoice, and §6 makes any change a repricing trigger.
   */
  'gemini-3.7-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },
  },
  'gemini-3.6-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },
  },
  'gemini-3.5-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 150, outputCentsPerMTok: 900 },
  },
  'gemini-3.5-flash-lite': {
    provider: 'google',
    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
  'gemini-3.1-flash-lite': {
    provider: 'google',
    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
  /** Premium tier, cover only. ~$0.067 per 1K image. */
  'gemini-3.1-flash-image': { provider: 'google', image: { centsPerImage: 6.7 } },
  /** Fast tier, interior pages — the cheap half of the split. ~$0.0336. */
  'gemini-3.1-flash-lite-image': { provider: 'google', image: { centsPerImage: 3.36 } },
  'gemini-3-pro-image': { provider: 'google', image: { centsPerImage: 13.4 } },

  'gemini-3.1-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },
  },
  'gemini-3.1-flash-tts-preview': {
    provider: 'google',
    speech: { centsPerMChar: 1000 },
  },
  'gemini-2.5-pro-preview-tts': {
    provider: 'google',
    speech: { centsPerMChar: 1000 },
  },
  /* ── OpenAI (second provider, dark) ─────────────────────────────────── */
  'gpt-5-mini': { provider: 'openai', text: { inputCentsPerMTok: 25, outputCentsPerMTok: 200 } },
  'gpt-image-1': { provider: 'openai', image: { centsPerImage: 4.0 } },
  'gpt-4o-mini-tts': { provider: 'openai', speech: { centsPerMChar: 1200 } },
};

export class UnknownModelPriceError extends Error {
  constructor(modelId: string) {
    super(
      `No price entry for model "${modelId}". Refusing to record a cost of ` +
        `zero — an unpriced provider call is an invisible one, and the cost ` +
        `ceiling is only as good as the numbers feeding it.`,
    );
    this.name = 'UnknownModelPriceError';
  }
}

function priceFor(modelId: string): PriceEntry {
  const entry = PRICE_TABLE[modelId];
  if (!entry) throw new UnknownModelPriceError(modelId);
  return entry;
}

export function providerOf(modelId: string): string {
  return priceFor(modelId).provider;
}

/** Measured cost of a text/vision call, from the provider's billed token counts. */
export function textCostCents(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const price = priceFor(modelId).text;
  if (!price) throw new UnknownModelPriceError(`${modelId} (text)`);
  return (
    (usage.inputTokens / 1_000_000) * price.inputCentsPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputCentsPerMTok
  );
}

/** Measured cost of an image call, from the provider's billed image count. */
export function imageCostCents(modelId: string, imageCount: number): number {
  const price = priceFor(modelId).image;
  if (!price) throw new UnknownModelPriceError(`${modelId} (image)`);
  return imageCount * price.centsPerImage;
}

/** Measured cost of a speech call, from the characters the provider billed. */
export function speechCostCents(modelId: string, characterCount: number): number {
  const price = priceFor(modelId).speech;
  if (!price) throw new UnknownModelPriceError(`${modelId} (speech)`);
  return (characterCount / 1_000_000) * price.centsPerMChar;
}
