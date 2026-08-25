// Shared ApiResponse<T> envelope helpers matching @papercub/shared's
// ApiResponse type. Every Edge Function returns through these — never throws
// to the Deno runtime (CLAUDE.md "Edge Functions: never throw to the
// runtime").

import type { ApiError, ApiErrorCode } from '@papercub/shared';
import { HTTP_STATUS_FOR_ERROR } from '@papercub/shared';
import { corsHeaders } from './cors.ts';

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

export interface FailOptions {
  message: string;
  copyKey?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  requestId?: string;
}

export function fail(code: ApiErrorCode, opts: FailOptions): Response {
  const error: ApiError = {
    code,
    message: opts.message,
    copyKey: opts.copyKey,
    retryable: opts.retryable ?? false,
    details: opts.details,
    requestId: opts.requestId,
  };
  return new Response(JSON.stringify({ ok: false, error }), {
    status: HTTP_STATUS_FOR_ERROR[code],
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

/**
 * Throwable ApiError. Handlers `throw new ApiFailure(...)`; the top-level
 * `withEnvelope` wrapper in each function's Deno.serve catches it and maps to
 * the wire envelope. Never let anything else escape uncaught.
 */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly opts: FailOptions;
  constructor(code: ApiErrorCode, opts: FailOptions) {
    super(opts.message);
    this.name = 'ApiFailure';
    this.code = code;
    this.opts = opts;
  }
}

/** Maps any thrown value to a well-formed error Response. Never rethrows. */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof ApiFailure) return fail(e.code, e.opts);
  // eslint-disable-next-line no-console
  console.error('unhandled edge function error', e);
  return fail('internal', {
    message: e instanceof Error ? e.message : 'unknown error',
    retryable: false,
  });
}

/** Wraps a handler so nothing ever throws to the Deno runtime. */
export function withEnvelope(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const preflight = handlePreflightIfNeeded(req);
    if (preflight) return preflight;
    try {
      return await handler(req);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

function handlePreflightIfNeeded(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return null;
}
