# Papercub — Locked Decisions

Authoritative for all build agents. Where this conflicts with `PLAN.html` or the design file, **this wins**.

---

## 1. Pricing & quota — FINAL

| SKU | Price | Contents |
|---|---|---|
| **Free** | — | 1 character · 1 **short** story · full quality · **one-off, never renews** |
| **Papercub Family — monthly** | **€7.99** | 5 stories/month · 5 characters · all lengths · narration · PDF export |
| **Papercub Family — annual** | **€79.99** | Same. 17% saving vs monthly. |
| **Top-up** | **€4.99** | +3 stories. Subscribers only. No expiry. |

Quota resets on the billing anniversary. **No rollover.**

## 2. Unit economics — the guarantee

Net revenue per subscriber-month, after ~22% EU VAT, Apple commission, and RevenueCat ~1% of gross:

| Plan | @ Apple 15% | @ Apple 30% |
|---|---|---|
| Monthly €7.99 | **$5.76** | $4.74 |
| Annual €79.99 | **$4.81** | $3.95 |

Cost per story (Pro-tier cover + Flash-Lite interior pages, incl. 15% retry overhead):

**Book lengths: Short 6 pages · Normal 10 · Bedtime 12.** Revised down from the design's
8/12/16 — see §11. One illustration per page, plus a cover.

| Length | Images | Cost |
|---|---|---|
| Short | 7 | $0.45 |
| Normal | 11 | $0.64 |
| Bedtime | 13 | $0.74 |
| Character (one-off) | — | $0.16 |

**Worst legitimate month** = 5 bedtime stories + amortised characters = **$3.74**.

| Plan | Worst-case margin @15% | @30% |
|---|---|---|
| Monthly | $2.02 (**35%**) | $0.99 (21%) |
| Annual | $1.07 (**22%**) | $0.21 (5%) |

**Positive in every case. This is the requirement being satisfied.**

Free user total lifetime exposure: **$0.61, once, ever.** (1 short story $0.45 + 1 character $0.16) Non-renewing, so it cannot accumulate.

## 3. Structural cost guarantees — implement all four

These are what make "never negative" *true* rather than *probable*. The quota engine must enforce every one.

1. **Per-account monthly cost ceiling: $3.85.** Enforced on *measured* `cost_cents` accrued in `usage_records`, not on story count. Checked before enqueueing any job. This is the backstop against runaway retries — it sits above the worst legitimate month ($3.74) so it never binds for an honest user.
2. **Story quota** (5/month) as the primary user-facing limit.
3. **Global daily spend cap** with alerting and automatic generation halt.
4. **Per-device + per-IP rate limiting** on anonymous free-story generation.

Free-tier farming is already mitigated by the design: an anonymous user can *generate* the free story but must sign in to *keep* it. An unsaved story is low-value to abuse.

## 4. Copy changes — APPLIED 25 Aug 2026

The design was built against earlier draft economics. All of the following are now applied:

| Screen | Current | Change to |
|---|---|---|
| Paywall — quota reached | "You've used all 3 free stories this month" | "You've used your free story" |
| Paywall — quota reached | "Remind me on the 1st" | **Remove on the free path** (no monthly reset). Keep it for paid users hitting quota. |
| Quota exhausted — in place | "Character 3 needs the full plan" | "Character 2 needs the full plan" |
| Paywall — after first story | "8 stories a month" | "5 stories a month" |
| Paywall — quota reached | "Resets Tuesday 1 September" | "Does not renew" |
| Generation failed | "You still have 3 of 3 free stories" | "Your free story is back in the bank." |
| Assumptions note | "8 pages Short, 12 Normal, 16 Bedtime" | "6 Short, 10 Normal, 12 Bedtime" |

All applied to `design_v2/Papercub iOS MVP.dc.html` and repackaged into the zip.
The Family usage screen's "5 left · resets 1 September" was left alone — paid quota *does* reset.

## 5. Quota headroom — deliberate

5 stories/month is conservative. If Milestone 0's Fidelity Ladder selects the paper-cutout composite technique (~30% cheaper), either the quota rises to 7-8 **or** page counts return to the designer's 8/12/16 — at the same price, on launch day. Not both.

**Raising a quota is always well received. Lowering one is a disaster.** Launch low, raise on measured cost.

