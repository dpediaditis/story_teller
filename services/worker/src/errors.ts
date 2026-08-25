/**
 * Terminal failures inside the pipeline.
 *
 * CLAUDE.md: "every stage failure sets `generation_jobs.error_code` from
 * `JobErrorCode`". Throwing a bare Error would leave that column null and the
 * refund decision unmakeable, so every stage failure is raised as a JobFailure
 * carrying its code, and the one place that catches (runJob) maps it straight
 * onto the row.
 */

import type { JobErrorCode, ModerationStage, ModerationSubjectType } from '@papercub/shared';

export class JobFailure extends Error {
  readonly code: JobErrorCode;
  readonly cause?: unknown;

  constructor(code: JobErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'JobFailure';
    this.code = code;
    this.cause = cause;
  }
}

/** A moderation gate blocked. Carries which gate, for the audit trail. */
export class ModerationBlocked extends JobFailure {
  readonly stage: ModerationStage;
  readonly subjectType: ModerationSubjectType;

  constructor(args: {
    code: JobErrorCode;
    stage: ModerationStage;
    subjectType: ModerationSubjectType;
    message: string;
  }) {
    super(args.code, args.message);
    this.name = 'ModerationBlocked';
    this.stage = args.stage;
    this.subjectType = args.subjectType;
  }
}

/**
 * The global daily cap is up. NOT a job failure — the job has not gone wrong
 * and must not be failed, error-coded, or refunded. It goes back on the queue.
 */
export class GenerationHalted extends Error {
  readonly spentTodayCents: number;
  readonly capCents: number;

  constructor(spentTodayCents: number, capCents: number) {
    super(`Global daily spend cap reached: ${spentTodayCents}c of ${capCents}c`);
    this.name = 'GenerationHalted';
    this.spentTodayCents = spentTodayCents;
    this.capCents = capCents;
  }
}

/** Maps an unknown thrown value onto a JobErrorCode. Never returns null. */
export function toJobFailure(err: unknown): JobFailure {
  if (err instanceof JobFailure) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout|ETIMEDOUT|abort/i.test(message)) {
    return new JobFailure('provider_timeout', message, err);
  }
  if (/rate.?limit|429/i.test(message)) {
    return new JobFailure('provider_rate_limited', message, err);
  }
  return new JobFailure('internal', message, err);
}
