export type { ApiClient } from './client';
export { ApiCallError } from './client';
export { generationStageCopy, errorCopy, GENERATION_STAGE_ORDER } from './copy';
export { mockApiClient, __mockSetEntitlement, __mockExhaustFreeQuota, __mockGrantTopup } from './mock-client';

import { mockApiClient } from './mock-client';

/**
 * The single apiClient instance every screen imports. Swapping the mock for a
 * real Supabase-backed client is a one-line change here once B2 ships the
 * Edge Functions — no screen imports mock-client.ts directly.
 */
export const apiClient = mockApiClient;
