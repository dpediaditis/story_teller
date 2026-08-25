// POST /media-sign (signMedia). contract.ts: endpoints.signMedia. auth: 'user'.
// Batched — one round trip per screen. Reads always go through a signed URL
// minted here (docs/ARCHITECTURE.md); assets are never referenced by URL.

import { SignMediaRequest } from '@papercub/shared';
import { parseStorageKey } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody } from '../_shared/body.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }
    const { supabase, userId } = await requireUser(req);
    const { storageKeys, expiresInSeconds } = await parseBody(req, SignMediaRequest);

    const media = await Promise.all(
      storageKeys.map(async (storageKey) => {
        const parsed = parseStorageKey(storageKey);
        if (!parsed) {
          throw new ApiFailure('validation_failed', {
            message: `malformed storageKey: ${storageKey}`,
            copyKey: 'error.validation_failed',
          });
        }
        if (parsed.ownerUid !== userId) {
          // Storage RLS (caller-scoped client) would reject this anyway; fail
          // fast with a clean error instead of a raw storage-provider one.
          throw new ApiFailure('forbidden', {
            message: 'storageKey does not belong to caller',
            copyKey: 'error.forbidden',
          });
        }
        const objectPath = `${parsed.ownerUid}/${parsed.scope}/${parsed.filename}`;
        const { data, error } = await supabase.storage
          .from(parsed.bucket)
          .createSignedUrl(objectPath, expiresInSeconds);
        if (error || !data) {
          throw new ApiFailure('upstream_unavailable', {
            message: error?.message ?? 'failed to sign media URL',
            copyKey: 'error.upstream_unavailable',
            retryable: true,
          });
        }
        return {
          storageKey,
          url: data.signedUrl,
          expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        };
      }),
    );

    return ok({ media });
  }),
);
