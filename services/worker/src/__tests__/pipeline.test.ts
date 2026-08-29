/**
 * End-to-end pipeline tests against FAKE providers.
 *
 * These cover the two things the pipeline can get wrong that cost real money or
 * ship the wrong thing to a child: the tier split (premium cover / fast pages),
 * and the failure paths where a job must be error-coded, settled and refunded
 * exactly once.
 */

import { describe, expect, it } from 'vitest';
import { REFUNDABLE_JOB_ERRORS, STORY_SHAPE } from '@papercub/shared';
import type { CharacterBuildJobPayload, StoryGenerateJobPayload } from '@papercub/shared';
import { runJob } from '../runner';
import { silentLogger } from '../logger';
import type { PipelineDeps } from '../pipeline/context';
import {
  createFakeDb,
  createFakeModerator,
  createFakeProviders,
  fakeCharacter,
} from '../testing/fakes';
import type { FakeDb, FakeProviderOptions, FakeProviders } from '../testing/fakes';
import type { FakeModeratorOptions } from '../testing/fakes';

const JOB_ID = '44444444-4444-4444-8444-444444444444';
const PARENT_ID = '55555555-5555-4555-8555-555555555555';
const STORY_ID = '66666666-6666-4666-8666-666666666666';
const CHILD_ID = '77777777-7777-4777-8777-777777777777';
const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';

function storyJob(overrides: Partial<StoryGenerateJobPayload> = {}): StoryGenerateJobPayload {
  return {
    type: 'story_generate',
    jobId: JOB_ID,
    parentId: PARENT_ID,
    childId: CHILD_ID,
    storyId: STORY_ID,
    characterIds: [CHARACTER_ID],
    theme: 'space',
    mood: 'adventurous',
    length: 'short',
    pageCount: STORY_SHAPE.short.pageCount,
    ageBand: '4_5',
    renderTechnique: 'cutout_rerender',
    locale: 'en-GB',
    voiceId: 'papercub_default',
    estimatedCostCents: STORY_SHAPE.short.estimatedCostCents,
    modelBundleVersion: 'test',
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
    ...overrides,
  };
}

function setup(args: {
  providers?: FakeProviderOptions;
  moderator?: FakeModeratorOptions;
  globalSpendTodayCents?: number;
}): { db: FakeDb; providers: FakeProviders; deps: PipelineDeps } {
  const db = createFakeDb({
    characters: [fakeCharacter()],
    globalSpendTodayCents: args.globalSpendTodayCents ?? 0,
  });
  const providers = createFakeProviders({
    pageCount: STORY_SHAPE.short.pageCount,
    ...args.providers,
  });
  const deps: PipelineDeps = {
    db,
    providers,
    moderator: createFakeModerator(args.moderator ?? {}),
    logger: silentLogger,
    modelBundleVersion: 'test',
  };
  return { db, providers, deps };
}

function characterJob(): CharacterBuildJobPayload {
  return {
    type: 'character_build',
    jobId: JOB_ID,
    parentId: PARENT_ID,
    childId: CHILD_ID,
    characterId: CHARACTER_ID,
    drawingId: '88888888-8888-4888-8888-888888888888',
    cutoutStorageKey: 'drawings/55555555-5555-4555-8555-555555555555/d/cutout.png',
    estimatedCostCents: 16,
    modelBundleVersion: 'test',
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
  };
}

const CAP = 50_000;

/**
 * The character slot is a live count of characters that are neither archived
 * nor failed. A build that fails and stays `building` therefore keeps its slot
 * forever — and the free tier grants exactly one character, ever. That is a
 * permanent lockout with nothing delivered, so it gets a regression test.
 */
