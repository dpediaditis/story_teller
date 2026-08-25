// TODO(C1): character_build pipeline stage. Runs VisionAnalyzer.analyseDrawing
// over the cut-out, runs moderation gate 1, records measured cost
// (src/cost.ts), and writes Character / CharacterAsset rows.

import type { CharacterBuildJobPayload } from '@papercub/shared';
import type { ProviderBundle } from '../providers/types';

export async function runCharacterBuild(
  _job: CharacterBuildJobPayload,
  _providers: ProviderBundle,
): Promise<void> {
  throw new Error('TODO(C1): runCharacterBuild is not yet implemented.');
}
