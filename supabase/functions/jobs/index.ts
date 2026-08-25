// GET /jobs?id=... (getJob). contract.ts: endpoints.getJob. auth: 'user'.
// Realtime channel `job:{jobId}` is the primary path; this is the polling
// fallback (SLO.jobPollIntervalMs).

import { Uuid } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseQuery } from '../_shared/body.ts';
import { toJobStatusDto } from '../_shared/dto.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';
import { z } from 'zod';

const GetJobQuery = z.object({ id: Uuid });

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'GET') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }
    const { supabase } = await requireUser(req);
    const { id } = parseQuery(req, GetJobQuery);

    const { data, error } = await supabase
      .from('generation_jobs')
      .select(
        'id, type, status, stage, pages_completed, pages_total, story_id, character_id, error_code, quota_refunded, started_at, finished_at, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiFailure('not_found', { message: 'job not found', copyKey: 'error.not_found' });

    return ok({ job: toJobStatusDto(data) });
  }),
);
