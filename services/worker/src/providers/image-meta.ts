/**
 * What an image actually is, read off its own bytes.
 *
 * The worker used to assert this instead of reading it: every illustration was
 * named `.png`, uploaded as `image/png`, and recorded at a hardcoded 1024x1280
 * (cover) or 1024x768 (page). Measured live on the first complete story, Gemini
 * returned JPEG at 928x1152 and 1200x896 — so the stored object contradicted
 * its own content type and every `page_illustrations` row carried dimensions
 * the file did not have. The reader lays out from those columns.
 *
 * This is the same defect as writing PCM into a `.mp3` (DECISIONS.md §16), and
 * it closes DECISIONS.md §14 item 5: the dimensions needed a header read, not
 * an image decoder dependency. Only the container header is parsed — never the
 * pixels — so there is nothing here to add to the worker image.
 */

export interface ImageMeta {
  mimeType: string;
  /** Storage key extension, matching the mime type. */
  ext: string;
  width: number;
  height: number;
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at]! << 8) | b[at + 1]!;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  return sig.every((v, i) => b[at + i] === v);
}

/** PNG: the IHDR chunk is always first and always at a fixed offset. */
function png(b: Uint8Array): ImageMeta | null {
  if (!startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  return { mimeType: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * JPEG: walk the marker chain to the frame header. Dimensions are not at a
 * fixed offset because EXIF and quantisation tables come first and vary in
 * size, so the segment lengths have to be followed.
 */
function jpeg(b: Uint8Array): ImageMeta | null {
  if (!startsWith(b, [0xff, 0xd8])) return null;

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    // Standalone markers carry no length segment.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // SOF0..SOF15 hold the frame size. C4/C8/CC are Huffman/arithmetic tables
    // that share the numeric range and are NOT frame headers.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        mimeType: 'image/jpeg',
        ext: 'jpg',
        height: u16be(b, i + 5),
        width: u16be(b, i + 7),
      };
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** WebP, all three flavours. Gemini does not currently return it; a provider swap might. */
function webp(b: Uint8Array): ImageMeta | null {
  if (!startsWith(b, [0x52, 0x49, 0x46, 0x46]) || !startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) {
    return null;
  }
  const base = { mimeType: 'image/webp', ext: 'webp' };
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);

  if (fourcc === 'VP8 ') {
    return { ...base, width: u16be(b, 27) & 0x3fff, height: u16be(b, 29) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const bits = u32le(b, 21);
    return { ...base, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    const dim = (at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + 1;
    return { ...base, width: dim(24), height: dim(27) };
  }
  return null;
}

export class UnrecognisedImageError extends Error {
  constructor(bytes: Uint8Array) {
    const head = [...bytes.slice(0, 8)].map((v) => v.toString(16).padStart(2, '0')).join(' ');
    super(
      `Could not identify the image a provider returned (${bytes.byteLength} bytes, ` +
        `starts ${head}). Refusing to guess a content type: a stored object whose ` +
        `declared type contradicts its bytes is how narration shipped as an ` +
        `unplayable .mp3.`,
    );
    this.name = 'UnrecognisedImageError';
  }
}

/** Identifies PNG, JPEG or WebP from the header. Throws rather than guessing. */
export function describeImage(bytes: Uint8Array): ImageMeta {
  const meta = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  if (!meta) throw new UnrecognisedImageError(bytes);
  return meta;
}
