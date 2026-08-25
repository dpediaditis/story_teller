/**
 * Stage transitions and progress events.
 *
 * The rule this file exists to enforce, from enums.ts and repeated in
 * docs/ARCHITECTURE.md: "Each message shown to a user must correspond to a
 * stage that is ACTUALLY RUNNING. Never invent progress."
 *
 * So `enterStage` is called immediately BEFORE the work of that stage starts,
 * never in a batch up front and never optimistically ahead of an await. There
 * is no percentage anywhere, because we do not know one.
 */

import type {
  GenerationStage,
  JobErrorCode,
  JobProgressEvent,
  JobStatus,
} from '@papercub/shared';
import type { WorkerDb } from './ports';

/** Mobile copy key for each stage, per enums.ts. The app owns the wording. */
export function stageCopyKey(stage: GenerationStage): string {
  return `generation.stage.${stage}`;
}

export interface ProgressReporterOptions {
  db: WorkerDb;
  jobId: string;
  storyId: string | null;
  pagesTotal: number;
}

export class ProgressReporter {
  private readonly db: WorkerDb;
  private readonly jobId: string;
  private readonly storyId: string | null;
  private readonly pagesTotal: number;

  private stage: GenerationStage = 'queued';
  private status: JobStatus = 'queued';
  private coverReady = false;
  private readonly readablePageIndexes: number[] = [];

  constructor(opts: ProgressReporterOptions) {
    this.db = opts.db;
    this.jobId = opts.jobId;
    this.storyId = opts.storyId;
    this.pagesTotal = opts.pagesTotal;
  }

  get currentStage(): GenerationStage {
    return this.stage;
  }

  get pagesCompleted(): number {
    return this.readablePageIndexes.length;
  }

  /** Call immediately before the stage's work begins. Not before. */
  async enterStage(stage: GenerationStage): Promise<void> {
    this.stage = stage;
    this.status = stage === 'done' ? 'succeeded' : 'running';
    await this.db.updateJob(this.jobId, {
      stage,
      status: this.status,
      pagesCompleted: this.pagesCompleted,
      pagesTotal: this.pagesTotal,
    });
    await this.emit(null);
  }

  /**
   * The cover has landed and been through gate 4. This is what fires the
   * design's cover reveal, so it is emitted the moment the cover is real and
   * never a moment earlier.
   */
  async markCoverReady(): Promise<void> {
    this.coverReady = true;
    await this.emit(null);
  }

  /**
   * One interior page is finished and readable. Emitted per page so the child
   * can read page 1 while page 5 is still rendering.
   */
  async markPageReady(pageIndex: number): Promise<void> {
    if (!this.readablePageIndexes.includes(pageIndex)) {
      this.readablePageIndexes.push(pageIndex);
      this.readablePageIndexes.sort((a, b) => a - b);
    }
    await this.db.updateJob(this.jobId, {
      pagesCompleted: this.pagesCompleted,
      pagesTotal: this.pagesTotal,
    });
    await this.emit(null);
  }

  async markFailed(errorCode: JobErrorCode): Promise<void> {
    this.status = 'failed';
    await this.emit(errorCode);
  }

  async markDeadLetter(errorCode: JobErrorCode | null): Promise<void> {
    this.status = 'dead_letter';
    await this.emit(errorCode);
  }

  private async emit(errorCode: JobErrorCode | null): Promise<void> {
    const event: JobProgressEvent = {
      jobId: this.jobId,
      storyId: this.storyId,
      status: this.status,
      stage: this.stage,
      stageCopyKey: stageCopyKey(this.stage),
      pagesCompleted: this.pagesCompleted,
      pagesTotal: this.pagesTotal,
      coverReady: this.coverReady,
      readablePageIndexes: [...this.readablePageIndexes],
      errorCode,
      emittedAt: new Date().toISOString(),
    };
    await this.db.emitProgress(event);
  }
}
