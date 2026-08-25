/**
 * Everything a pipeline stage is allowed to touch, passed in explicitly.
 *
 * Nothing in src/pipeline/** may import the supabase client, the config, or a
 * provider SDK directly. If a stage needs a capability it does not have here,
 * that capability gets added to a port — it does not get reached for. That is
 * what keeps the money and privacy rules testable with fakes rather than
 * hopeful.
 */

import type { Logger } from '../logger';
import type { ContentModerator } from '../moderation';
import type { WorkerDb } from '../ports';
import type { ProviderBundle } from '../providers/types';

export interface PipelineDeps {
  db: WorkerDb;
  providers: ProviderBundle;
  moderator: ContentModerator;
  logger: Logger;
  /** Stamped onto stories and character assets for reproducibility. */
  modelBundleVersion: string;
}
