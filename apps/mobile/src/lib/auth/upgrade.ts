import type { AuthError } from '@supabase/supabase-js';
import type { z } from 'zod';
import {
  CreateMergeTokenResponse,
  MergeAccountsResponse,
  MergePreviewResponse,
  type MergeStrategy,
} from '@papercub/shared';
import { supabase } from '../supabase';
import { invokeAuthFn } from './functions';
import { ensureAnonymousSession } from './anonymous';
import { getAppleCredential } from './providers/apple';
import { getGoogleCredential } from './providers/google';
import type { AuthProviderKind, UpgradeOutcome } from './types';

/** `linkIdentity`/`signInWithIdToken` never take `'anonymous'` — narrow the
 *  wire-level `AuthProviderKind` down to the two real OAuth providers. */
export type LinkableProvider = Exclude<AuthProviderKind, 'anonymous'>;

/**
 * The account-merge conflict flow (docs/ARCHITECTURE.md "Account merge
 * flow", DECISIONS.md §7). NEVER call this at launch — only from the paywall
 * and "Sign in to keep the library" (brief item 4). Because sign-in is
 * always an *upgrade* of the standing anonymous session in this app (there is
 * no separate first-run sign-in screen — DECISIONS.md §12), this one function
 * covers both the plain "Sign in" action and the merge-conflict path; the
 * caller only needs to branch on the returned `UpgradeOutcome`.
 *
 * Sequence (matches docs/ARCHITECTURE.md exactly):
 *   1. createMergeToken while still session A (anonymous) — proves ownership
 *      of A's content even after A is abandoned in step 5.
 *   2. Get a provider credential (Apple/Google).
 *   3. Attempt `linkIdentity` on the CURRENT (anonymous) session — this
 *      upgrades uid A in place when the identity is free.
 *   4. If that fails with `identity_already_exists`, sign out of A (content
 *      retained, never deleted) and sign in normally to get session B.
 *   5. mergePreview(token) under session B.
 * The caller then shows the merge-conflict screen and calls `confirmMerge`.
 */
export async function beginAccountUpgrade(provider: LinkableProvider): Promise<UpgradeOutcome> {
  const { data: existing } = await supabase.auth.getSession();
  if (!existing.session) {
    await ensureAnonymousSession();
  }

  const { mergeToken } = await invokeAuthFn('account-merge', CreateMergeTokenResponse);

  const credential = provider === 'apple' ? await getAppleCredential() : await getGoogleCredential();

  // `linkIdentity` with an id-token credential ties the provider identity to
  // the CURRENT session (uid A) and leaves that session untouched if it
  // fails — unlike `signInWithIdToken`, which would otherwise be ambiguous
  // between "sign in" and "link". This is the literal `linkIdentity()` named
  // in DECISIONS.md §7 / docs/ARCHITECTURE.md.
  const { error: linkError } = await supabase.auth.linkIdentity({
    provider,
    token: credential.idToken,
    nonce: credential.nonce,
  });

  if (!linkError) {
    return { kind: 'linked' };
  }

  if (!isIdentityConflict(linkError)) {
    throw linkError;
  }

  // Conflict: this identity already belongs to another account. Sign out of
  // the anonymous session — this does NOT delete uid A's content, see
  // DECISIONS.md §12a / RETENTION_DAYS.orphanedAnonymousContent — then sign
  // in normally to reach session B.
  await supabase.auth.signOut();
  const { error: signInError } = await supabase.auth.signInWithIdToken({
    provider,
    token: credential.idToken,
    nonce: credential.nonce,
  });
  if (signInError) {
    // Left with no session at all — restore an anonymous one so the app
    // never has to gate reading behind sign-in (RED LINE).
    await ensureAnonymousSession().catch(() => {});
    throw signInError;
  }

  const preview = await invokeAuthFn('account-merge/preview', MergePreviewResponse, { mergeToken });
  return { kind: 'merge_required', mergeToken, preview };
}

/**
 * Confirms the merge choice from the "That account already has a library"
 * screen. Default strategy is `'merge'` ("Put them together") — see
 * DECISIONS.md §7 and this agent's brief item 4. `'keep_account_only'` is
 * NOT a delete: uid A's content is retained server-side.
 *
 * The server re-checks authorisation independently (merge_accounts() raises
 * 42501 if the caller isn't the merge target, mapped to `forbidden` by the
 * Edge Function) — that surfaces as an `ApiCallError` with
 * `apiError.code === 'forbidden'`, same as any other endpoint error. Callers
 * route it to the sign-in-failure screen like any other unrecoverable merge
 * error; there is no special client-side bypass to attempt.
 */
export async function confirmMerge(
  mergeToken: string,
  strategy: MergeStrategy,
): Promise<z.infer<typeof MergeAccountsResponse>> {
  return invokeAuthFn('account-merge/confirm', MergeAccountsResponse, { mergeToken, strategy });
}

function isIdentityConflict(error: AuthError): boolean {
  const code = (error as AuthError & { code?: string }).code;
  return code === 'identity_already_exists' || /identity_already_exists/i.test(error.message ?? '');
}
