import type { MergePreviewResponse } from '@papercub/shared';

/**
 * Hands the merge preview (real objects, not URL-serialisable) from
 * `app/(auth)/sign-in.tsx` to `app/(auth)/merge-conflict.tsx`. Deliberately a
 * plain module-scoped slot, not React state or a route param: the merge
 * conflict flow is a single short-lived hop between two screens in one
 * session, never persisted, never deep-linked into directly.
 */
export interface PendingMerge {
  mergeToken: string;
  preview: MergePreviewResponse;
}

let pending: PendingMerge | null = null;

export function setPendingMerge(value: PendingMerge): void {
  pending = value;
}

export function takePendingMerge(): PendingMerge | null {
  const value = pending;
  pending = null;
  return value;
}
