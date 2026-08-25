import type { AuthProvider as AuthProviderKind } from '@papercub/shared';

export type { AuthProviderKind };

/** Native module missing/unavailable (Expo Go without the entitlement, no
 *  iCloud session, no Google client id configured, etc.) — never surfaced as
 *  a generic sign-in failure, so the UI can show "not available here". */
export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: AuthProviderKind, message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** The user dismissed the native sheet / OAuth browser — not an error. */
export class SignInCancelledError extends Error {
  constructor(public readonly provider: AuthProviderKind) {
    super(`${provider} sign-in was cancelled`);
    this.name = 'SignInCancelledError';
  }
}

/** Result of the linkIdentity-or-merge upgrade sequence (see upgrade.ts). */
export type UpgradeOutcome =
  | { kind: 'linked' }
  | {
      kind: 'merge_required';
      mergeToken: string;
      preview: import('@papercub/shared').MergePreviewResponse;
    };
