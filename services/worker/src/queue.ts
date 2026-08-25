// TODO(C1): queue consumer over Postgres (QUEUE_NAMES.generation /
// QUEUE_NAMES.generationDlq from @papercub/shared), dispatching each
// JobPayload variant to the matching pipeline in src/pipeline/*.

import type { JobPayload } from '@papercub/shared';

export interface QueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createQueueConsumer(_handle: (job: JobPayload) => Promise<void>): QueueConsumer {
  throw new Error('TODO(C1): createQueueConsumer is not yet implemented.');
}
