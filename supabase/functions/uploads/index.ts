// POST /uploads (createUploadUrl). contract.ts: endpoints.createUploadUrl.
// auth: 'user'. The client uploads DIRECTLY to Supabase Storage with the
// returned signed URL (DECISIONS.md §10).
//
// Red line (docs/AGENT_BRIEFS.md B2): every signed upload path is scoped to
// the CALLER's own uid prefix — never a client-supplied uid, never another
// child's/parent's prefix.

import { CreateUploadUrlRequest } from '@papercub/shared';

import { MAX_UPLOAD_BYTES, STORAGE_BUCKETS, buildStorageKey } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody } from '../_shared/body.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

// createSignedUploadUrl's token is valid for 2 hours — fixed by the Storage
// API, not configurable per-call.
const SIGNED_UPLOAD_TTL_SECONDS = 7200;

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/heic': 'heic',
};

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }

    const { supabase, userId } = await requireUser(req);
    const { childId, contentType, byteLength, purpose } = await parseBody(req, CreateUploadUrlRequest);

    if (byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiFailure('validation_failed', {
        message: `byteLength ${byteLength} exceeds MAX_UPLOAD_BYTES ${MAX_UPLOAD_BYTES}`,
        copyKey: 'error.validation_failed',
      });
    }

    // Ownership re-check: RLS would reject the child_profiles read anyway if
    // it isn't the caller's, but we want a clean not_found/forbidden instead
    // of proceeding to mint a URL for a resource that turns out unreadable.
    const { data: child, error: childError } = await supabase
      .from('child_profiles')
      .select('id')
      .eq('id', childId)
      .is('deleted_at', null)
      .maybeSingle();
    if (childError) throw childError;
    if (!child) {
      throw new ApiFailure('forbidden', {
        message: 'child does not belong to caller',
        copyKey: 'error.forbidden',
      });
    }

    const ext = EXT_FOR_CONTENT_TYPE[contentType];
    if (!ext) {
      throw new ApiFailure('validation_failed', { message: `unsupported contentType ${contentType}` });
    }

    const bucket = STORAGE_BUCKETS.drawings;
    const id = crypto.randomUUID();
    const storageKey = buildStorageKey({ bucket, ownerUid: userId, scope: purpose, id, ext });
    // Object path within the bucket (Storage API dimension), i.e. storageKey
    // with the `${bucket}/` prefix stripped — see packages/shared/src/storage.ts.
    const objectPath = `${userId}/${purpose}/${id}.${ext}`;

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath);
    if (error) {
      throw new ApiFailure('upstream_unavailable', {
        message: error.message,
        copyKey: 'error.upstream_unavailable',
        retryable: true,
      });
    }

    const response = {
      storageKey,
      uploadUrl: data.signedUrl,
      token: data.token,
      expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
    return ok(response);
  }),
);
