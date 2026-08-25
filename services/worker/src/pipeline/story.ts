// TODO(C1): story_generate pipeline stage. Builds a StoryPromptInput,
// calls TextGenerator.generateStory via prompt-builder.ts, runs moderation
// gate 3, records measured cost (src/cost.ts), and writes StoryPage rows.

import type { StoryGenerateJobPayload } from '@papercub/shared';
import type { ProviderBundle } from '../providers/types';

export async function runStoryGenerate(
  _job: StoryGenerateJobPayload,
  _providers: ProviderBundle,
): Promise<void> {
  throw new Error('TODO(C1): runStoryGenerate is not yet implemented.');
}
