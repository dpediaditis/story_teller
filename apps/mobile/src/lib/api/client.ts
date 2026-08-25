import type { EndpointName, EndpointRequest, EndpointResponse } from '@papercub/shared';

/**
 * Every network call in the app goes through this interface, typed against
 * `endpoints` in `packages/shared/src/contract.ts` — one method per registry
 * entry, so a change to the contract is a compile error here until the client
 * catches up. `apps/mobile/src/lib/api/mock-client.ts` is the only
 * implementation until B2's Edge Functions exist; swapping in a real
 * `supabase.functions.invoke` client later means adding a new file here, not
 * touching any screen.
 */
export interface ApiClient {
  call<K extends EndpointName>(
    name: K,
    request: EndpointRequest<K>,
  ): Promise<EndpointResponse<K>>;

  /**
   * Realtime job progress. The mock client polls its own in-memory job store
   * on SLO.jobPollIntervalMs; a real client would subscribe to the
   * `job:{jobId}` Realtime channel and fall back to polling `getJob`.
   */
  subscribeJob(
    jobId: string,
    onEvent: (event: import('@papercub/shared').JobProgressEvent) => void,
  ): () => void;
}

/**
 * Thrown by the mock client to model a failed endpoint call, carrying the
 * same `ApiError` shape a real Edge Function would return in its envelope.
 * Screens should catch this — never let a network failure fall through to an
 * unhandled promise rejection (CLAUDE.md "Client: no try/catch that swallows").
 */
export class ApiCallError extends Error {
  readonly apiError: import('@papercub/shared').ApiError;
  constructor(apiError: import('@papercub/shared').ApiError) {
    super(apiError.message);
    this.name = 'ApiCallError';
    this.apiError = apiError;
  }
}
