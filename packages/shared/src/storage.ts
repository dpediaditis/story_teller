/**
 * Assets are never referenced by URL, always by storage_key. URLs are minted
 * short-lived and signed at read time. This is both a privacy control and what
 * makes the storage provider swappable.
 *
 * A storage_key is `<bucket>/<uid>/<scope>/<id>.<ext>`. The uid prefix is what
 * the Storage RLS policies match on — do not invent a different shape.
 */

export const STORAGE_BUCKETS = {
  /** Private. Original photos + cut-outs. */
  drawings: 'drawings',
  /** Private. CharacterAsset renders. */
  characterAssets: 'character-assets',
  /** Private. Covers and page illustrations. */
  illustrations: 'illustrations',
  /** Private. Narration audio + word-timing JSON. */
  narration: 'narration',
} as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export type StorageKey = string;

export function buildStorageKey(args: {
  bucket: StorageBucket;
  ownerUid: string;
  scope: string;
  id: string;
  ext: string;
}): StorageKey {
  return `${args.bucket}/${args.ownerUid}/${args.scope}/${args.id}.${args.ext}`;
}

export function parseStorageKey(key: StorageKey) {
  const [bucket, ownerUid, scope, filename] = key.split('/');
  if (!bucket || !ownerUid || !scope || !filename) return null;
  return { bucket: bucket as StorageBucket, ownerUid, scope, filename };
}
