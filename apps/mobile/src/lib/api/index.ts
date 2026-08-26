export type { ApiClient } from './client';
export { ApiCallError } from './client';
export { generationStageCopy, errorCopy, GENERATION_STAGE_ORDER } from './copy';
export { mockApiClient, __mockSetEntitlement, __mockExhaustFreeQuota, __mockGrantTopup } from './mock-client';

import { isSupabaseConfigured } from '../auth/config';
import { mockApiClient } from './mock-client';
import { supabaseApiClient } from './supabase-client';

/**
 * The single apiClient every screen imports.
 *
 * Live when the app has real Supabase credentials, mock otherwise. The mock is
 * NOT dead code and is not a fallback for a broken backend — it is what keeps
 * the app explorable in stock Expo Go and in CI, where there is no `.env` and
 * no project to point at (DECISIONS.md §13). The flag is credentials-present,
 * deliberately, so nobody has to remember to flip anything: populate `.env` and
 * the app is talking to the real backend.
 *
 * What this is NOT is a silent failover. If the backend is configured and then
 * fails, calls throw ApiCallError and screens render their offline state —
 * they never quietly fall back to fabricated data, because a child seeing a
 * story that does not exist is worse than a child seeing an error.
 */
export const apiClient = isSupabaseConfigured ? supabaseApiClient : mockApiClient;

/** True when `apiClient` is talking to the real backend. */
export const isLiveBackend = isSupabaseConfigured;
