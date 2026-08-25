// POST /children (upsertChild), DELETE /children (deleteChild).
// contract.ts: endpoints.upsertChild, endpoints.deleteChild. auth: 'user'.

import { DeleteChildRequest, UpsertChildRequest } from '@papercub/shared';

import { requireUser } from '../_shared/auth.ts';
import { parseBody } from '../_shared/body.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

Deno.serve(
  withEnvelope(async (req) => {
    const { supabase, userId } = await requireUser(req);

    if (req.method === 'POST') {
      const { id, displayName, ageBand } = await parseBody(req, UpsertChildRequest);

      const row = id
        ? await supabase
            .from('child_profiles')
            .update({ display_name: displayName, age_band: ageBand })
            .eq('id', id)
            .is('deleted_at', null)
            .select('id, display_name, age_band, avatar_character_id, created_at')
            .maybeSingle()
        : await supabase
            .from('child_profiles')
            .insert({ parent_id: userId, display_name: displayName, age_band: ageBand })
            .select('id, display_name, age_band, avatar_character_id, created_at')
            .single();

      if (row.error) throw row.error;
      if (!row.data) {
        throw new ApiFailure('not_found', { message: 'child not found', copyKey: 'error.not_found' });
      }

      const child = {
        id: row.data.id,
        displayName: row.data.display_name,
        ageBand: row.data.age_band,
        avatarCharacterId: row.data.avatar_character_id,
        createdAt: row.data.created_at,
      };
      const response = { child };
      return ok(response);
    }

    if (req.method === 'DELETE') {
      const { id } = await parseBody(req, DeleteChildRequest);
      const { error, data } = await supabase
        .from('child_profiles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new ApiFailure('not_found', { message: 'child not found', copyKey: 'error.not_found' });
      }
      return ok({});
    }

    throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
  }),
);
