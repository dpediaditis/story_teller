/**
 * The pgmq consumer.
 *
 * Delivery rules, from docs/ARCHITECTURE.md:
 *  - read with a 180s visibility timeout, so a crashed worker's message returns
 *    to the queue rather than being lost
 *  - parse with the JobPayload discriminated union and dispatch by type
 *  - "3 failed reads -> DLQ -> status 'dead_letter', alert"
 *
 * The DLQ threshold is read from pgmq's own `read_ct`, not from a counter we
 * keep. read_ct increments on every delivery including the ones where the
 * worker died before it could record anything, which is exactly the failure
 * mode a redelivery limit exists to catch — a counter we wrote ourselves would
 * miss it.
 *
 * A message is deleted only after its job reaches a terminal outcome. In
 * particular a HALTED job is left on the queue untouched (DECISIONS.md §3.3):
 * the visibility timeout returns it once the cap resets, and the user's story
 * is neither failed nor consumed by our spending decision.
 */

import { JobPayload, MAX_ATTEMPTS_PER_STAGE } from '@papercub/shared';
import type { Logger } from './logger';
import type { QueueMessage, WorkerDb, WorkerQueue } from './ports';

export interface QueueConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** What the consumer does with one parsed job. Returns how to dispose of it. */
export type JobHandler = (job: JobPayload) => Promise<{ kind: 'succeeded' | 'failed' | 'halted' }>;

export interface QueueConsumerOptions {
  queue: WorkerQueue;
  db: WorkerDb;
  logger: Logger;
  handle: JobHandler;
  visibilityTimeoutSeconds: number;
  pollIntervalMs: number;
  batchSize: number;
  /** Cooling-off period after a halt, so a halted worker does not hot-loop. */
  haltBackoffMs?: number;
}

export function createQueueConsumer(opts: QueueConsumerOptions): QueueConsumer {
  const {
    queue,
    db,
    logger,
    handle,
    visibilityTimeoutSeconds,
    pollIntervalMs,
    batchSize,
    haltBackoffMs = 60_000,
  } = opts;

  let running = false;
  let loop: Promise<void> | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function deadLetter(msg: QueueMessage, reason: string): Promise<void> {
    logger.error('message dead-lettered', { msgId: msg.msgId, readCt: msg.readCt, reason });

    // Best effort: mark the durable job row too, so the client sees a terminal
    // state instead of a job that silently stops progressing. The message id is
    // transient; the generation_jobs row is not.
    const parsed = JobPayload.safeParse(msg.message);
    if (parsed.success) {
      try {
        await db.updateJob(parsed.data.jobId, {
          status: 'dead_letter',
          errorCode: 'internal',
          finishedAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('failed to mark job dead_letter', {
          jobId: parsed.data.jobId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await queue.moveToDlq(msg);
  }

  async function processOne(msg: QueueMessage): Promise<{ halted: boolean }> {
    // read_ct is 1 on first delivery. Exceeding MAX_ATTEMPTS_PER_STAGE reads
    // means this message has already been tried that many times and failed to
    // reach a terminal state each time.
    if (msg.readCt > MAX_ATTEMPTS_PER_STAGE) {
      await deadLetter(msg, `read ${msg.readCt} times without completing`);
      return { halted: false };
    }

    const parsed = JobPayload.safeParse(msg.message);
    if (!parsed.success) {
      // An unparseable message will never parse. Retrying it three times is
      // just three ways to waste a visibility window.
      await deadLetter(msg, `payload failed JobPayload validation: ${parsed.error.message}`);
      return { halted: false };
    }

    const job = parsed.data;

    // DECISIONS.md §15 finding 10. pgmq guarantees at-least-once, so a
    // redelivered message whose job already finished must NOT be run again —
    // every provider call in it has already been paid for once.
    //
    // This closes the redelivered-after-completion case. It does NOT close the
    // concurrent case, where the job is still running when the visibility
    // timeout expires; only a visibility timeout comfortably above the worst
    // job duration does that, which is why the default moved to 900s.
    if (await db.isJobFinished(job.jobId)) {
      logger.warn('message redelivered for an already-finished job; discarding', {
        jobId: job.jobId,
        msgId: msg.msgId,
        readCt: msg.readCt,
      });
      await queue.delete(msg.msgId);
      return { halted: false };
    }

    const result = await handle(job);

    if (result.kind === 'halted') {
      // Left on the queue deliberately. Not deleted, not dead-lettered.
      logger.warn('job left on queue: generation halted', { jobId: job.jobId });
      return { halted: true };
    }

    // Succeeded or failed — both are terminal for this message. A failed job
    // has already recorded its error_code and settled its cost; redelivering it
    // would re-run provider calls that already cost money.
    await queue.delete(msg.msgId);
    return { halted: false };
  }

  async function runLoop(): Promise<void> {
    while (running) {
      try {
        const messages = await queue.read(visibilityTimeoutSeconds, batchSize);

        if (messages.length === 0) {
          await sleep(pollIntervalMs);
          continue;
        }

        let halted = false;
        for (const msg of messages) {
          if (!running) break;
          const outcome = await processOne(msg);
          if (outcome.halted) {
            halted = true;
            break;
          }
        }

        if (halted) await sleep(haltBackoffMs);
      } catch (err) {
        // The loop itself must never die. A failure here is infrastructure —
        // the database is unreachable, the queue call threw — and the right
        // response is to back off and try again, not to exit and lose the
        // worker.
        logger.error('queue loop error', {
          reason: err instanceof Error ? err.message : String(err),
        });
        await sleep(pollIntervalMs);
      }
    }
  }

  return {
    async start() {
      if (running) return;
      running = true;
      logger.info('queue consumer started', { visibilityTimeoutSeconds, batchSize });
      loop = runLoop();
    },
    async stop() {
      running = false;
      if (loop) await loop;
      logger.info('queue consumer stopped');
    },
  };
}
