// TODO(C1): assemble the ProviderBundle (see ./types.ts) from concrete
// implementations (./gemini.ts, and any OpenAI/Replicate fallback), stamped
// with MODEL_BUNDLE_VERSION from src/config.ts.

import type { ProviderBundle } from './types';

export function createProviderBundle(): ProviderBundle {
  throw new Error('TODO(C1): createProviderBundle is not yet implemented.');
}
