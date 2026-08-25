// /account-merge — createMergeToken, mergePreview, mergeAccounts.
// contract.ts: endpoints.createMergeToken/mergePreview/mergeAccounts.
// auth: 'user'. docs/ARCHITECTURE.md "Account merge flow".
//
// Sub-routing convention (all three are POST on fn 'account-merge'):
//   POST /account-merge          -> createMergeToken (called by session A, anonymous)
//   POST /account-merge/preview  -> mergePreview      (called by session B)
//   POST /account-merge/confirm  -> mergeAccounts      (called by session B)
//
// KNOWN GAPS (both flagged in this agent's handover report, do not silently
// retry-loop on them):
//  1. merge_accounts() is `grant execute ... to service_role` only — same
//     grant mismatch as apply_revenuecat_event (see revenuecat-webhook/index.ts).
//     This function is not allowed to hold SUPABASE_SERVICE_ROLE_KEY, so the
//     RPC call below will fail 42501 under the schema exactly as delivered.
//  2. Storage object re-keying between the source and target uid prefixes
//     (the "KNOWN LOOSE END" in this agent's brief) is NOT implemented here.
//     Judgment call: it structurally cannot be done correctly from this
//     Edge Function — moving an object from <uidA>/... to <uidB>/... needs
//     read access to uidA's objects AND write access to uidB's, and by the
//     time mergeAccounts runs, only session B's JWT is available (session A's
//     anonymous session is gone once B is signed in). Only a service-role
//     client — which belongs exclusively to services/worker per CLAUDE.md
//     rule 1 — can bridge that. Recommendation: services/worker gains a
//     one-off reconciliation step (e.g. watching parent_accounts.deleted_at
//     transitions with a non-null merge target) that re-keys
//     character_assets / original_drawings / page_illustrations / narrations
//     storage_key values and the underlying Storage objects, then that's
//     purely additive to this Edge Function's DB-side merge.

import { MergeAccountsRequest, MergePreviewRequest } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody } from '../_shared/body.ts';
import { loadEntitlementAndQuota } from '../_shared/quota.ts';
import { signMergeToken, verifyMergeToken } from '../_shared/merge-token.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

