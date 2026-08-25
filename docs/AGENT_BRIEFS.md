# Phase B agent briefs

Common to all five: read `DECISIONS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`.

**`packages/shared/src/**` is FROZEN for Phase B.** If you need a contract
change, stop and escalate — do not edit it. The only exception is B1
regenerating `db.ts` via `pnpm db:types`.

**Verify constants before you use them.** Read the live `DECISIONS.md`; do not
trust a number quoted in a prompt. Page counts are 6/10/12, the cost ceiling is
385 cents, annual is EUR 79.99. If `constants.ts` disagrees with `DECISIONS.md`,
report it rather than picking one.

---

## B1 — schema

**Owns:** `supabase/migrations/**`, `supabase/config.toml`, `supabase/seed.sql`,
and `packages/shared/src/db.ts` (only via `pnpm db:types`).

**Must not touch:** everything else in `packages/shared`, `apps/**`,
`services/**`, `supabase/functions/**`.

**Code against:** `domain.ts` is your specification. Every interface is a table;
every field a column; branded ids are `uuid`; `IsoDateTime` is `timestamptz`.
Every enum in `enums.ts` becomes a Postgres enum with exactly those values.

**Deliver**
1. Tables for all 15 MVP entities plus `worlds`, `world_facts`, `places`
   (declared, unused, RLS on).
2. `story_characters` as a real join table with a composite PK. **Do not add a
   `character_id` column to `stories` "for convenience."**
3. RLS on every table in the same migration as its creation. Coverage per
   `docs/ARCHITECTURE.md`.
4. Four private storage buckets + path-prefix policies.
5. pgmq queues: `papercub_generation`, `papercub_generation_dlq`.
6. `security definer` functions for writes clients must not make directly:
   `claim_story_quota`, `refund_story_quota`, `record_cost`,
   `apply_revenuecat_event`, `merge_accounts`.
7. Soft-delete + purge jobs per `RETENTION_DAYS`.

**Red lines:** no `birth_date` / `date_of_birth` / `dob` / integer `age` column,
anywhere, ever. No table without RLS. No `is_saved` / `is_claimed` column on
stories — see DECISIONS.md §12a.

---

## B2 — api

**Owns:** `supabase/functions/**`.

**Must not touch:** `packages/shared/**`, `supabase/migrations/**`, `apps/**`,
`services/**`.

**Code against:** the `endpoints` registry in `contract.ts`. Implement exactly
those functions with exactly those schemas. `ApiResponse` envelope on every
response; status from `HTTP_STATUS_FOR_ERROR`.

**The thing that matters most:** the quota gate in `stories`. Five checks, in
the order given in `docs/ARCHITECTURE.md`, inside one transaction with the
insert. The cost ceiling is checked against
`cost_cents_accrued + cost_cents_reserved + estimate` — **not** against story
count. Checking only accrued lets concurrent enqueues each pass.

**Red lines:** never construct a service-role client. Never `select *` on
`story_pages` (leaks `scene_description`). Never trust a client-supplied
entitlement, price, cost or quota number. `revenuecat-webhook` verifies
`REVENUECAT_WEBHOOK_SECRET` before parsing anything.

---

## B3 — mobile-ui

**Owns:** `apps/mobile/app/**`,
`apps/mobile/src/{features,components,theme}/**`, `apps/mobile/assets/**`.

**Must not touch:** `apps/mobile/src/lib/supabase.ts`, `src/lib/auth*` (B5),
`packages/**`, `services/**`, `supabase/**`.

**Code against:** `tokens.ts` for every visual value, `contract.ts` DTOs for
data, `constants.ts` for every number. **`STORY_SHAPE` is where page counts come
from — never the artboard text.**

**Deliver:** the screens in `design_v2/Papercub iOS MVP.dc.html` with every
listed state. Mock data behind an `apiClient` interface so the app runs in stock
Expo Go before B2 lands. Isolation goes through `@papercub/vision-module`;
handle `IsolationUnavailableError` as the manual-crop path.

**Red lines:** the word "AI" appears nowhere in onboarding, the paywall, or any
child screen. No percentage progress bars — render `GenerationStage` copy keys,
and never show a stage the server has not reported. Child tap targets 68pt,
parent 52pt. Only the reader type tokens scale with Dynamic Type. Never render
`ApiError.message` — render `copyKey`. Reading is never gated behind sign-in.

---

## B4 — vision-module

**Owns:** `packages/vision-module/**`, and the plugin entry in
`apps/mobile/app.config.ts` only.

**Code against:** `PapercubVision.types.ts` — already agreed, and B3 is coding
against it now. Implement it; do not redesign it. If a field is genuinely
unobtainable, escalate rather than returning a placeholder.

**Deliver**
1. `VNGenerateForegroundInstanceMaskRequest` subject lift -> PNG with alpha.
2. Rectangle detection for paper edges + perspective correction + white-balance
   normalisation (so a photo under a yellow lamp doesn't turn a green monster
   brown).
3. Adaptive-threshold **ink-extraction fallback**, chosen automatically for
   low-saturation high-frequency images — pale pencil on white paper is the
   documented failure mode of subject lifting.
4. Confidence score; below threshold routes to manual repair, never to a bad
   cut-out presented as success.
5. On-device face detection and OCR name-like-text detection.
6. EXIF/GPS strip before any file is written.
7. Config plugin: Vision framework, iOS 17 minimum.

**Red lines:** nothing leaves the device from this module. No network code, no
analytics, no logging of image content. Subject lifting behaves differently in
the Simulator than on device — flag anything you could only verify in Simulator.

---

## B5 — auth

**Owns:** `apps/mobile/src/lib/supabase.ts`, `src/lib/auth/**`,
`apps/mobile/app/(auth)/**`.

**Must not touch:** `packages/shared/**`, `supabase/**`, any screen outside
`(auth)`.

**Deliver**
1. Anonymous sign-in at first launch. No account and no sign-in screen before
   the first story — this is the highest-leverage conversion moment.
2. Sign in with Apple (mandatory under App Review 4.8, since we offer Google)
   and Google.
3. `linkIdentity()` upgrade, prompted at the paywall and at "Sign in to keep the
   library" — never at launch.
4. **The merge conflict flow as a first-class feature**, per the token sequence
   in `docs/ARCHITECTURE.md`. Default action is "Put them together".
   `keep_account_only` retains, never deletes.
5. Session persistence in `expo-secure-store`, auto-refresh, sign-out that does
   not destroy anonymous content.

**Red lines:** never store a token in AsyncStorage. Never call an Edge Function
with the anon key when a user JWT exists. Never treat sign-out as delete. The
client must never assert entitlement — after any auth change, re-fetch `session`
and take the server's `EntitlementSnapshot` as truth.
