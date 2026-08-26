# Prompt for a fresh session

Copy everything below the line.

---

I'm building **Papercub**, an iOS app where a child's paper drawing becomes a
persistent character in AI-generated illustrated storybooks. The repo is at
`~/Desktop/Personal/Story_teller`, branch `scaffold`, pushed to
https://github.com/dpediaditis/story_teller

Read these first, in order — they are authoritative and current:
- `DECISIONS.md` — locked pricing, quotas, privacy rules, and §14–17 which
  record what the first live runs found. **§17 is your task.**
- `STATUS.md` — what is green, what is not
- `CLAUDE.md` — conventions, including three non-negotiable rules
- `docs/ARCHITECTURE.md` — the request flow for story generation

## The one task

**The generation pipeline stalls at `moderating_input`.** A job is picked up,
the stage is written, and then nothing happens for ~100s until it fails with
`provider_timeout` ("This operation was aborted") — having made no provider call
at all. Cost per story has therefore never been measured, and the entire
pricing model in §11 is still arithmetic.

Read what executes between the runner setting `stage = 'moderating_input'`
(`services/worker/src/runner.ts`) and `gateInputImage` making its first call
(`services/worker/src/moderation.ts`, `pipeline/story.ts`). Something there
awaits a promise that never settles.

**Strong lead:** the identical bug was already found and fixed in
`db.ts emitProgress` — it created a Supabase Realtime channel it never
subscribed to, then awaited `removeChannel()`, a teardown that never resolves
for a channel that never connected. Look for a second use of that pattern.

## What is already verified working (do not re-test)

Against the real Supabase project and Gemini:
- 27 migrations, 18 tables, 18 with RLS
- Storage upload; queue read via the `public.queue_*` wrappers
- `claim_story_quota`: ownership, entitlement, derived page count and cost,
  reservation and enqueue, all atomic
- Gate 1 ran and wrote 17 `moderation_events` on the run that got furthest
- **The refund path, nine times across four error codes** — every failure
  returned `usage_records` to `used=0, accrued=0c, RESERVED=0c`

## How to reproduce

`.env` is populated (Supabase + Gemini). Docker must be running.

```bash
# seed one job and run the worker; see git history for the scripts I used
cd services/worker && npx tsx src/index.ts
```

A story is enqueued by calling `public.claim_story_quota(...)` as an
authenticated user. `DECISIONS.md` §17 has the detail.

## Environment gotchas that cost me hours — please don't rediscover them

- **Supabase has three connection strings and they are not interchangeable.**
  Direct (`db.<ref>.supabase.co:5432`) is **IPv6-only** and unreachable from
  Docker. The **session pooler** (`<region>.pooler.supabase.com:5432`) is IPv4
  and supports DDL. The transaction pooler (`:6543`) does **not** support
  migrations and will hang.
- `supabase db push` prompts for confirmation; piping it through `tail` hides
  the prompt and looks like a hang. It can also report "up to date" when the
  migration history says applied but no tables exist.
- **`status` and `stage` are Postgres enums.** `enum || text` has no implicit
  cast — every status query needs `::text` or it errors silently to stderr and
  prints nothing.
- `timeout` does not exist on macOS.
- **Node block-buffers `console.error` when stderr is redirected to a file.**
  SIGTERM before a flush loses everything — this made three rounds of my
  instrumentation invisible. Use `fs.appendFileSync` to a separate file, or
  let the process exit cleanly.
- `psql` does **not** interpolate `:'var'` inside a `DO $$ ... $$` block.
- Gemini's availability varies wildly per model: `gemini-3.7-flash` measured
  2/8 while `gemini-3.1-flash-lite` was 10/10 in the same minute. Availability
  is measured, not inferred from version numbers.

## Also open, lower priority (all in DECISIONS.md §15–17)

- `merge` leaves storage keys under the old uid prefix, so merged stories render
  with no images or narration. Should refuse rather than complete lossily.
- The usage period is never renewed, so a subscriber eventually falls back to
  the free row and becomes permanently ceiling-locked.
- The worker logs raw binary (image/audio bytes reach the log stream) — a
  privacy problem against §10.
- Vision module has compiled but never run on a real device.
