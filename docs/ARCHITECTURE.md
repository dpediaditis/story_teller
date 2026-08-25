# Papercub architecture

## Package boundaries

| Package | Owns | May import | Must never contain |
|---|---|---|---|
| `packages/shared` | zod contract, domain types, enums, constants, design tokens, generated DB types | `zod` only | Any I/O. No fetch, no fs, no supabase client. It must load in Deno, Metro and Node unchanged. |
| `apps/mobile` | UI, navigation, on-device flow, RevenueCat presentation | `@papercub/shared`, `@papercub/vision-module` | Service-role key. Business rules about quota or entitlement. Any AI provider SDK. |
| `packages/vision-module` | Swift Vision wrapper + config plugin | `expo-modules-core`, `@papercub/shared` (types only) | Network calls. Nothing leaves the device from here. |
| `services/worker` | Generation pipeline, provider adapters, cost accounting | `@papercub/shared`, provider SDKs, service-role client | Any user-facing copy. Any internet-reachable HTTP endpoint. |
| `supabase/functions` | CRUD, enqueue, signed URLs, webhooks, quota gate | `@papercub/shared` via `npm:` | Service-role client. Long-running work (>10s). AI provider calls. |
| `supabase/migrations` | Schema, RLS, pgmq, triggers | — | Data. Seeds live in a separate script. |

Dependency direction is one-way: `shared` <- everything. Nothing imports
`mobile`, `worker` or `functions`.

## The service-role rule

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely. It lives in exactly one
place: the Fly.io secret store, read by `services/worker/src/config.ts`.

- Edge Functions run with the **caller's JWT** and are therefore subject to the
  same RLS as the client. This is deliberate: an Edge Function bug can then
  only be a broken feature, never a data breach.
- Two functions need to write rows the caller does not own — `revenuecat-webhook`
  and `account-merge`. They do it by calling a `security definer` Postgres
  function with a narrow, audited signature, not by holding the service key.
  B1 writes those functions; B2 calls them.
- ESLint blocks the literal `SERVICE_ROLE` outside `services/worker`.

## RLS security model

Every table with user data has a column reachable from `auth.uid()` in at most
one join. The pattern for B1:

```sql
alter table public.characters enable row level security;

create policy "characters_owner" on public.characters
  for all
  using      (child_id in (select id from public.child_profiles where parent_id = auth.uid()))
  with check (child_id in (select id from public.child_profiles where parent_id = auth.uid()));
```

Coverage requirements:

- `parent_accounts`: `id = auth.uid()`.
- `child_profiles`: `parent_id = auth.uid()`.
- `characters`, `original_drawings`, `stories`: via `child_profiles`.
- `character_assets`, `story_characters`, `story_pages`, `page_illustrations`,
  `narrations`: via their parent row. **Add a denormalised `parent_id` column to
  `story_pages` and `page_illustrations`** — the three-level join is the one
  place RLS becomes a measurable cost, and a trigger-maintained column is
  cheaper than a policy that scans.
- `generation_jobs`, `usage_records`, `subscriptions`, `moderation_events`:
  `parent_id = auth.uid()`, **SELECT only**. Clients never insert or update
  these. Writes come from `security definer` functions or the worker.
- `subscriptions`: a client that could UPDATE this row has free access.
- `worlds`, `world_facts`, `places` (v1.2, unused): RLS enabled from day one.
  An unused table with RLS off is how you fail a security review later.
- Storage: bucket policies match the `<uid>/` path prefix in `storage_key`. All
  four buckets private. Reads always via a signed URL from `media-sign`.

`story_pages.scene_description` is the internal image prompt and is never
returned to a client — `StoryPageDto` has no such field. B2 must select columns
explicitly, never `select *`.

## Request flow — story generation, end to end

