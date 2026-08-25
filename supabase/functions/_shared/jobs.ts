// generation_jobs writes from an Edge Function.
//
// KNOWN SCHEMA GAP (see this agent's handover report): generation_jobs has a
// SELECT-only RLS policy for `authenticated`
// (supabase/migrations/20260825181300_generation_jobs.sql — "Deliberately no
// insert/update/delete policy ... Writes happen only via security definer
// functions (claim_story_quota, refund_story_quota, record_cost) or the
// worker's service-role client"). B1 supplied a security-definer claim
// function ONLY for `story_generate` (claim_story_quota). No equivalent
// exists for `character_build` or `page_regenerate`, so a caller-JWT-scoped
// insert here is expected to fail with a 42501 RLS violation until a B1
// migration adds one. This helper makes that failure explicit and typed
// instead of letting a raw Postgres error leak, and callers use it so the
// only thing that needs to change later is what's inside this function.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, GenerationStage, JobStatus, JobType } from '@papercub/shared';
import { ApiFailure } from './respond.ts';

export interface InsertJobArgs {
  parentId: string;
  storyId?: string | null;
  characterId?: string | null;
  type: JobType;
  status?: JobStatus;
  stage?: GenerationStage;
  pagesTotal?: number;
  estimatedCostCents: number;
  idempotencyKey: string;
}

export async function insertJobOrExplain(
  supabase: SupabaseClient<Database>,
  args: InsertJobArgs,
) {
  const { data, error } = await supabase
    .from('generation_jobs')
    .insert({
      parent_id: args.parentId,
      story_id: args.storyId ?? null,
      character_id: args.characterId ?? null,
      type: args.type,
      status: args.status ?? 'queued',
      stage: args.stage ?? 'queued',
      pages_total: args.pagesTotal ?? 0,
      estimated_cost_cents: args.estimatedCostCents,
      idempotency_key: args.idempotencyKey,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '42501') {
      throw new ApiFailure('internal', {
        message:
          `generation_jobs insert blocked by RLS for type '${args.type}': no security-definer ` +
          'claim function or INSERT policy exists for this job type under the delivered schema ' +
          '(only claim_story_quota covers story_generate). Needs a B1 migration.',
        retryable: false,
      });
    }
    throw error;
  }
  return data;
}
