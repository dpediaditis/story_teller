// POST /account-delete (deleteAccount). contract.ts: endpoints.deleteAccount.
// auth: 'user'. In-app account deletion, cascades within
// RETENTION_DAYS.accountHardDelete (supabase/migrations/20260825182100_...
// purge_expired_soft_deletes, a pg_cron job B1 already wired up — this
// endpoint only needs to set parent_accounts.deleted_at, which that job scans
// for daily).

import { DeleteAccountRequest } from '@papercub/shared';
import { RETENTION_DAYS } from '@papercub/shared';
import { requireUser } from '../_shared/auth.ts';
import { parseBody } from '../_shared/body.ts';
import { ApiFailure, ok, withEnvelope } from '../_shared/respond.ts';

const GATE_FRESHNESS_MS = 120_000;

Deno.serve(
  withEnvelope(async (req) => {
    if (req.method !== 'POST') {
      throw new ApiFailure('validation_failed', { message: `unsupported method ${req.method}` });
    }
    const { supabase, userId } = await requireUser(req);
    const { gatePassedAt } = await parseBody(req, DeleteAccountRequest);

    const gateMs = Date.parse(gatePassedAt);
    const nowMs = Date.now();
    if (Number.isNaN(gateMs) || gateMs > nowMs || nowMs - gateMs > GATE_FRESHNESS_MS) {
      throw new ApiFailure('validation_failed', {
        message: 'parental gate was not passed recently enough',
        copyKey: 'error.gate_expired',
      });
    }

    const { error } = await supabase
      .from('parent_accounts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', userId)
      .is('deleted_at', null);
    if (error) throw error;

    const scheduledPurgeAt = new Date(
      nowMs + RETENTION_DAYS.accountHardDelete * 24 * 60 * 60 * 1000,
    ).toISOString();

    return ok({ scheduledPurgeAt });
  }),
);
