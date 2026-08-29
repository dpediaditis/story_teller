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

/**
 * A query string carries only strings, but the contract's GET request schemas
 * are the same domain types used everywhere else — `favouritesOnly` is a
 * `z.boolean()`, `limit` a `z.number()`. Handing raw strings to those fails
 * every time: `favouritesOnly: Expected boolean, received string`.
 *
 * This never showed up while the app ran on `mockApiClient`, because the mock
 * passed JS values in memory and no query string ever existed. The FIRST live
 * GET with a non-string field broke, and every one of them would have.
 *
 * Coercion is driven by the SCHEMA, not by guessing at the value: a bare
 * `"123"` for a `z.string()` cursor must stay a string, and only a field whose
 * base type is boolean or number is converted. Optional/default/nullable
 * wrappers are unwrapped to find that base type.
 */
// deno-lint-ignore no-explicit-any -- zod's internal _def shape is not public.
function baseTypeName(schema: any): string | undefined {
  let node = schema;
  // Unwrap ZodOptional / ZodDefault / ZodNullable, which all hold `innerType`.
  for (let i = 0; i < 10 && node?._def?.innerType; i += 1) node = node._def.innerType;
  return node?._def?.typeName;
}

// deno-lint-ignore no-explicit-any
function coerceQueryValues(schema: any, raw: Record<string, string>): Record<string, unknown> {
  const shape = schema?._def?.typeName === 'ZodObject' ? schema.shape : null;
  if (!shape) return raw;

  const out: Record<string, unknown> = { ...raw };
  for (const [key, value] of Object.entries(raw)) {
    const field = shape[key];
    if (!field) continue;
    const typeName = baseTypeName(field);

    if (typeName === 'ZodBoolean') {
      if (value === 'true') out[key] = true;
      else if (value === 'false') out[key] = false;
      // Anything else is left alone so zod reports it, rather than being
      // silently coerced to `false` — a filter that quietly inverts is worse
      // than one that errors.
    } else if (typeName === 'ZodNumber') {
      const n = Number(value);
      if (value.trim() !== '' && Number.isFinite(n)) out[key] = n;
    } else if (value === '' && typeName !== 'ZodString') {
      // An empty param is an absent one for everything but a string.
      delete out[key];
    }
  }
  return out;
}

/** Parses query-string params with `schema` (GET endpoints with a request shape). */
export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const result = schema.safeParse(coerceQueryValues(schema, raw));
  if (!result.success) {
    throw new ApiFailure('validation_failed', {
      message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      copyKey: 'error.validation_failed',
    });
  }
  return result.data;
}
