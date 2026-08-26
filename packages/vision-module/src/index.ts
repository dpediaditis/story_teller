import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type { CaptureGuidance, IsolateOptions, IsolateResult } from './PapercubVision.types';

export type { IsolateOptions, IsolateResult, CaptureGuidance } from './PapercubVision.types';

/**
 * Thrown whenever the native module is not there to do the work — Expo Go, an
 * unsupported OS, or a web build. Callers must handle it: this module never
 * invents a plausible-looking `IsolateResult` to paper over its own absence.
 */
export class IsolationUnavailableError extends Error {
  constructor(message = 'Papercub Vision is not available on this build.') {
    super(message);
    this.name = 'IsolationUnavailableError';
  }
}

/** Thrown when the native side ran but the result could not be trusted. */
export class IsolationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationFailedError';
  }
}

interface NativeIsolateResult {
  cutoutUri: string;
  processedOriginalUri: string;
  confidence: number;
  method: IsolateResult['method'];
  palette: string[];
  widthPx: number;
  heightPx: number;
  faceDetected: boolean;
  nameLikeTextDetected: boolean;
  exifStripped: boolean;
}

interface PapercubVisionNativeModule {
  isAvailable(): boolean;
  supportsSubjectLift(): boolean;
  isolateDrawing(options: Required<Omit<IsolateOptions, never>>): Promise<NativeIsolateResult>;
  applyManualMask(imageUri: string, maskUri: string): Promise<NativeIsolateResult>;
  startCaptureGuidance(): Promise<boolean>;
  stopCaptureGuidance(): Promise<boolean>;
  addListener?: (event: string, listener: (payload: CaptureGuidance) => void) => { remove(): void };
}

/**
 * `requireOptionalNativeModule` returns null instead of throwing when the
 * native module is missing. That is the whole reason the app still runs in
 * Expo Go, which is how the product is previewed on a real phone today.
 */
const native =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<PapercubVisionNativeModule>('PapercubVision')
    : null;

const DEFAULTS = {
  deskew: true,
  whiteBalance: true,
  confidenceThreshold: 0.6,
} as const;

/**
 * Pre-flight check. Safe to call anywhere, on any platform, in Expo Go.
 * Never throws.
 */
export function isAvailable(): boolean {
  if (!native) return false;
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

/**
 * False on iOS 16, where `VNGenerateForegroundInstanceMaskRequest` does not
 * exist and every capture goes down the ink-extraction path. Isolation still
 * works; the app can use this to set expectations rather than look broken.
 */
export function supportsSubjectLift(): boolean {
  if (!native) return false;
  try {
    return native.supportsSubjectLift();
  } catch {
    return false;
  }
}

function assertResult(value: NativeIsolateResult): IsolateResult {
  if (!value || typeof value.cutoutUri !== 'string' || !value.cutoutUri) {
    throw new IsolationFailedError('Isolation returned no cut-out.');
  }
  if (typeof value.confidence !== 'number' || Number.isNaN(value.confidence)) {
    throw new IsolationFailedError('Isolation returned no confidence score.');
  }
  // `exifStripped` is `true` in the contract because the native write path
  // re-opens every file it writes and refuses to return one that still carries
  // Exif or GPS. If it ever comes back false, something is very wrong and the
  // file must not be used.
  if (value.exifStripped !== true) {
    throw new IsolationFailedError('Refusing a file whose metadata could not be verified as stripped.');
  }
  return {
    cutoutUri: value.cutoutUri,
    processedOriginalUri: value.processedOriginalUri,
    confidence: Math.min(1, Math.max(0, value.confidence)),
    method: value.method,
    palette: Array.isArray(value.palette) ? value.palette : [],
    widthPx: value.widthPx,
    heightPx: value.heightPx,
    faceDetected: value.faceDetected === true,
    nameLikeTextDetected: value.nameLikeTextDetected === true,
    exifStripped: true,
  };
}

/**
 * Isolates the drawing from the photo, entirely on-device.
 *
 * Compare `confidence` against the threshold you passed: below it, route the
 * parent to manual repair rather than presenting the cut-out as a success.
 */
export async function isolateDrawing(options: IsolateOptions): Promise<IsolateResult> {
  if (!native) throw new IsolationUnavailableError();
  const raw = await native.isolateDrawing({
    imageUri: options.imageUri,
    deskew: options.deskew ?? DEFAULTS.deskew,
    whiteBalance: options.whiteBalance ?? DEFAULTS.whiteBalance,
    confidenceThreshold: options.confidenceThreshold ?? DEFAULTS.confidenceThreshold,
  });
  return assertResult(raw);
}

/**
 * Composites a parent-brushed matte over the source image.
 *
 * `maskUri` is the complete matte the repair UI is showing, not just the last
 * brush stroke: white/opaque keeps, black or transparent removes.
 */
export async function applyManualMask(args: { imageUri: string; maskUri: string }): Promise<IsolateResult> {
  if (!native) throw new IsolationUnavailableError();
  const raw = await native.applyManualMask(args.imageUri, args.maskUri);
  return assertResult(raw);
}

/**
 * expo-modules-core 57 made `EventEmitter` generic over an events MAP, rather
 * than taking the payload type on `addListener`. Passing no map infers
 * `TEventsMap = never`, which constrains the event-name generic to
 * `keyof never` — the TS2344 this replaces.
 */
type PapercubVisionEvents = {
  onCaptureGuidance: (guidance: CaptureGuidance) => void;
};

/**
 * Live capture guidance. Returns an unsubscribe function; calling it stops the
 * underlying camera session.
 *
 * A no-op that returns a no-op unsubscribe when the native module is absent,
 * so the camera screen renders and simply shows no coaching hints.
 */
export function subscribeCaptureGuidance(listener: (guidance: CaptureGuidance) => void): () => void {
  if (!native) return () => {};

  let subscription: { remove(): void } | null = null;
  try {
    subscription =
      typeof native.addListener === 'function'
        ? native.addListener('onCaptureGuidance', listener)
        : new EventEmitter<PapercubVisionEvents>(native as never).addListener('onCaptureGuidance', listener);
    void native.startCaptureGuidance();
  } catch {
    // A camera that will not start is not a crash — the capture screen keeps
    // working without hints.
    subscription?.remove();
    return () => {};
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subscription?.remove();
    void native.stopCaptureGuidance().catch(() => undefined);
  };
}
