/**
 * Provider-agnostic interfaces for every AI call the worker makes. A real
 * implementation (src/providers/gemini.ts, etc.) implements these; the
 * pipeline (src/pipeline/*) depends only on these interfaces, never on a
 * concrete SDK.
 *
 * IMPORTANT: every method here returns `WithUsage<T>`, and `ProviderUsage.costCents`
 * must be the provider's MEASURED cost for that specific call (computed from its
 * actual usage response — tokens billed, images billed — against the current
 * price table), never a pre-call estimate. DECISIONS.md §3.1's cost ceiling is
 * enforced on truth, not estimate, and that only works if every provider call
 * reports what it truly cost.
 *
 * `costCents` may be FRACTIONAL. A single fast-tier interior illustration costs
 * well under one cent, and a 13-image bedtime book rounded down per call would
 * under-report its true cost by most of its value. The ledger (src/cost.ts)
 * accumulates fractional cents and only ever rounds the RUNNING TOTAL, so the
 * integer cents written to `record_cost` track measured spend to within 1c for
 * the whole job no matter how many calls it took.
 */

import type {
  DrawingAnalysis,
  GeneratedStory,
  IsolationMethod,
} from '@papercub/shared';
import type { IllustrationPromptInput, StoryPromptInput } from '@papercub/shared';

export interface ProviderUsage {
  /** MEASURED cost of this call, in cents. May be fractional. Never an estimate. */
  costCents: number;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number;
  latencyMs: number;
  modelId: string;
  provider: string;
}

export interface WithUsage<T> {
  value: T;
  usage: ProviderUsage;
}

export interface VisionAnalyzer {
  analyseDrawing(args: {
    cutoutImageBytes: Uint8Array;
    method: IsolationMethod;
  }): Promise<WithUsage<DrawingAnalysis>>;
}

export interface TextGenerator {
  generateStory(input: StoryPromptInput): Promise<WithUsage<GeneratedStory>>;
}

export interface ImageGenerator {
  generateIllustration(args: {
    input: IllustrationPromptInput;
    referenceImages: Uint8Array[];
    tier: 'premium' | 'fast';
  }): Promise<WithUsage<{ imageBytes: Uint8Array; seed: number | null }>>;
}

export interface SpeechSynthesizer {
  synthesise(args: {
    text: string;
    voiceId: string;
    language: string;
  }): Promise<WithUsage<{ audioBytes: Uint8Array; durationMs: number }>>;
}

export interface ProviderBundle {
  version: string;
  vision: VisionAnalyzer;
  text: TextGenerator;
  image: ImageGenerator;
  speech: SpeechSynthesizer;
}
