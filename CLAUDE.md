# Papercub — conventions

Read `docs/ARCHITECTURE.md` before writing code. `DECISIONS.md` overrides
`PLAN.html` and the design file wherever they disagree.

## The three rules that are not negotiable

1. **`SUPABASE_SERVICE_ROLE_KEY` exists only in `services/worker`.** Not in
   `apps/mobile`, not in `supabase/functions`, not in a test fixture. ESLint
   fails the build if the string appears anywhere else.
2. **A child's display name never reaches an AI provider.** It is typed
   `ChildDisplayName` and no prompt input type has a field it fits into. If you
   find yourself widening a prompt type, stop.
3. **No birth date.** `AgeBand` only — in the schema, the contract, the client,
   and any analytics event.

## Import style

- Cross-package: `import { StoryTheme } from '@papercub/shared'` — always the
  package root, never a deep path.
- Within a package: relative, at most one `../`. Deeper means the file is in the
  wrong place.
- `import type` for types. Enforced by `consistent-type-imports`.

## Naming

| Thing | Convention | Example |
|---|---|---|
| DB tables, columns | `snake_case`, plural tables | `story_pages.scene_description` |
| Enum values (wire + DB) | `lower_snake_case` | `illustrating_cover` |
| TS types / interfaces | `PascalCase` | `StoryDetailDto` |
| TS values, functions | `camelCase` | `createStoryRequest` |
| Files | `kebab-case.ts` | `prompt-builder.ts` |
| React components | `PascalCase.tsx` | `CharacterCard.tsx` |
| Edge Functions | `kebab-case` dir | `supabase/functions/media-sign/` |
| Zod schema | same name as its type | `export const StoryDetailDto = z.object(...)` |
| Constants | `SCREAMING_SNAKE` | `MONTHLY_COST_CEILING_CENTS` |

Suffixes: `…Request` / `…Response` for HTTP, `…Dto` for wire entities,
`…JobPayload` for queue messages, bare entity name for domain types.

## Error handling

- Edge Functions: never throw to the runtime. Catch, map to an `ApiErrorCode`,
  return the `ApiResponse` envelope. Status from `HTTP_STATUS_FOR_ERROR`.
- **Never put a user-facing sentence in `ApiError.message`.** Send a `copyKey`;
  the app owns all copy. This is both a localisation requirement and a tone one
  — the design forbids the word "AI" on child screens, so the server must not
  leak it.
- Worker: every stage failure sets `generation_jobs.error_code` from
  `JobErrorCode` and, if that code is in `REFUNDABLE_JOB_ERRORS`, refunds the
  story quota exactly once, guarded by `quota_refunded`.
- Client: no `try/catch` that swallows. An unhandled network failure renders the
  offline state, never a spinner forever.

## Validation

Every Edge Function parses its body with the schema named in `endpoints` before
touching anything. **RLS is the backstop, not the gate** — a handler that relies
on RLS to reject a malformed body is a review failure.

## File organisation

- `apps/mobile/app/**` — expo-router routes ONLY. No logic, no fetching.
- `apps/mobile/src/features/<feature>/` — screens, hooks, local state.
- `apps/mobile/src/lib/` — supabase client, api client, storage, notifications.
- `apps/mobile/src/theme/` — a thin adapter over `tokens` from
  `@papercub/shared`. Do not re-declare a colour.
- `services/worker/src/pipeline/` — orchestration. `providers/` — adapters.
  A provider adapter must not know what a Story is.
- One Edge Function per resource, sub-routing inside. Shared code in
  `supabase/functions/_shared/`.

## Adding a migration

```
supabase migration new <verb_noun>
# edit supabase/migrations/<ts>_<name>.sql
supabase db reset      # verify from scratch, every time
pnpm db:types          # regenerates packages/shared/src/db.ts
```

Migrations are append-only and never edited after being pushed. Every new table
gets `enable row level security` **in the same migration as its `create table`**
— an RLS-less table must never exist, even transiently. Every table with user
data gets an owner column reachable from `auth.uid()` in one join or fewer.

## Adding an Edge Function

1. Add the entry to `endpoints` in `packages/shared/src/contract.ts` first.
2. `supabase functions new <name>`.
3. Body order: CORS preflight -> auth -> `Schema.parse(body)` -> work -> envelope.
4. Use the caller's JWT client so RLS applies. Never instantiate a service-role
   client here.

## Testing

- `packages/shared` — vitest. Test the schemas, not the types: every enum's
  value set, `asUntrustedText` against the injection corpus, quota arithmetic.
- `services/worker` — vitest with fake provider adapters. **Cost accounting and
  refund logic must have tests.**
- Edge Functions — one integration test per function against `supabase start`.
- `apps/mobile` — no snapshot tests. Test hooks and the api client only.
- Rule: if a bug costs money or leaks data, it gets a regression test. Otherwise
  do not write one.

## Style

Prettier decides formatting. British spelling in user copy and comments
("colour", "favourite") since the product is EU-first — but `color` in any
CSS/RN style property name.
