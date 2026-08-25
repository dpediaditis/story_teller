/**
 * The queue consumer's disposal rules. Each of these is a way to lose a job or
 * pay for one twice.
 */

import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS_PER_STAGE, STORY_SHAPE } from '@papercub/shared';
import { silentLogger } from '../logger';
import { createQueueConsumer } from '../queue';
import type { JobHandler } from '../queue';
import type { QueueMessage, WorkerQueue } from '../ports';
import { createFakeDb } from '../testing/fakes';

const JOB_ID = '99999999-9999-4999-8999-999999999999';

function validPayload() {
  return {
    type: 'story_generate',
    jobId: JOB_ID,
    parentId: '55555555-5555-4555-8555-555555555555',
    childId: '77777777-7777-4777-8777-777777777777',
    storyId: '66666666-6666-4666-8666-666666666666',
    characterIds: ['11111111-1111-4111-8111-111111111111'],
    theme: 'space',
    mood: 'adventurous',
    length: 'short',
    pageCount: STORY_SHAPE.short.pageCount,
    ageBand: '4_5',
    renderTechnique: 'cutout_rerender',
    locale: 'en-GB',
    estimatedCostCents: STORY_SHAPE.short.estimatedCostCents,
    modelBundleVersion: 'test',
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
  };
}

function fakeQueue(messages: QueueMessage[]) {
  const deleted: number[] = [];
  const dlq: QueueMessage[] = [];
  let served = false;

  const queue: WorkerQueue = {
    async read() {
      if (served) return [];
      served = true;
      return messages;
    },
    async delete(msgId) {
      deleted.push(msgId);
    },
    async moveToDlq(msg) {
      dlq.push(msg);
      deleted.push(msg.msgId);
    },
  };

  return { queue, deleted, dlq };
}

async function drain(
  messages: QueueMessage[],
  handle: JobHandler,
): Promise<{ deleted: number[]; dlq: QueueMessage[]; db: ReturnType<typeof createFakeDb> }> {
  const { queue, deleted, dlq } = fakeQueue(messages);
  const db = createFakeDb();

  const consumer = createQueueConsumer({
    queue,
    db,
    logger: silentLogger,
    handle,
    visibilityTimeoutSeconds: 180,
    pollIntervalMs: 1,
    batchSize: 1,
    haltBackoffMs: 1,
  });

  await consumer.start();
  // One poll cycle is enough: the fake queue serves its batch then goes empty.
  await new Promise((r) => setTimeout(r, 30));
  await consumer.stop();

  return { deleted, dlq, db };
}

const succeed: JobHandler = async () => ({ kind: 'succeeded' });

describe('message disposal', () => {
  it('deletes a message once its job succeeds', async () => {
    const { deleted, dlq } = await drain([{ msgId: 1, readCt: 1, message: validPayload() }], succeed);

    expect(deleted).toEqual([1]);
    expect(dlq).toHaveLength(0);
  });

  it('deletes a message when its job FAILS — a failed job must not be redelivered', async () => {
    // A failed job has already recorded its error code, settled its measured
    // cost and refunded if it was entitled to. Redelivering it would re-run
    // provider calls that already cost money.
    const { deleted, dlq } = await drain([{ msgId: 2, readCt: 1, message: validPayload() }], async () => ({
      kind: 'failed',
    }));

    expect(deleted).toEqual([2]);
    expect(dlq).toHaveLength(0);
  });

  it('LEAVES a halted job on the queue — not deleted, not dead-lettered', async () => {
    // DECISIONS.md §3.3. The visibility timeout returns it once the cap resets.
    const { deleted, dlq } = await drain([{ msgId: 3, readCt: 1, message: validPayload() }], async () => ({
      kind: 'halted',
    }));

    expect(deleted).toHaveLength(0);
    expect(dlq).toHaveLength(0);
  });
});

describe('the dead-letter threshold', () => {
  it('processes a message on its third read', async () => {
    const { deleted, dlq } = await drain(
      [{ msgId: 4, readCt: MAX_ATTEMPTS_PER_STAGE, message: validPayload() }],
      succeed,
    );

    expect(dlq).toHaveLength(0);
    expect(deleted).toEqual([4]);
  });

  it('dead-letters on the fourth read and marks the job row dead_letter', async () => {
    let handled = 0;
    const { dlq, deleted, db } = await drain(
      [{ msgId: 5, readCt: MAX_ATTEMPTS_PER_STAGE + 1, message: validPayload() }],
      async () => {
        handled += 1;
        return { kind: 'succeeded' };
      },
    );

    // Never handed to the pipeline at all — no provider call, no spend.
    expect(handled).toBe(0);
    expect(dlq.map((m) => m.msgId)).toEqual([5]);
    expect(deleted).toEqual([5]);

    // The durable row gets a terminal state, so the client stops waiting on a
    // job that will never progress.
    const patch = db.state.jobPatches.find((p) => p.patch.status === 'dead_letter');
    expect(patch?.jobId).toBe(JOB_ID);
    expect(patch?.patch.finishedAt).toBeDefined();
  });

  it('dead-letters an unparseable payload immediately', async () => {
    // It will never parse. Three more visibility windows would change nothing.
    let handled = 0;
    const { dlq } = await drain([{ msgId: 6, readCt: 1, message: { type: 'nonsense' } }], async () => {
      handled += 1;
      return { kind: 'succeeded' };
    });

    expect(handled).toBe(0);
    expect(dlq.map((m) => m.msgId)).toEqual([6]);
  });

  it('dead-letters a payload that is valid JSON but not a JobPayload', async () => {
    const bad = { ...validPayload(), length: 'enormous' };
    const { dlq } = await drain([{ msgId: 7, readCt: 1, message: bad }], succeed);
    expect(dlq.map((m) => m.msgId)).toEqual([7]);
  });
});