Competitive note: My Mini Canvas advertises 60 stories at $9.99, but generates *one* watercolour illustration per story. We generate 7–13. Not comparable — position as "5 real picture books", never on story count.

## 6. Repricing triggers

- Apple commission moves to 30% (above $1M/yr proceeds) → re-run this table before it lands.
- Measured cost/story exceeds **$0.75** on a 7-day moving average → alert, investigate, consider tier downgrade.
- Any provider price change → re-run before accepting.

## 7. Auth — decided

- **Anonymous** at first launch. Free story requires no account.
- **Sign in with Apple** — mandatory (App Review 4.8, since we offer Google).
- **Google** — as requested.
- Anonymous → permanent via `linkIdentity()`. Prompt at the paywall, and at "Sign in to keep the library".
- **Account merge conflict is a first-class flow.** The design's "That account already has a library" state must be implemented: when an anonymous session with local content signs into an account that already has data, present a choice. Default: keep the existing account's library, offer to import the anonymous characters/stories. Never silently discard either side.

## 8. Payments

- **RevenueCat** via `react-native-purchases`.
- RevenueCat is **not** an authorization source. Flow: RevenueCat webhook → Edge Function → verify signature → write `subscriptions` table → worker reads *our* table.
- Client never asserts entitlement.
- Stripe is **not** used for subscriptions (Apple requires IAP). Reserved for V2 print fulfilment.

## 9. Apple Developer Program — not yet enrolled

Sequencing so this blocks as little as possible:

| Works without it | Blocked until enrolled |
|---|---|
| Phases A, B1, B2, B3, B5 | Real-device testing of the Vision module (B4) |
| Preview in **stock Expo Go** on a physical phone | RevenueCat sandbox testing (Phase D) |
| iOS Simulator dev builds (no provisioning needed) | TestFlight, App Store Connect |

**Action: enrol today.** Individual enrolment is usually 1–2 days but can take longer. It is not on the critical path for roughly three weeks of work.

Caveat: Vision subject-lifting is known to behave differently in the Simulator than on device, so B4 needs real-device validation before it can be signed off.

## 10. Child privacy — hard rules for the prompt builder

- Child display name (e.g. "Mia") is stored in our DB and rendered in *our* UI only. It must **never** appear in any prompt sent to an AI provider.
- Age band drives vocabulary and length. The band value may be sent; a birth date must never exist in the schema.
- Character name is user free text → treat as **data, never instruction**. Prompt construction must make it impossible for a name to alter system behaviour.
- Upload the isolated cut-out by default. The full photo only if the parent opts to keep the original.
- EXIF/GPS stripped on-device before any upload.

---

## 11. Page counts — revised down from the design

The design's assumptions note specified **8 pages Short / 12 Normal / 16 Bedtime**. My cost model
had assumed 5/8/10. At the design's counts a Bedtime book is 17 images and costs **$0.92**, making
the worst legitimate month **$4.69** — which is **negative** against the annual plan's $4.51 net.

Revised to **6 / 10 / 12**, giving $0.45 / $0.64 / $0.74 and a worst month of $3.74. A 12-page
bedtime picture book is still a real book. Annual also moves €74.99 → €79.99 to restore headroom.

If Milestone 0's Fidelity Ladder selects the cutout-composite technique (~30% cheaper), page counts
can go back up to the designer's original 8/12/16 at the same price.

## 12. Sign-in is NOT required for the free tier — CONFIRMED 25 Aug 2026

Anonymous generation stays. Sign-in is required to **keep** the library, exactly as designed
("Sign in to keep the library" / "Signed in — nothing was lost").

**Why not mandatory:** an account wall before the user has seen any value is the single most common
first-run conversion killer, and free→paid conversion is the metric the whole model rests on.
The abuse it would prevent is low-value — an abuser gets one *unsaved* short story worth $0.45 and
needs a fresh device identity for the next one. There is nothing to resell.

**What we give up by not making it mandatory:** the account-merge flow
("That account already has a library") is genuinely one of the buggiest things we will build.
That is a real cost and it is accepted deliberately.

**Compensating controls** — all three required:
1. Free grant bound to a **server-side device record**, so reinstalling does not reset it.
2. Device attestation (App Attest / Play Integrity) on the generation endpoint.
3. Per-device and per-IP rate limits on anonymous generation.