```
[app]  POST functions/v1/stories  { childId, characters[], theme, mood, length,
                                    idempotencyKey }          <- user JWT

[edge] stories:
   1. parse CreateStoryRequest
   2. idempotency: existing job for this key? -> return it, do not re-enqueue
   3. global halt?                      -> 503 service_halted
   4. rate limit (anonymous only)       -> 429 rate_limited
   5. entitlement: length allowed?      -> 402 entitlement_required
   6. story quota / topup balance       -> 402 quota_exceeded + QuotaSnapshot
   7. MEASURED COST CEILING             -> 402 cost_ceiling_exceeded
        accrued + reserved + STORY_SHAPE[length].estimatedCostCents <= 385
   8. ONE transaction:
        insert stories (status='queued')
        insert story_characters   <- always a row per character, even when n=1
        insert generation_jobs    (status='queued', estimated_cost_cents)
        update usage_records      stories_used += 1,
                                  cost_cents_reserved += estimate
        pgmq.send('papercub_generation', StoryGenerateJobPayload)
   9. return { story, job, quota }

[app]  Subscribes to realtime `job:{jobId}`; polls GET jobs/:id every 2s as
       fallback. Renders GenerationStage -> copy key. Never a percentage.

[worker] pgmq.read (visibility timeout 180s), parse JobPayload:
   moderating_input     gate 1 — cut-out image moderation -> moderation_events
   validating_request   gate 2 — name/traits via asUntrustedText
   writing_story        TextGenerator -> GeneratedStory (structured output)
   moderating_text      gate 3 — per page + reading level vs age_band
                        -> insert story_pages, emit JobProgressEvent
   illustrating_cover   ImageGenerator PREMIUM tier -> pageIndex 0
                        -> emit { coverReady: true }   <- cover reveal fires
   illustrating_pages   ImageGenerator FAST tier, pages 1..n IN ORDER
                        -> after each: gate 4, insert illustration,
                           story.status='partial', emit readablePageIndexes
                        -> the child reads page 1 while page 5 renders
   narrating            SpeechSynthesizer once, cached forever
   assembling           story.status='ready', completed_at set
   done                 settle cost: accrued += MEASURED, reserved -= estimate
                        pgmq.delete

   Any terminal failure: error_code set; if in REFUNDABLE_JOB_ERRORS then
   stories_used -= 1 and quota_refunded = true, EXACTLY ONCE. Reserved cost is
   always released. 3 failed reads -> DLQ -> status 'dead_letter', alert.
```

Every provider call writes a measured cost row the moment it returns. The
ceiling is enforced on measured spend precisely because retries are the risk it
guards against.

## Cost & quota model

- **Estimate at enqueue** (reserved), **measure per provider call**, **settle at
  completion**. The ceiling check uses `accrued + reserved + estimate`. Checking
  only `accrued` would let concurrent enqueues each pass — which is exactly the
  runaway scenario the ceiling exists to stop.
- Free tier is one-off: `usage_records.period_end IS NULL` and there is no reset
  job. The client must not render a reset date for free users.
- Story count is the user-facing limit; the measured ceiling is the invisible
  backstop sitting above the worst legitimate month.
- The global daily cap surfaces as `service_halted`, not as a quota error — do
  not blame the user for our cap.

## Account merge flow

```
anon session A --createMergeToken--> short-lived signed token + local counts
       |
       +- linkIdentity(apple|google)
       |     +- success -> done, uid unchanged, nothing to merge
       +- identity_already_exists
             +- signInWithIdToken -> session B
             +- mergePreview{token}  -> both sides + result counts
             +- mergeAccounts{token, strategy}
                   'merge'             -> child_profiles.parent_id A->B,
                                          storage re-keyed, uid A retired
                   'keep_account_only' -> nothing moves; uid A's content is
                                          RETAINED 30 days, never deleted
```

The token is signed server-side and names uid A, so session B can prove a right
to A's data without either session holding the other's credentials.

## Deviations from the original PLAN.html §7 data model

1. **No `apple_user_id` on `parent_accounts`.** Supabase Auth already holds
   provider subjects in `auth.identities`; duplicating one into a
   client-readable table is a needless identifier leak. `linkedProviders` is
   derived at read time.
2. **`parent_accounts.id` IS `auth.users.id`.** No surrogate key — this is what
   makes every policy `= auth.uid()` rather than a join.
3. **`original_drawings` gains `cutout_storage_key`** alongside `storage_key`.
   The plan listed one key, but the cut-out and the original have different
   retention rules, so they cannot share a column.
4. **`story_pages` / `page_illustrations` carry a denormalised `parent_id`.**
   Purely an RLS performance measure.
5. **`stories.render_technique`.** The technique must be a per-story parameter
   so Milestone 0's Fidelity Ladder can choose without a migration.
6. **`generation_jobs` gains `parent_id`, `estimated_cost_cents`,
   `quota_refunded`, `pages_completed/total`, `idempotency_key`.** Required by
   the refund logic and by honest progress reporting.
7. **`subscriptions` gains `tier` and `topup_stories_remaining`.** The top-up
   SKU postdates the original model.
