// GET /session — one call the app makes on launch and on foreground.
// contract.ts: endpoints.getSession. auth: 'user'.


import { requireUser } from '../_shared/auth.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';
import { isGenerationHalted, loadEntitlementAndQuota } from '../_shared/quota.ts';

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'GET') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }

    const { supabase, userId } = await requireUser(req);

    const [{ data: parent, error: parentError }, { data: children, error: childrenError }] =
      await Promise.all([
        supabase
          .from('parent_accounts')
          .select('is_anonymous, linked_providers, locale')
          .eq('id', userId)
          .single(),
        supabase
          .from('child_profiles')
          .select('id, display_name, age_band, avatar_character_id, created_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
      ]);

    if (parentError) throw parentError;
    if (childrenError) throw childrenError;

    const { entitlement, quota } = await loadEntitlementAndQuota(supabase, userId);

    const childDtos = (children ?? []).map((c) => ({
      id: c.id,
      displayName: c.display_name,
      ageBand: c.age_band,
      avatarCharacterId: c.avatar_character_id,
      createdAt: c.created_at,
    }));

    const response = {
      parentId: userId,
      isAnonymous: parent.is_anonymous,
      linkedProviders: parent.linked_providers,
      locale: parent.locale,
      children: childDtos,
      entitlement,
      quota,
      generationHalted: isGenerationHalted(),
      serverTime: new Date().toISOString(),
    };

    return ok(response);
  }),
);
