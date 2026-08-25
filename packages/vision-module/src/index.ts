export type { IsolateOptions, IsolateResult, CaptureGuidance } from './PapercubVision.types';

import type { CaptureGuidance, IsolateOptions, IsolateResult } from './PapercubVision.types';

/**
 * Thrown by every stub in this module. B3 must build real UI for this failure
 * state (native module unavailable / unimplemented) rather than assume a
 * happy path — see `isAvailable()` below, which is the pre-flight check.
 */
export class IsolationUnavailableError extends Error {
  constructor(message = 'Papercub Vision native module is not yet implemented.') {
    super(message);
    this.name = 'IsolationUnavailableError';
  }
}

// TODO(B4): return true once the native module is linked and the running iOS
// version meets the minimum (see plugin/withPapercubVision.ts — iOS 17+).
export function isAvailable(): boolean {
  return false;
}

// TODO(B4): implement via the native PapercubVisionModule. Never return fake
// data here — a stub that resolves with a plausible-looking IsolateResult
// would hide the "no native module" failure state B3 needs to build for.
export async function isolateDrawing(_opts: IsolateOptions): Promise<IsolateResult> {
  throw new IsolationUnavailableError();
}

// TODO(B4): implement via the native PapercubVisionModule (parent manual
// mask-repair flow). Never return fake data.
export async function applyManualMask(_args: {
  imageUri: string;
  maskUri: string;
}): Promise<IsolateResult> {
  throw new IsolationUnavailableError();
}

// TODO(B4): implement live capture guidance (paper/glare/edge/steadiness)
// backed by the native module's frame stream. Returns a no-op unsubscribe
// until then so callers can wire up the UI against the real shape.
export function subscribeCaptureGuidance(_listener: (guidance: CaptureGuidance) => void): () => void {
  return () => {};
}
