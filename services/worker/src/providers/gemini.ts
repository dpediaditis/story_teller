// TODO(C1): Gemini implementation of VisionAnalyzer / TextGenerator /
// ImageGenerator / SpeechSynthesizer (see ./types.ts). Uses config.GEMINI_API_KEY,
// config.GEMINI_TEXT_MODEL, config.GEMINI_IMAGE_MODEL_PREMIUM,
// config.GEMINI_IMAGE_MODEL_FAST, config.GEMINI_TTS_MODEL.

import type {
  ImageGenerator,
  SpeechSynthesizer,
  TextGenerator,
  VisionAnalyzer,
} from './types';

export function createGeminiProviders(): {
  vision: VisionAnalyzer;
  text: TextGenerator;
  image: ImageGenerator;
  speech: SpeechSynthesizer;
} {
  throw new Error('TODO(C1): createGeminiProviders is not yet implemented.');
}
