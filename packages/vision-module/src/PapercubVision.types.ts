import type { IsolationMethod } from '@papercub/shared';

export interface IsolateOptions {
  imageUri: string;            // file:// URI of captured or imported photo
  deskew?: boolean;
  whiteBalance?: boolean;
  confidenceThreshold?: number;
}

export interface IsolateResult {
  cutoutUri: string;              // file:// PNG with alpha
  processedOriginalUri: string;   // deskewed, EXIF-stripped full photo
  confidence: number;             // 0..1
  method: IsolationMethod;
  palette: string[];              // hex, feeds Character.palette
  widthPx: number;
  heightPx: number;
  faceDetected: boolean;
  nameLikeTextDetected: boolean;
  exifStripped: true;             // always true on return
}

export interface CaptureGuidance {
  paperDetected: boolean;
  glareDetected: boolean;
  edgeCutOff: boolean;
  steady: boolean;
}