### 12a. "Generated but not kept" — resolved, no new state

Confirmed: keep the anonymous flow exactly as designed. There is **no separate
schema state** for an anonymous story that was generated but not saved.

Anonymous content is simply real content owned by an anonymous uid. "Sign in to
keep the library" is a UI nudge, not an enforcement point, and unsaved anonymous
content is protected by `RETENTION_DAYS.orphanedAnonymousContent` (30 days) like
any other orphaned uid.

**Consequence, accepted deliberately:** a user who never signs in keeps their
free story on that device indefinitely, and we carry the storage. Exposure is
bounded by the one-off free grant ($0.61) plus ~5 MB of storage per anonymous
user, so this is immaterial. B1 must NOT invent an `is_saved` / `is_claimed`
column, and B3 must NOT gate reading behind sign-in.

## 13. Mock vs real session — deliberate coexistence, resolve in Phase E

B5 built a real `useSession()` backed by the `session` Edge Function. B3's
screens still consume `src/features/session/SessionProvider`, which is backed by
`mockApiClient`. Both currently mount.

This is intentional for now, not an oversight:

- Without Supabase credentials in `.env`, the real client falls back to a
  placeholder URL and anonymous bootstrap fails (caught). The mock keeps the
  whole app explorable in Expo Go, which is how the product is being previewed.
- Cutting every screen over to the live hook before there is a Supabase project
  to point at would make the app unrunnable for the one person reviewing it.

**Resolution:** once a real Supabase project exists and `.env` is populated,
swap `SessionProvider` to delegate to B5's `useSession()` and delete the mock
session path. Everything else can keep using `mockApiClient` until the worker is
deployed. Tracked as a Phase E integration task.

Known follow-ups from B5:
- `react-native-url-polyfill` is not installed. RN 0.74/Hermes is generally fine
  for supabase-js v2, but this needs a real-device smoke test.
- Google sign-in reports `ProviderUnavailableError` until
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is provisioned.

## 14. Worker caveats that must be closed before any real generation

C1 built the pipeline against fake providers. These are unverified and two of
them feed the cost guarantee directly.

| # | Issue | Risk |
|---|---|---|
| 1 | **Provider price table is placeholder**, back-derived from §2 rather than read off real pricing pages | The measured cost ceiling is only as honest as this table. §6 already makes a price change a repricing trigger — confirm before launch. |
| 2 | **Gemini TTS returns PCM, not MP3.** The worker writes `.mp3` with an estimated `durationMs` | Narration will be malformed on first real run. Certain bug, not a maybe. |
| 3 | Gemini response shapes (`usageMetadata`, image `inlineData`) assumed | Unpriced calls throw rather than record zero, so this fails loudly — good — but it fails. |
| 4 | `pgmq` PostgREST exposure unverified (`pgmq_public` vs `pgmq`) | Worker may not be able to read the queue at all. |
| 5 | Illustration dimensions hardcoded (1024×1280 cover, 1024×768 page) | Needs an image decoder dependency to do properly. |
| 6 | `record_cost` takes only `(job, cents, final)` — per-call provider/model/token detail is logged, not stored | When cost/story drifts past the §6 alert there is no queryable breakdown. Needs a B1 table. |

**Do not treat the §2 cost model as validated until items 1–3 are closed against
real API responses.** The first real story generation is the moment those
numbers stop being estimates.

### The reservation-release invariant (do not "simplify" this)

`record_cost(p_final => true)` and `refund_story_quota` both decrement the SAME
`usage_records.cost_cents_reserved` by this job's estimate. Calling both does
not merely double-release this job — it frees a *concurrent* job's reservation,
and the per-account ceiling stops binding.

So: refundable failures settle with `final: false` and let the refund release.
Every other terminal path settles with `final: true`. `alreadyRefunded` releases
nothing. There are tests over all 15 `JobErrorCode` values asserting exactly one
release; if a change breaks them, the change is wrong.

## 15. Security review findings — status

E1 (Opus, read-only) reviewed the whole codebase for data leaks and unbounded
spend. 11 findings, 4 critical. Fixed and verified against a live database:

| # | Finding | Status |
|---|---|---|
| 3 | **Nothing ever called `pgmq.send`.** Quota was consumed, the story row written, and the job never reached the worker — so the worker-only refund path never fired either. A user's single lifetime free story was lost with nothing to show. | Fixed — the send is now inside `claim_story_quota`, in the same transaction as the claim |
| 2 | `claim_story_quota` took the cost estimate and story length as **caller-supplied arguments** while granted to `authenticated`. A direct RPC could pass `estimate 0` (ceiling never binds, every concurrent enqueue passes) or claim a bedtime book on a free grant. | Fixed — both derived server-side from `p_length`; entitlement checked in SQL |
| 1 | `refund_story_quota` refunded a **story** for a refundable failure of **any** job type. `page_regenerate` throws `regen_budget_exhausted` deterministically on a third regen, and that code is refundable — so asking for a third regen repeatedly minted stories, or top-ups at `stories_used = 0`. | Fixed — guarded on `type = 'story_generate'` |
| 4 | `record_cost(p_final)` released a reservation the job never took. `character_build` and `page_regenerate` write an estimate without reserving, so settling one freed a **concurrent story's** reservation and the ceiling stopped binding. | Fixed — `generation_jobs.cost_reserved` flag, released at most once |
| 9 | Clients could `UPDATE` any column of their own `parent_accounts` row, including `is_anonymous` — shedding the anonymous rate limit for free. | Fixed — trigger restricts client sessions to `locale` |

**A fifth bug was introduced by the fix and caught by testing it.** With no
`subscriptions` row, `SELECT ... INTO` sets `v_topup` to NULL rather than
leaving the declared default, so `stories_used >= limit AND NULL <= 0` evaluated
to NULL — the guard never fired and every free user could mint unlimited free
stories. Fixed in `20260826130000`. The SQL reads correctly; only an adversarial
test found it.

### Still open (not fixed, ranked)

| # | Finding | Why it matters |
|---|---|---|
| 7 | **`merge` leaves storage keys under the old uid prefix**, so bucket policies and `media-sign` refuse them. Merged stories render with no pictures and no narration after the user was promised "nothing was lost". | Violates §7. Until re-keying exists, `merge` should be refused rather than silently completing lossily. |
| 6 | The usage period is **never renewed**. `apply_revenuecat_event` only inserts when no open row exists, so a renewal while the row is still open leaves `period_end` stale. One second later the subscriber falls back to the free never-ending row, whose `cost_cents_accrued` never resets — permanently ceiling-locked. | A paying customer silently stops being able to generate. |
| 5 | `enqueue_revenuecat_event` is granted to `anon, authenticated`, and the reconciler's `confirmsTopup()` only checks a top-up was **ever** purchased, not that this transaction was ungranted. One €4.99 purchase replayed = unlimited top-ups. | Needs per-transaction-id grant tracking. |
| 8 | Global daily spend cap sums rows client-side; PostgREST caps at 1000 rows silently, so past 1000 jobs/day the halt **stops existing**. | Needs a `sum()` RPC. |
| 10 | At-least-once delivery with no "already finished" guard: a crash between settle and `queue.delete` regenerates every image and releases the reservation twice. | Needs `finished_at` short-circuit. |
| 11 | `createCharacter` discards the client's idempotency key. A retried request creates duplicate characters and burns both budget and a character slot. | One-line fix. |

Findings 5–8 and 10–11 should be closed before any real money or real
generation runs. None of them are reachable while the app is on mocks.

## 16. First live run — what it proved, and what it broke

Ran the full pipeline against the real Supabase project and Gemini on 26 Aug 2026.

### Verified working against live infrastructure

- 27 migrations applied; **18 tables, 18 with RLS** — full coverage confirmed on
  a real instance, not just local Docker.
- Storage upload, pgmq queues, all 9 security-definer functions.
- `claim_story_quota` end to end: ownership checks, entitlement (free tier is
  short-only), derived page count and cost, reservation, enqueue — all atomic.
- **The refund path, four separate times.** Every failed job returned
  `usage_records` to `used=0, accrued=0c, RESERVED=0c`. The exactly-once
  reservation release — the most expensive possible bug — holds in production.

### Bugs found that would each have hit first deploy

1. **Worker refused to boot on empty optional env vars.** `z.string().min(1).optional()`
   rejects `''`, and every `.env` writes an unset key as `KEY=`. Fixed with a
   preprocess that treats empty as absent.
