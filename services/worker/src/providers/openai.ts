/**
 * OpenAI adapters — the SECOND PROVIDER, IMPLEMENTED BUT DARK.
 *
 * Nothing selects this at runtime unless ENABLE_OPENAI_PROVIDER is explicitly
 * set (see ./index.ts). It exists so that a Gemini outage, a Gemini price
 * change (DECISIONS.md §6 — "any provider price change → re-run before
 * accepting"), or a Milestone 0 fidelity comparison is a config flip rather
 * than a week of work.
 *
 * Being dark does not make it exempt from the rules. It builds its prompts
 * through prompt-builder.ts like every other adapter, it constrains output with
 * a JSON schema, and it reports MEASURED cost from the usage block — because
 * the day it goes live is the day those things have to already be true.
 */

import { buildIllustrationPrompt, buildStoryPrompt } from '../pipeline/prompt-builder';
import type { DrawingAnalysis, GeneratedStory } from '@papercub/shared';
import { normaliseDrawingAnalysis } from './drawing-analysis';
import { describeImage } from './image-meta';
import { imageCostCents, providerOf, speechCostCents, textCostCents } from './pricing';
import type {
  ImageGenerator,
  ProviderUsage,
  SpeechSynthesizer,
  TextGenerator,
  VisionAnalyzer,
  WithUsage,
} from './types';

export interface OpenAiOptions {
  apiKey: string;
  textModel: string;
  imageModel: string;
  ttsModel: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 120_000;

const GENERATED_STORY_JSON_SCHEMA = {
  name: 'generated_story',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      pages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            index: { type: 'integer' },
            text: { type: 'string' },
            sceneDescription: { type: 'string' },
          },
          required: ['index', 'text', 'sceneDescription'],
        },
      },
      coverSceneDescription: { type: 'string' },
    },
    required: ['title', 'pages', 'coverSceneDescription'],
  },
} as const;

const DRAWING_ANALYSIS_JSON_SCHEMA = {
  name: 'drawing_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      subjectGuess: { type: 'string' },
      dominantColours: { type: 'array', items: { type: 'string' } },
      distinguishingFeatures: { type: 'array', items: { type: 'string' } },
      medium: { type: 'string', enum: ['crayon', 'marker', 'pencil', 'paint', 'mixed', 'unknown'] },
      lineQuality: { type: 'string', enum: ['bold', 'light', 'sketchy', 'mixed'] },
      suggestedTraits: { type: 'array', items: { type: 'string' } },
      suggestedType: { type: 'string' },
    },
    required: [
      'subjectGuess',
      'dominantColours',
      'distinguishingFeatures',
      'medium',
      'lineQuality',
      'suggestedTraits',
      'suggestedType',
    ],
  },
} as const;

export class OpenAiError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`OpenAI request failed with ${status}: ${body.slice(0, 500)}`);
    this.name = 'OpenAiError';
    this.status = status;
  }
}

