# Prompt for the session with file access

Copy everything below the line.

---

I'm working on **Papercub** at `~/Desktop/Personal/Story_teller`, branch
`scaffold` (github.com/dpediaditis/story_teller). Read `STATUS.md`,
`DECISIONS.md` and `CLAUDE.md` first — they're current and authoritative.

The backend is proven: two complete stories generated live, 28.35c (short) and
43c (normal) measured against 45c/64c estimates. Three tasks, in order.

## 1. Fix `character_build` — it fails 100% of the time

`character_build` has **never once succeeded**. Every attempt dies at
`analysing_drawing` with `invalid_structured_output`, so the vision pass has
never produced a reference set and the $0.16 character cost is still arithmetic.

This is the first thing a real user does: photograph a drawing, wait, get
nothing.

The Gemini vision response fails `DrawingAnalysis` validation on two counts:

```
validation: "regex"  path: ["dominantColours", 0]   (also 1 and 2)
code: "too_big"      maximum: 3                     (suggestedTraits)
```

So Gemini returns colours that aren't `#rrggbb` (likely `purple`, `#7b4`, or
`7b4fc4`) and more `suggestedTraits` than the cap allows.

**Fix it in `services/worker/src/providers/gemini.ts`, not in the contract.**
Normalise before `DrawingAnalysis.parse(...)`: map CSS colour names to hex,
expand 3-digit hex, strip alpha from 8-digit, drop anything unparseable, and
slice the arrays to their caps.

The point: **`palette` is decorative and `suggestedTraits` are proposals a
parent approves.** Failing an entire character build over a colour string is
disproportionate. Keep the strict shape in the contract; absorb the provider
quirk in the adapter, which is where PLAN.html §8 says it belongs.

(I tried this blind and my regex anchor on `DrawingAnalysis.parse(` missed —
please read the file rather than pattern-matching.)

Then re-run one `character_build` and record the measured cost.

## 2. Wire the app to the live backend, so the Simulator shows a real story

Right now the app runs entirely on `mockApiClient`, and B5's real `useSession()`
coexists unused — `DECISIONS.md` §13 tracks this deliberately. The mock has done
its job; the backend is proven and it should go.

- Swap `apps/mobile/src/features/session/SessionProvider` to delegate to
  `src/lib/auth/session.tsx`'s `useSession()`
- Point `apiClient` at the real Edge Functions, keeping the mock behind a flag
  so the app still runs with no `.env`
- Delete the mock session path

Then: `cd apps/mobile && pnpm start`, press `i`, and drive
photograph → character → story → read against the live backend.

Note `expo-image` will need signed URLs from `media-sign` for the generated
illustrations — storage buckets are private and keys are never public.

## 3. Check the character-slot accounting

`usage_records.characters_used` was 0 after a failed build, but I seeded the
character directly rather than through the `characters` Edge Function, so I
never exercised the increment. Verify: does the Edge Function increment
`characters_used`, and does a **failed** build give the slot back? On the free
tier that's one character total — a failed build silently consuming a user's
only slot would be bad.

## Environment gotchas that have each cost hours

- **Kill stale workers before every run:** `pkill -f "tsx src/index.ts"`.
  `tsx` loads source once at launch, so a stale worker is a frozen snapshot of
  old code racing for the same queue. Fourteen of them once made three rounds of
  instrumentation appear to produce nothing.
- `SUPABASE_DB_URL` must be the **session pooler** (`<region>.pooler.supabase.com:5432`).
  Direct (`db.<ref>.supabase.co:5432`) is IPv6-only and unreachable from Docker;
  the transaction pooler (`:6543`) can't do DDL and hangs.
- `status`/`stage` are Postgres enums — every query needs `::text` or it errors
  silently to stderr and prints nothing.
- Node block-buffers `console.error` when stderr is redirected; SIGTERM before a
  flush loses it. Use `fs.appendFileSync` for tracing.
- `psql` does not interpolate `:'var'` inside `DO $$ ... $$`.
- `timeout` doesn't exist on macOS.

## Where the economics landed

Measured: short 28.35c, normal 43c, fast-tier marginal 3.66c/page, bedtime
extrapolates to ~50c. Worst legitimate month $2.96 against the $3.74 modelled.
Annual-at-30% margin moves from 5% to **25%**. €7.99 / €79.99 with 5 stories is
sound — do not reprice until the first Gemini invoice confirms the unit prices
(`DECISIONS.md` §14 item 1: quantities are measured, unit prices are not).