function subPath(req: Request): string[] {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('account-merge');
  return idx >= 0 ? parts.slice(idx + 1) : [];
}

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }
    const { supabase, userId } = await requireUser(req);
    const path = subPath(req);

    if (path.length === 0) {
      const [{ count: characters, error: charError }, { count: stories, error: storyError }, { data: names, error: nameError }] =
        await Promise.all([
          supabase.from('characters').select('id', { count: 'exact', head: true }).is('archived_at', null),
          supabase.from('stories').select('id', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('characters').select('name').is('archived_at', null),
        ]);
      if (charError) throw charError;
      if (storyError) throw storyError;
      if (nameError) throw nameError;

      const { token, expiresAt } = await signMergeToken({
        sourceParentId: userId,
        characters: characters ?? 0,
        stories: stories ?? 0,
        characterNames: (names ?? []).map((n) => n.name),
      });

      return ok({
        mergeToken: token,
        expiresAt,
        localCounts: { characters: characters ?? 0, stories: stories ?? 0 },
      });
    }

    if (path.length === 1 && path[0] === 'preview') {
      const { mergeToken } = await parseBody(req, MergePreviewRequest);
      const payload = await verifyMergeToken(mergeToken);
      if (!payload) {
        throw new ApiFailure('validation_failed', { message: 'merge token invalid or expired', copyKey: 'error.merge_token_invalid' });
      }
      if (payload.sourceParentId === userId) {
        throw new ApiFailure('conflict', { message: 'cannot merge an account into itself', copyKey: 'error.conflict' });
      }

      const [{ count: targetCharacters, error: tcError }, { count: targetStories, error: tsError }, { data: targetNames, error: tnError }, { entitlement, quota }] =
        await Promise.all([
          supabase.from('characters').select('id', { count: 'exact', head: true }).is('archived_at', null),
          supabase.from('stories').select('id', { count: 'exact', head: true }).is('deleted_at', null),
          supabase.from('characters').select('name').is('archived_at', null),
          loadEntitlementAndQuota(supabase, userId),
        ]);
      if (tcError) throw tcError;
      if (tsError) throw tsError;
      if (tnError) throw tnError;

      const wouldExceedCharacterQuota = (targetCharacters ?? 0) + payload.characters > quota.charactersLimit;

      return ok({
        source: {
          parentId: payload.sourceParentId,
          characters: payload.characters,
          stories: payload.stories,
          characterNames: payload.characterNames,
        },
        target: {
          parentId: userId,
          characters: targetCharacters ?? 0,
          stories: targetStories ?? 0,
          characterNames: (targetNames ?? []).map((n) => n.name),
          entitlement,
        },
        mergedCounts: {
          characters: (targetCharacters ?? 0) + payload.characters,
          stories: (targetStories ?? 0) + payload.stories,
        },
        wouldExceedCharacterQuota,
        duplicatePolicy: 'keep_both' as const,
      });
    }

    if (path.length === 1 && path[0] === 'confirm') {
      const { mergeToken, strategy } = await parseBody(req, MergeAccountsRequest);
      const payload = await verifyMergeToken(mergeToken);
      if (!payload) {
        throw new ApiFailure('validation_failed', { message: 'merge token invalid or expired', copyKey: 'error.merge_token_invalid' });
      }
      if (payload.sourceParentId === userId) {
        throw new ApiFailure('conflict', { message: 'cannot merge an account into itself', copyKey: 'error.conflict' });
      }

      const { error: mergeError } = await supabase.rpc('merge_accounts', {
        p_source_parent_id: payload.sourceParentId,
        p_target_parent_id: userId,
        p_strategy: strategy,
      });
      if (mergeError) {
        if (mergeError.code === '42501') {
          throw new ApiFailure('internal', {
            message:
              'merge_accounts blocked by grants: only service_role may execute it, and this Edge ' +
              'Function does not hold SUPABASE_SERVICE_ROLE_KEY (CLAUDE.md rule 1). Needs a B1 migration ' +
              'granting a role this function can act as (it has already verified the merge token).',
            retryable: false,
          });
        }
        throw mergeError;
      }

      const [{ count: movedCharacters }, { count: movedStories }] = await Promise.all([
        supabase.from('characters').select('id', { count: 'exact', head: true }).is('archived_at', null),
        supabase.from('stories').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      ]);

      const { entitlement, quota } = await loadEntitlementAndQuota(supabase, userId);
      const { data: parent, error: parentError } = await supabase
        .from('parent_accounts')
        .select('is_anonymous, linked_providers, locale')
        .eq('id', userId)
        .single();
      if (parentError) throw parentError;
      const { data: children, error: childrenError } = await supabase
        .from('child_profiles')
        .select('id, display_name, age_band, avatar_character_id, created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (childrenError) throw childrenError;

      return ok({
        strategy,
        movedCharacters: strategy === 'merge' ? movedCharacters ?? 0 : 0,
        movedStories: strategy === 'merge' ? movedStories ?? 0 : 0,
        orphanedParentId: strategy === 'keep_account_only' ? payload.sourceParentId : null,
        session: {
          parentId: userId,
          isAnonymous: parent.is_anonymous,
          linkedProviders: parent.linked_providers,
          locale: parent.locale,
          children: (children ?? []).map((c) => ({
            id: c.id,
            displayName: c.display_name,
            ageBand: c.age_band,
            avatarCharacterId: c.avatar_character_id,
            createdAt: c.created_at,
          })),
          entitlement,
          quota,
          generationHalted: false,
          serverTime: new Date().toISOString(),
        },
      });
    }

    throw new ApiFailure('validation_failed', { message: `unsupported route POST /account-merge/${path.join('/')}` });
  }),
);