export function createOpenAiProviders(opts: OpenAiOptions): {
  vision: VisionAnalyzer;
  text: TextGenerator;
  image: ImageGenerator;
  speech: SpeechSynthesizer;
} {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post(path: string, body: unknown, expect: 'json' | 'binary' = 'json') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new OpenAiError(res.status, await res.text());
      if (expect === 'binary') return new Uint8Array(await res.arrayBuffer());
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function tokenUsage(response: unknown, modelId: string, startedMs: number): ProviderUsage {
    const usage = (
      response as { usage?: { input_tokens?: number; output_tokens?: number } }
    ).usage;
    if (!usage || usage.input_tokens === undefined) {
      throw new Error(
        `OpenAI response for ${modelId} carried no usage block. Refusing to ` +
          `record a zero-cost call.`,
      );
    }
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    return {
      costCents: textCostCents(modelId, { inputTokens, outputTokens }),
      inputTokens,
      outputTokens,
      imageCount: 0,
      latencyMs: Date.now() - startedMs,
      modelId,
      provider: providerOf(modelId),
    };
  }

  function outputText(response: unknown): unknown {
    const out = (
      response as {
        output?: { content?: { type?: string; text?: string }[] }[];
        output_text?: string;
      }
    );
    if (typeof out.output_text === 'string' && out.output_text.length > 0) {
      return JSON.parse(out.output_text);
    }
    const chunks = (out.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');
    if (chunks.length === 0) throw new Error('OpenAI returned no output text');
    return JSON.parse(chunks);
  }

  const text: TextGenerator = {
    async generateStory(input): Promise<WithUsage<GeneratedStory>> {
      const startedMs = Date.now();
      const response = await post('/responses', {
        model: opts.textModel,
        input: buildStoryPrompt(input),
        text: { format: { type: 'json_schema', ...GENERATED_STORY_JSON_SCHEMA } },
      });
      return {
        value: outputText(response) as GeneratedStory,
        usage: tokenUsage(response, opts.textModel, startedMs),
      };
    },
  };

  const vision: VisionAnalyzer = {
    async analyseDrawing({ cutoutImageBytes }): Promise<WithUsage<DrawingAnalysis>> {
      const startedMs = Date.now();
      const b64 = Buffer.from(cutoutImageBytes).toString('base64');
      const response = await post('/responses', {
        model: opts.textModel,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  "Describe this child's drawing so it can be redrawn " +
                  'consistently later. Report only what is visibly in the image. ' +
                  'Do not describe any person and do not transcribe any text.',
              },
              { type: 'input_image', image_url: `data:image/png;base64,${b64}` },
            ],
          },
        ],
        text: { format: { type: 'json_schema', ...DRAWING_ANALYSIS_JSON_SCHEMA } },
      });
      return {
        // Same normalisation as gemini.ts: an unchecked cast here is the bug
        // that made character_build fail 100% of the time on the live provider.
        value: normaliseDrawingAnalysis(outputText(response)),
        usage: tokenUsage(response, opts.textModel, startedMs),
      };
    },
  };

  const image: ImageGenerator = {
    async generateIllustration({ input, tier }) {
      const startedMs = Date.now();
      const response = (await post('/images/generations', {
        model: opts.imageModel,
        prompt: buildIllustrationPrompt(input),
        n: 1,
        size: input.isCover ? '1024x1536' : '1536x1024',
        quality: tier === 'premium' ? 'high' : 'medium',
      })) as { data?: { b64_json?: string }[] };

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI returned no image data');

      const usage: ProviderUsage = {
        costCents: imageCostCents(opts.imageModel, 1),
        inputTokens: null,
        outputTokens: null,
        imageCount: 1,
        latencyMs: Date.now() - startedMs,
        modelId: opts.imageModel,
        provider: providerOf(opts.imageModel),
      };

      const imageBytes = new Uint8Array(Buffer.from(b64, 'base64'));
      return {
        value: { imageBytes, seed: input.seed, meta: describeImage(imageBytes) },
        usage,
      };
    },
  };

  /**
   * Ours -> OpenAI's, for the same reason gemini.ts maps it: `voiceId` is the
   * id we store on `narrations` and it must not be one vendor's catalogue
   * entry. `shimmer` is the closest register to Gemini's `sulafat`, so a story
   * that failed over does not sound like a different book.
   */
  const OPENAI_VOICE_IDS: Record<string, string> = {
    papercub_default: 'shimmer',
    papercub_bramble: 'sage',
    papercub_pip: 'nova',
    papercub_juniper: 'coral',
    papercub_marlow: 'onyx',
    papercub_fig: 'echo',
  };

  function openAiVoiceName(voiceId: string): string {
    const name = OPENAI_VOICE_IDS[voiceId];
    if (!name) {
      throw new Error(
        `No OpenAI voice mapped for voice id "${voiceId}". Add it to ` +
          `OPENAI_VOICE_IDS rather than passing our id through.`,
      );
    }
    return name;
  }

  const speech: SpeechSynthesizer = {
    async synthesise({ text: toSpeak, voiceId }) {
      const startedMs = Date.now();
      const audioBytes = (await post(
        '/audio/speech',
        {
          model: opts.ttsModel,
          voice: openAiVoiceName(voiceId),
          input: toSpeak,
          response_format: 'mp3',
        },
        'binary',
      )) as Uint8Array;

      const usage: ProviderUsage = {
        costCents: speechCostCents(opts.ttsModel, toSpeak.length),
        inputTokens: null,
        outputTokens: null,
        imageCount: 0,
        latencyMs: Date.now() - startedMs,
        modelId: opts.ttsModel,
        provider: providerOf(opts.ttsModel),
      };

      return {
        value: {
          audioBytes,
          durationMs: Math.round((toSpeak.length / 14) * 1000),
          mimeType: 'audio/mpeg',
        },
        usage,
      };
    },
  };

  return { vision, text, image, speech };
}
