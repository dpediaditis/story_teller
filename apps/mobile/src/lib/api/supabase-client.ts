/**
 * The real `ApiClient`, talking to B2's Edge Functions.
 *
 * `endpoints` in contract.ts disambiguates only by fn + method, and that
 * collides: `listCharacters`, `getCharacter` and `getTraitSuggestions` are all
 * GET on `characters`. Each Edge Function resolves the collision by URL
 * sub-path, documented at the top of its own `index.ts`. This table is the
 * client half of that convention — one row per endpoint name, so a route that
 * drifts from its function is a diff in one file rather than a 404 at runtime.
 *
 * Every call goes through `supabase.functions.invoke`, which attaches the
 * current session's JWT — anonymous sessions included. That is deliberate and
 * is the whole security model (docs/ARCHITECTURE.md, "The service-role rule"):
 * the app is subject to exactly the same RLS as any other client, and there is
 * no path from here to a service-role key.
 */

import type {
  EndpointName,
  EndpointRequest,
  EndpointResponse,
  JobProgressEvent,
  JobStatusDto,
} from '@papercub/shared';
import { SLO, endpoints } from '@papercub/shared';
import { supabase } from '../supabase';
import { ApiCallError, type ApiClient } from './client';
import { invokeAuthFn } from '../auth/functions';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Route {
  /** Function path, possibly with a sub-route. `req` is the endpoint request. */
  path: (req: never) => string;
  method: HttpMethod;
  /** GET routes carry their arguments in the query string, not a body. */
  sendsBody: boolean;
}

const q = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const s = search.toString();
  return s.length > 0 ? `?${s}` : '';
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the table is keyed by
 * EndpointName and each row's `req` is that endpoint's own request type; the
 * generic call() below re-establishes the type at the boundary. Typing every
 * row individually adds noise without adding safety. */
const ROUTES: Record<EndpointName, Route> = {
  getSession: { path: () => 'session', method: 'GET', sendsBody: false },

  upsertChild: { path: () => 'children', method: 'POST', sendsBody: true },
  deleteChild: { path: () => 'children', method: 'DELETE', sendsBody: true },

  createUploadUrl: { path: () => 'uploads', method: 'POST', sendsBody: true },

  createCharacter: { path: () => 'characters', method: 'POST', sendsBody: true },
  listCharacters: {
    path: (r: any) => `characters${q({ childId: r?.childId })}`,
    method: 'GET',
    sendsBody: false,
  },
  getCharacter: { path: (r: any) => `characters/${r.id}`, method: 'GET', sendsBody: false },
  getTraitSuggestions: {
    path: (r: any) => `characters/${r.id}/trait-suggestions`,
    method: 'GET',
    sendsBody: false,
  },
  updateCharacter: { path: () => 'characters', method: 'PATCH', sendsBody: true },
  deleteCharacter: { path: () => 'characters', method: 'DELETE', sendsBody: true },

  createStory: { path: () => 'stories', method: 'POST', sendsBody: true },
  listStories: {
    path: (r: any) => `stories${q({ childId: r?.childId, favouritesOnly: r?.favouritesOnly })}`,
    method: 'GET',
    sendsBody: false,
  },
  getStory: { path: (r: any) => `stories/${r.id}`, method: 'GET', sendsBody: false },
  setStoryFavourite: { path: () => 'stories', method: 'PATCH', sendsBody: true },
  deleteStory: { path: () => 'stories', method: 'DELETE', sendsBody: true },
  regeneratePage: { path: () => 'stories/regenerate-page', method: 'POST', sendsBody: true },

  getJob: { path: (r: any) => `jobs${q({ id: r.id })}`, method: 'GET', sendsBody: false },

  signMedia: { path: () => 'media-sign', method: 'POST', sendsBody: true },

  // account-merge/index.ts: bare -> createMergeToken, /preview, /confirm.
  createMergeToken: { path: () => 'account-merge', method: 'POST', sendsBody: true },
  mergePreview: { path: () => 'account-merge/preview', method: 'POST', sendsBody: true },
  mergeAccounts: { path: () => 'account-merge/confirm', method: 'POST', sendsBody: true },
} as unknown as Record<EndpointName, Route>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * `getJob` returns a JobStatusDto; subscribers consume JobProgressEvent. The
 * two carry the same progress but the DTO has no `coverReady` or
 * `readablePageIndexes` — those exist only on the broadcast, which is exactly
 * why the broadcast is the primary path and this is the floor.
 *
 * Both are derived conservatively rather than guessed: a cover is ready once
 * the job is past the cover stage, and pages are reported by COUNT, so the
 * indexes are 1..pagesCompleted. The worker illustrates pages strictly in order
 * (services/worker/src/pipeline/story.ts — "IN ORDER" is load-bearing there),
 * so that reconstruction is exact rather than approximate.
 */
