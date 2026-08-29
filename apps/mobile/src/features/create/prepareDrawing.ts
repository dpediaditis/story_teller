import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { DrawingSource } from '@papercub/shared';

/**
 * Gets a drawing into the create flow — from the camera roll or straight off
 * the shutter — and makes it safe to upload.
 *
 * DECISIONS.md §10: "EXIF/GPS stripped on-device before any upload."
 *
 * The app was ASSERTING that rather than doing it. `IsolationPreviewScreen`'s
 * `acceptAsIs()` fabricates `exifStripped: true`, and the contract types the
 * field as `z.literal(true)` so it cannot say otherwise. That claim is only
 * true when the native isolation path ran — vision-module re-opens every file
 * it writes and refuses one that still carries Exif or GPS — and that module is
 * a stub that always throws. So every drawing today reaches `createCharacter`
 * with an unstripped file and a promise that it was stripped.
 *
 * A library photo makes it worse than untidy: a camera-roll image routinely
 * carries GPS, so "which house this child lives in" would have been uploaded
 * with their drawing.
 *
 * `renderAsync()` decodes the pixels and `saveAsync()` writes a fresh file from
 * them. Metadata is not copied across, so a re-encode drops Exif, GPS and the
 * rest — which is why this is a real strip and not a flag flip. It is a stopgap
 * for the paths where the native module has not run; when B4 lands, its own
 * verified write path is the stronger guarantee and this stays as the fallback.
 */
export interface PreparedDrawing {
  /** A freshly written file with no metadata. Safe to upload. */
  uri: string;
  widthPx: number;
  heightPx: number;
  source: DrawingSource;
}

/**
 * PNG, not JPEG. The cut-out that eventually gets uploaded carries alpha, and
 * re-encoding to JPEG here would flatten transparency to black before the
 * isolation step ever sees it.
 */
const SAVE_OPTIONS = { format: SaveFormat.PNG, compress: 1 } as const;

async function stripMetadata(uri: string, source: DrawingSource): Promise<PreparedDrawing> {
  const context = ImageManipulator.manipulate(uri);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync(SAVE_OPTIONS);
  return {
    uri: saved.uri,
    // Real dimensions, read off the decoded image. `acceptAsIs()` hardcodes
    // 1024x1024, which then lands in original_drawings.width_px/height_px as a
    // number nothing measured.
    widthPx: saved.width,
    heightPx: saved.height,
    source,
  };
}

/** The shutter path. `uri` is what `takePictureAsync` returned. */
export function prepareCapturedPhoto(uri: string): Promise<PreparedDrawing> {
  return stripMetadata(uri, 'camera');
}

/**
 * The camera-roll path. Returns null when the parent cancels or declines
 * library access — both are ordinary outcomes, not failures, and the caller
 * simply stays where it is.
 */
export async function pickDrawingFromLibrary(): Promise<PreparedDrawing | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // We re-encode anyway, so asking the picker for Exif would only pull the
    // GPS we are trying to get rid of into JS.
    exif: false,
    quality: 1,
    allowsMultipleSelection: false,
  });

  if (result.canceled || result.assets.length === 0) return null;
  return stripMetadata(result.assets[0]!.uri, 'photos');
}
