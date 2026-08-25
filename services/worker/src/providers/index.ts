/**
 * Assembles the ProviderBundle, stamped with MODEL_BUNDLE_VERSION.
 *
 * Gemini is live. OpenAI is implemented but DARK: it is only ever selected when
 * ENABLE_OPENAI_PROVIDER is explicitly true, which nothing sets by default. A
 * silent failover would be worse than an outage — the two providers have
 * different prices, so a book that quietly rendered on the other one would
 * quietly cost something the §2 margin table never modelled.
 *
 * MODEL_BUNDLE_VERSION is stamped onto every story so that when a book looks
 * different from one made last month, the answer is a column and not a guess.
 */

import type { WorkerConfig } from '../config';
import type { ContentModerator } from '../moderation';
import { createGeminiProviders } from './gemini';
import { createOpenAiProviders } from './openai';
import type { ProviderBundle } from './types';

export interface ProviderSet {
  bundle: ProviderBundle;
  moderator: ContentModerator;
}

export function createProviderBundle(config: WorkerConfig): ProviderSet {
  const gemini = createGeminiProviders({
    apiKey: config.GEMINI_API_KEY,
    textModel: config.GEMINI_TEXT_MODEL,
    visionModel: config.GEMINI_VISION_MODEL,
    imageModelPremium: config.GEMINI_IMAGE_MODEL_PREMIUM,
    imageModelFast: config.GEMINI_IMAGE_MODEL_FAST,
    ttsModel: config.GEMINI_TTS_MODEL,
  });

  if (!config.ENABLE_OPENAI_PROVIDER) {
    return {
      bundle: {
        version: config.MODEL_BUNDLE_VERSION,
        vision: gemini.vision,
        text: gemini.text,
        image: gemini.image,
        speech: gemini.speech,
      },
      moderator: gemini.moderator,
    };
  }

  if (!config.OPENAI_API_KEY) {
    throw new Error('ENABLE_OPENAI_PROVIDER is true but OPENAI_API_KEY is not set.');
  }

  const openai = createOpenAiProviders({
    apiKey: config.OPENAI_API_KEY,
    textModel: config.OPENAI_TEXT_MODEL,
    imageModel: config.OPENAI_IMAGE_MODEL,
    ttsModel: config.OPENAI_TTS_MODEL,
  });

  return {
    bundle: {
      version: `${config.MODEL_BUNDLE_VERSION}+openai`,
      vision: openai.vision,
      text: openai.text,
      image: openai.image,
      speech: openai.speech,
    },
    // Moderation deliberately stays on Gemini even when generation moves: the
    // model that produced something unsafe should not be the one that clears it.
    moderator: gemini.moderator,
  };
}