2. **`gemini-2.5-flash-lite-image` does not exist.** The scaffold's model
   defaults were guesses. The real fast tier is `gemini-3.1-flash-lite-image`,
   which preserves the cheap-interior/premium-cover split the economics rely on.
   Text moved to `gemini-3.7-flash`.
3. **pgmq was unreachable over PostgREST.** Supabase exposes only `public` and
   `graphql_public`; the worker probed `pgmq_public` and `pgmq` and found
   neither. Fixed with `public.queue_*` wrappers (migration 20260826180000) so
   no dashboard configuration is needed. Worker prefers `public` now.
4. **Gemini TTS returns PCM, not MP3** — confirmed as
   `audio/L16;codec=pcm;rate=24000`. The worker wrote those bytes as `.mp3`.
   Now wrapped in a WAV header, with duration computed exactly from byte count
   rather than estimated from text length (which would desync the reader's
   sentence highlighting).
5. **Transient 503s failed whole stories.** Gemini returns
   `503 UNAVAILABLE — high demand` under load. These are now retried with
   jittered backoff (6 attempts, ~62s).

### Still not measured

**Cost per story.** Gemini's multimodal capacity was degraded throughout —
text-only calls succeeded while every image call returned 503 or timed out, so
no story completed. §11's economics remain arithmetic. Re-run `./go.sh` when
capacity recovers; that single number validates or breaks the pricing model.

### New open items

- A 503 maps to `errorCode: 'internal'`. It should be `provider_rate_limited` —
  same refund behaviour, but a Google capacity blip is currently
  indistinguishable from a bug in our own code in the failure metrics.
- **The worker logs raw binary** (image or audio bytes reach the log stream).
  In production that means bloated logs and potentially children's drawings
  written to log storage, which cuts against §10.
- The queue consumer talks to Postgres over PostgREST. A direct connection would
  remove the schema-exposure dependency, the per-poll HTTP round-trip, and allow
  LISTEN-based wakeups. Worth doing before deploy.

## 17. Live run — unresolved: the pipeline stalls at `moderating_input`

Eight attempts. Everything up to the first pipeline stage works against live
infrastructure; the job then sits at `moderating_input` for ~100s and fails with
`provider_timeout` ("This operation was aborted"), having made no provider call.

### Fixed along the way (all committed)

- `emitProgress` created a Realtime channel it never subscribed to, then awaited
  `removeChannel()` — a teardown that never resolves for a channel that never
  connected. Now bounded to 2s and non-fatal. **This one would have stalled
  every job in production**, and its symptom was a misleading `provider_timeout`.
- `PRICE_TABLE` held only `gemini-2.5-*` entries, so every 3.x model threw
  `UnknownModelPriceError` before any work. Added 11 entries. The guard behaved
  correctly — it refuses to record a zero rather than corrupt the ceiling.
- Transient 429/5xx now retried with jittered backoff (6 attempts, ~62s).
- Model ids corrected against what the key actually exposes.

### Still failing

After those fixes the stall persists, and instrumentation has not localised it:
`console.error` is block-buffered when stderr is redirected and was lost on
SIGTERM; a rewrite to `appendFileSync` also produced no output, which suggests
the patched code paths are not the ones executing.

**Next step is to read the code, not to test it.** Specifically: what runs
between `runner` setting `stage = 'moderating_input'` and `gateInputImage`
making its first call — and whether anything there awaits a promise that can
never settle (a second Realtime/channel use, a `for await`, or an unresolved
`await` on a Supabase client created with a stale connection).

### Measured cost per story remains UNKNOWN

§11's economics — €7.99, 5 stories, the $3.85 ceiling — are still arithmetic.

### What the run did prove

- 27 migrations, 18 tables, 18 with RLS, on a real instance.
- Storage upload; queue read via `public.queue_*` wrappers.
- `claim_story_quota` end to end: ownership, entitlement, derived cost,
  reservation, enqueue — atomic.
- Gate 1 ran and wrote 17 `moderation_events` on the one run that got furthest.
- **The refund path, nine times, across four distinct error codes.** Every
  failure returned `usage_records` to `used=0, accrued=0c, RESERVED=0c`.
