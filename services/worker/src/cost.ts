// TODO(C1): cost recording + the global daily spend halt (DECISIONS.md §3.3).
// Every write here must be built from PROVIDER-MEASURED usage
// (ProviderUsage.costCents from providers/types.ts) — never an estimate.

import type { RecordCostRequest } from '@papercub/shared';

export async function recordCost(_req: RecordCostRequest): Promise<void> {
  throw new Error('TODO(C1): recordCost is not yet implemented.');
}

/** Whether GLOBAL_DAILY_SPEND_CAP_CENTS has been reached for today (UTC). */
export async function isGlobalSpendHalted(): Promise<boolean> {
  throw new Error('TODO(C1): isGlobalSpendHalted is not yet implemented.');
}