const STAGES_AFTER_COVER: readonly string[] = [
  'illustrating_pages',
  'moderating_images',
  'narrating',
  'assembling',
  'done',
];

function toProgressEvent(job: JobStatusDto): JobProgressEvent {
  return {
    jobId: job.id,
    storyId: job.storyId,
    status: job.status,
    stage: job.stage,
    stageCopyKey: job.stageCopyKey,
    pagesCompleted: job.pagesCompleted,
    pagesTotal: job.pagesTotal,
    coverReady: STAGES_AFTER_COVER.includes(job.stage),
    readablePageIndexes: Array.from({ length: job.pagesCompleted }, (_, i) => i + 1),
    errorCode: job.errorCode,
    emittedAt: new Date().toISOString(),
  };
}

export const supabaseApiClient: ApiClient = {
  async call<K extends EndpointName>(
    name: K,
    request: EndpointRequest<K>,
  ): Promise<EndpointResponse<K>> {
    const route = ROUTES[name];
    if (!route) {
      throw new ApiCallError({
        code: 'internal',
        message: `no route registered for endpoint ${String(name)}`,
        retryable: false,
      });
    }

    // The response is re-validated against the contract schema rather than
    // trusted off the wire — same discipline as the Edge Functions applying
    // Schema.parse to every request body.
    const schema = endpoints[name].response as never;

    return (await invokeAuthFn(
      (route.path as (r: unknown) => string)(request),
      schema,
      route.sendsBody ? (request ?? {}) : undefined,
      route.method as 'GET' | 'POST',
    )) as EndpointResponse<K>;
  },

  /**
   * Realtime first, polling as the guaranteed floor.
   *
   * The worker's progress broadcast is ADVISORY and explicitly allowed to drop
   * (services/worker/src/db.ts emitProgress bounds it to 2s and swallows
   * failures), so a client that only subscribed would sit on a spinner whenever
   * a broadcast was lost. docs/ARCHITECTURE.md specifies both: "Subscribes to
   * realtime `job:{jobId}`; polls GET jobs/:id every 2s as fallback."
   */
  subscribeJob(jobId: string, onEvent: (event: JobProgressEvent) => void): () => void {
    let stopped = false;

    const channel = supabase
      .channel(`job:${jobId}`)
      .on('broadcast', { event: 'progress' }, ({ payload }) => {
        if (!stopped) onEvent(payload as JobProgressEvent);
      })
      .subscribe();

    const poll = setInterval(() => {
      void (async () => {
        if (stopped) return;
        try {
          const { job } = await supabaseApiClient.call('getJob', { id: jobId });
          if (stopped) return;
          onEvent(toProgressEvent(job));
        } catch {
          // Deliberately swallowed: a failed poll is staler progress, not a
          // failed generation. The job row is the durable truth and the next
          // tick re-reads it. CLAUDE.md forbids swallowing that hides a real
          // failure — this hides nothing, because the terminal state arrives
          // on a later poll either way.
        }
      })();
    }, SLO.jobPollIntervalMs);

    return () => {
      stopped = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  },
};
