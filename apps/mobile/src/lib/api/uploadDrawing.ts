import { File } from 'expo-file-system';
import { MAX_UPLOAD_BYTES } from '@papercub/shared';
import { apiClient, ApiCallError } from './index';

/**
 * Puts a local file into Storage and returns the `storage_key` the server
 * knows it by.
 *
 * The create flow used to send `drawings/local/<timestamp>-cutout.png` — a key
 * that named nothing, because `createUploadUrl` was never called. The character
 * row was written, the job enqueued, and the worker then failed at gate 1 with
 * an empty bucket. Nothing about that was visible from the app.
 *
 * Two rules this has to respect, both from docs/ARCHITECTURE.md and §10:
 *
 *  - The upload goes DIRECTLY to Storage from the device. The bytes never pass
 *    through an Edge Function, which is why a child's drawing is never sitting
 *    in a function's memory or logs.
 *  - The path is minted server-side under the caller's own uid prefix. The
 *    client never composes a storage key, so it cannot write to another
 *    account's prefix even if it tried.
 *
 * The transfer itself is `File.upload()` — a NATIVE PUT. The alternative is
 * reading the whole image into JS as base64 and posting that, which for a
 * 12 MB photo means a ~16 MB string on the JS thread; the native path streams
 * it and never materialises the bytes in JS at all.
 */
/* Mirrors CreateUploadUrlRequest in contract.ts, which is exported as a zod
 * schema only and has no inferred type export to import. If either enum moves
 * there, it moves here — the compiler will not catch it. */
type UploadPurpose = 'cutout' | 'original';
type UploadContentType = 'image/png' | 'image/jpeg' | 'image/heic';

export interface UploadedDrawing {
  storageKey: string;
  byteLength: number;
}

export class DrawingTooLargeError extends Error {
  constructor(byteLength: number) {
    super(`drawing is ${byteLength} bytes, over the ${MAX_UPLOAD_BYTES} limit`);
    this.name = 'DrawingTooLargeError';
  }
}

export async function uploadDrawing(args: {
  childId: string;
  /** A local `file://` URI, from the camera or the isolation result. */
  fileUri: string;
  purpose: UploadPurpose;
  contentType: UploadContentType;
}): Promise<UploadedDrawing> {
  const file = new File(args.fileUri);

  // `size` is null when the file does not exist — a bad URI must fail here,
  // loudly, rather than be uploaded as zero bytes and fail in the worker
  // twenty seconds and one paid provider call later.
  const byteLength = file.size;
  if (byteLength == null || byteLength <= 0) {
    throw new ApiCallError({
      code: 'validation_failed',
      message: `no readable file at ${args.fileUri}`,
      copyKey: 'error.validation_failed',
      retryable: false,
    });
  }
  // Checked before asking for a URL: the server enforces this too, but a
  // round trip to be told the answer we already have is a round trip wasted.
  if (byteLength > MAX_UPLOAD_BYTES) throw new DrawingTooLargeError(byteLength);

  const signed = await apiClient.call('createUploadUrl', {
    childId: args.childId,
    contentType: args.contentType,
    byteLength,
    purpose: args.purpose,
  });

  // `uploadUrl` is absolute and already carries `?token=…`, so this is the
  // same request supabase-js's uploadToSignedUrl would make.
  const result = await file.upload(signed.uploadUrl, {
    httpMethod: 'PUT',
    mimeType: args.contentType,
    headers: {
      'content-type': args.contentType,
      // A freshly minted uuid path; nothing to overwrite. Explicit so that a
      // retry with the SAME signed URL fails rather than silently replacing
      // whatever is there.
      'x-upsert': 'false',
    },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new ApiCallError({
      code: result.status === 413 ? 'validation_failed' : 'upstream_unavailable',
      message: `storage upload failed with ${result.status}: ${result.body.slice(0, 300)}`,
      copyKey: 'error.upstream_unavailable',
      retryable: result.status >= 500,
    });
  }

  return { storageKey: signed.storageKey, byteLength };
}
