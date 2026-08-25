// Body parsing: Schema.parse(body) is mandatory before touching anything
// (CLAUDE.md "Validation"). This centralises "read JSON, tolerate empty body,
// validate against the named zod schema, map failure to validation_failed".

import type { z } from 'zod';
import { ApiFailure } from './respond.ts';

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFailure('validation_failed', {
      message: 'body is not valid JSON',
      copyKey: 'error.validation_failed',
    });
  }
}

/** Reads the request body and parses it with `schema`, or throws validation_failed. */
export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const json = await readJson(req);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiFailure('validation_failed', {
      message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      copyKey: 'error.validation_failed',
    });
  }
  return result.data;
}

/** Parses query-string params with `schema` (GET endpoints with a request shape). */
export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiFailure('validation_failed', {
      message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      copyKey: 'error.validation_failed',
    });
  }
  return result.data;
}