describe('character_build — the slot must come back on failure', () => {
  it('marks the character failed when a stage throws', async () => {
    const { db, deps } = setup({ providers: { failImageCallNumber: 1 } });

    const outcome = await runJob({ job: characterJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('failed');
    expect(db.state.failedCharacters).toEqual([CHARACTER_ID]);
  });

  it('leaves the character alone when the build succeeds', async () => {
    const { db, deps } = setup({});

    const outcome = await runJob({ job: characterJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('succeeded');
    expect(db.state.failedCharacters).toEqual([]);
  });

  it('does not touch a character on a STORY failure', async () => {
    const { db, deps } = setup({ providers: { failImageCallNumber: 1 } });

    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(db.state.failedCharacters).toEqual([]);
  });
});

describe('story pipeline — the happy path', () => {
  it('runs every stage in the specified order, once each', async () => {
    const { db, deps } = setup({});
    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('succeeded');

    const stages = db.state.jobPatches
      .map((p) => p.patch.stage)
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    expect(stages).toEqual([
      'moderating_input',
      'validating_request',
      'writing_story',
      'moderating_text',
      'illustrating_cover',
      'illustrating_pages',
      'moderating_images',
      'narrating',
      'assembling',
      'done',
    ]);
  });

  it('uses the PREMIUM tier exactly once — the cover — and FAST for every page', async () => {
    // This is the unit economics (DECISIONS.md §2). A regression that moved
    // interior pages onto the premium tier would not fail any other test; it
    // would just quietly make the margin negative.
    const { providers, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    const tiers = providers.calls.filter((c) => c.kind === 'image').map((c) => c.tier);
    expect(tiers[0]).toBe('premium');
    expect(tiers.filter((t) => t === 'premium')).toHaveLength(1);
    expect(tiers.filter((t) => t === 'fast')).toHaveLength(STORY_SHAPE.short.pageCount);
    expect(tiers).toHaveLength(STORY_SHAPE.short.imageCount);
  });

  it('emits coverReady the moment the cover lands, before any page is readable', async () => {
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    const firstCoverReady = db.state.progressEvents.findIndex((e) => e.coverReady);
    const firstPageReadable = db.state.progressEvents.findIndex(
      (e) => e.readablePageIndexes.length > 0,
    );

    expect(firstCoverReady).toBeGreaterThanOrEqual(0);
    expect(firstCoverReady).toBeLessThan(firstPageReadable);
  });

  it('makes pages readable one at a time, in order', async () => {
    // The product requirement: the child reads page 1 while page 5 renders.
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    const readableCounts = db.state.progressEvents
      .map((e) => e.readablePageIndexes.length)
      .filter((n, i, arr) => i === 0 || n !== arr[i - 1]);

    expect(readableCounts).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const last = db.state.progressEvents.at(-1)!;
    expect(last.readablePageIndexes).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never emits a stage that is not in GenerationStage order', async () => {
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    // Every emitted event's stage must be one the job had actually entered.
    const entered = new Set<string>();
    for (const patch of db.state.jobPatches) {
      if (patch.patch.stage) entered.add(patch.patch.stage);
    }
    for (const event of db.state.progressEvents) {
      expect(entered.has(event.stage)).toBe(true);
    }
  });

  it('records one cost row per provider call and settles once', async () => {
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    // 1 text + 1 cover + 6 pages + 1 speech = 9 provider calls.
    const providerCostCalls = db.state.costCalls.filter((c) => c.request.modelId !== 'settlement');
    expect(providerCostCalls).toHaveLength(9);

    expect(db.finalCallCount()).toBe(1);
    expect(db.state.refundCalls).toHaveLength(0);
  });

  it('writes all four moderation gates to moderation_events', async () => {
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    const stages = new Set(db.state.moderationEvents.map((e) => e.stage));
    expect(stages).toEqual(new Set(['input_image', 'input_text', 'output_text', 'output_image']));

    // Passes are recorded too, not only blocks — the audit trail has to be able
    // to show that something WAS checked.
    expect(db.state.moderationEvents.some((e) => e.verdict === 'pass')).toBe(true);
  });

  it('keeps scene_description internal — it is written to pages, never to progress', async () => {
    const { db, deps } = setup({});
    await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(db.state.pages.every((p) => p.sceneDescription.length > 0)).toBe(true);

    const emitted = JSON.stringify(db.state.progressEvents);
    expect(emitted).not.toContain('sceneDescription');
    expect(emitted).not.toContain('bright blue door');
  });
});

describe('story pipeline — failure paths', () => {
  it('refunds and settles exactly once when an image provider fails mid-run', async () => {
    // The mid-pipeline crash. Cover plus two pages were paid for; the third
    // page throws. The measured spend must stay recorded, the story must be
    // given back, and the reservation must be released exactly once.
    const { db, deps } = setup({ providers: { failImageCallNumber: 4 } });

    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');

    expect(REFUNDABLE_JOB_ERRORS).toContain(outcome.errorCode as never);
    expect(outcome.refunded).toBe(true);

    // Exactly one release, via the refund.
    expect(db.state.refundCalls).toEqual([JOB_ID]);
    expect(db.finalCallCount()).toBe(0);

    // The three images we DID pay for are still on the books.
    expect(db.totalRecordedCents()).toBeGreaterThan(0);

    // And the error code landed on the row.
    const errorPatch = db.state.jobPatches.find((p) => p.patch.errorCode);
    expect(errorPatch?.patch.errorCode).toBe(outcome.errorCode);
    expect(errorPatch?.patch.status).toBe('failed');
  });

  it('fails WITHOUT a refund when the user-supplied input image is blocked', async () => {
    // Gate 1 blocks the child's own upload. No provider was called, nothing was
    // spent, and the story is deliberately not given back — otherwise the free
    // tier is reusable forever by uploading something that always blocks.
    const { db, deps } = setup({ moderator: { blockImageCallNumber: 1 } });

    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');

    expect(outcome.errorCode).toBe('moderation_blocked_input_image');
    expect(outcome.refunded).toBe(false);
    expect(db.state.refundCalls).toHaveLength(0);

    // The reservation still comes back — just via record_cost, not a refund.
    expect(db.finalCallCount()).toBe(1);
    expect(db.totalRecordedCents()).toBe(0);
  });

  it('refunds when OUR generated image is blocked by gate 4', async () => {
    // Image call 2 is the cover (call 1 is gate 1 on the input cut-out).
    const { db, deps } = setup({ moderator: { blockImageCallNumber: 2 } });

    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');

    expect(outcome.errorCode).toBe('moderation_blocked_output_image');
    expect(outcome.refunded).toBe(true);
    expect(db.finalCallCount()).toBe(0);
  });

  it('fails with invalid_structured_output when the writer returns the wrong page count', async () => {
    const { db, deps } = setup({ providers: { pageCount: 3 } });

    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('unreachable');

    expect(outcome.errorCode).toBe('invalid_structured_output');
    // Refundable: the model failed us, not the other way round.
    expect(outcome.refunded).toBe(true);
    // No images were drawn, so no image cost.
    expect(db.state.illustrations).toHaveLength(0);
  });
});

describe('story pipeline — the global daily spend cap', () => {
  it('halts without failing, refunding, spending or error-coding the job', async () => {
    // DECISIONS.md §3.3 and docs/ARCHITECTURE.md: the cap is OUR limit, not the
    // user's. A halted job has not gone wrong.
    const { db, deps, providers } = setup({ globalSpendTodayCents: CAP });

    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });

    expect(outcome.kind).toBe('halted');
    expect(providers.calls).toHaveLength(0);
    expect(db.state.costCalls).toHaveLength(0);
    expect(db.state.refundCalls).toHaveLength(0);
    expect(db.state.jobPatches.every((p) => !p.patch.errorCode)).toBe(true);
  });

  it('runs normally one cent below the cap', async () => {
    const { deps } = setup({ globalSpendTodayCents: CAP - 1 });
    const outcome = await runJob({ job: storyJob(), deps, globalDailySpendCapCents: CAP });
    expect(outcome.kind).toBe('succeeded');
  });
});
