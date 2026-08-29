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
| 5 | ~~Illustration dimensions hardcoded (1024×1280 cover, 1024×768 page)~~ | **CLOSED §17.** Gemini returns JPEG at 928×1152 / 1200×896. `providers/image-meta.ts` reads format and size off the header — no decoder dependency needed. |
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

### Still open (not fixed, ranked) — ALL CLOSED 26 Aug 2026

**Every finding below is now fixed.** 10 in §18d; 5, 6, 7, 8 and 11 in §19.
The table is kept as written because the reasoning in the right-hand column is
what makes each fix make sense, and a closed finding with no record of why it
mattered is how the same bug comes back.


| # | Finding | Why it matters |
|---|---|---|
| 7 | **`merge` leaves storage keys under the old uid prefix**, so bucket policies and `media-sign` refuse them. Merged stories render with no pictures and no narration after the user was promised "nothing was lost". | Violates §7. Until re-keying exists, `merge` should be refused rather than silently completing lossily. |
| 6 | The usage period is **never renewed**. `apply_revenuecat_event` only inserts when no open row exists, so a renewal while the row is still open leaves `period_end` stale. One second later the subscriber falls back to the free never-ending row, whose `cost_cents_accrued` never resets — permanently ceiling-locked. | A paying customer silently stops being able to generate. |
| 5 | `enqueue_revenuecat_event` is granted to `anon, authenticated`, and the reconciler's `confirmsTopup()` only checks a top-up was **ever** purchased, not that this transaction was ungranted. One €4.99 purchase replayed = unlimited top-ups. | Needs per-transaction-id grant tracking. |
| 8 | Global daily spend cap sums rows client-side; PostgREST caps at 1000 rows silently, so past 1000 jobs/day the halt **stops existing**. | Needs a `sum()` RPC. |
| 10 | At-least-once delivery with no "already finished" guard: a crash between settle and `queue.delete` regenerates every image and releases the reservation twice. | Needs `finished_at` short-circuit. |
| 11 | `createCharacter` discards the client's idempotency key. A retried request creates duplicate characters and burns both budget and a character slot. | One-line fix. |

Findings 5–8 and 10–11 had to be closed before any real money or real
generation ran. They are. The "not reachable while the app is on mocks"
reassurance expired the moment the app moved to the live backend (§18e), which
is why they were closed immediately afterwards.

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

## 17. Live run — RESOLVED. Cost per story is measured.

Two complete stories generated end to end against the real Supabase project and
Gemini on 26 Aug 2026. Both reached `status = 'ready'`: 6 pages, 7 illustrations,
narration, all four moderation gates, reservation released to zero.

**Measured cost of a short story: 28.3c and 28.4c.** Against a 45c estimate.

### The stall was three separate things, only one of which was in the pipeline

1. **`emitProgress` awaited a Realtime teardown that never resolved** — the
   channel was created but never subscribed, so `removeChannel()` never settled.
   Fixed in 6492289 and it did work; the fix was simply never observed running.
2. **Fourteen stale worker processes were draining the same queue**, the oldest
   four hours old, each `tsx` holding a frozen snapshot of the source from its
   own start time. Every "run" after that point was a race between up to
   fourteen different vintages of the code. This is the literal explanation for
   "instrumentation produced no output, which suggests the patched code paths
   are not the ones executing" — they were not. **Kill every worker before
   re-running.** `pkill -f "tsx src/index.ts"`.
3. **`provider_timeout` at exactly 121s was real, not a phantom.** That is
   `DEFAULT_TIMEOUT_MS = 120_000` in `gemini.ts` aborting a genuinely hung
   multimodal call — gate 1 sends the cut-out to the text model, and that was
   the class of call §16 recorded as degraded. Nothing in our code was waiting
   on an unsettleable promise; Google was simply not answering. The stage was
   right and the error code was right.

### Bugs found and fixed by getting to the end

4. **The narration voice id was passed straight through to the provider.**
   `pipeline/story.ts` sends `voiceId: 'papercub_default'` — our stable domain
   id, stored on `narrations.voice_id` and rendered in the reader. Gemini
   answered `400 Voice name papercub_default is not supported`, which surfaced
   as a bare `internal` **after the entire book had been written, illustrated
   and paid for**. Each adapter now maps our id to its own catalogue
   (`sulafat` on Gemini, `shimmer` on OpenAI) and throws on an unmapped id
   rather than substituting a voice silently.
5. **Narration was uploaded as `audio/mpeg` while holding WAV bytes.** The
   synthesiser already reported its own `mimeType`; the pipeline ignored it.
6. **Every illustration was stored as `.png` / `image/png` at a hardcoded
   1024x1280 or 1024x768.** Gemini returns **JPEG at 928x1152 (cover) and
   1200x896 (page)**, so the object contradicted its own content type and every
   `page_illustrations` row carried dimensions the file did not have — and the
   reader lays out from those columns. `providers/image-meta.ts` now reads
   format and size off the header. **This closes §14 item 5**: it needed a
   header read, not an image decoder dependency.

Items 4, 5 and 6 are all one mistake — asserting what a provider returned
instead of reading it. It is the same mistake as writing PCM into a `.mp3`
(§16). Assume nothing about provider output that the bytes can be asked.

### Measured economics

Breakdown of the 28.4c, from the billed quantities the provider itself reported:

| Component | Model | Measured |
|---|---|---|
| Cover, premium tier | `gemini-3.1-flash-image` | 6.70c |
| 6 interior pages, fast tier | `gemini-3.1-flash-lite-image` | 20.16c |
| Story text + all four gates + TTS | — | ~1.51c |
| **Total** | | **28.37c** |

**Images are 95% of a story.** Everything else — the story itself, seventeen
moderation calls, a 72-second narration — is a cent and a half.

Projecting the other lengths from the measured per-page marginal (3.36c image +
~0.19c moderation/narration share), and applying §2's 15% retry overhead so the
comparison is like for like:

| Length | Modelled (§2) | Measured / projected, +15% |
|---|---|---|
| Short (6pp) | $0.45 | **$0.33** (measured) |
| Normal (10pp) | $0.64 | $0.49 (projected) |
| Bedtime (12pp) | $0.74 | $0.57 (projected) |

Worst legitimate month (5 bedtime + amortised character): **~$2.90**, against
$3.74 modelled and the $3.85 ceiling. Revised margins:

| Plan | Modelled @15% | Measured @15% | Measured @30% |
|---|---|---|---|
| Monthly EUR 7.99 | $2.02 (35%) | **$2.86 (50%)** | $1.84 (39%) |
| Annual EUR 79.99 | $1.07 (22%) | **$1.91 (40%)** | $1.05 (27%) |

The annual-at-30% case, which was the thin one at 5%, is now 27%.

**§5's headroom decision is therefore live.** Measured cost is ~26% below model
across the board, which is the same order as the ~30% the Fidelity Ladder was
expected to unlock. Page counts could return to the designer's 8/12/16 at the
same price. Do not act on it yet — see the caveats.

### What is still NOT measured — do not treat the table above as final

- **The price table is still researched, not invoiced** (§14 item 1). The
  *quantities* are now real: billed image counts and token counts read off
  Gemini's own responses. The *unit prices* they are multiplied by have still
  never been checked against a bill. Reconcile against the first real Gemini
  invoice before repricing anything.
- **`character_build` has never run.** Both stories used pre-seeded characters,
  so the $0.16 character cost is untouched arithmetic.
- **Normal and Bedtime are projections**, not measurements. Only `short` has
  been run — the free tier is short-only and that is what the quota allowed.
- **Neither run retried.** The 15% retry overhead remains an assumption, and
  §16's 503 storms say the real figure is bursty rather than a flat 15%.

### New open item: storage per story is about double the model

A short story stores **5.2 MB of illustrations + 3.5 MB of narration = 8.7 MB**.
The narration is uncompressed 24kHz/16-bit WAV, which is the format gemini.ts
chose deliberately to avoid an ffmpeg dependency. A bedtime story's narration
would be ~7 MB, and the bucket file size limit is 12 MB — it fits, but with
little room, and per-user storage is roughly twice what was assumed. Encoding to
AAC needs ffmpeg in the worker image.

## 18. character_build, the character slot, and the app on the live backend

Worked 26 Aug 2026, after §17 closed. Three things were asked for; a fourth was
found in the middle of them and mattered more than two of the three.

### 18a. `character_build` had never once succeeded

Every attempt died at `analysing_drawing` with `invalid_structured_output` — so
the very first thing a real user does, photograph a drawing and wait, produced
nothing, every time.

The vision model answers honestly and off-schema. Measured live against
`gemini-3.1-flash-lite` on a real cut-out:

```
dominantColours: ["purple", "white", "dark grey"]   <- DrawingAnalysis wants #rrggbb
suggestedTraits: [4 items]                          <- cap is 3
subjectGuess:    59 characters                      <- cap is 60
```

The first two were the reported failures. **The third is the one that mattered
more**: 59 against a cap of 60 is a coin flip, so fixing only the reported two
would have moved the failure somewhere else and made it look like a new bug.

Fixed in the adapter, not the contract (PLAN.html §8), in
`services/worker/src/providers/drawing-analysis.ts`: CSS colour names and
`rgb()` to hex, 3- and 4-digit hex expanded, alpha stripped, unparseable colours
dropped, arrays sliced to their caps, text clamped on a word boundary. The
strict shape stays in the contract. What is absorbed is only ever DECORATIVE
(`palette` tints a card) or a PROPOSAL (`suggestedTraits` need a parent's
explicit approval) — failing a whole character build over the string "dark grey"
is disproportionate to what the field is for.

The prompt now also asks for hex and for the caps. That is prevention and it
works — the first successful build returned real hex codes — but it is not
relied on. The normaliser is the guarantee.

**Not absorbed: `distinguishingFeatures`.** It becomes `feature_anchor`, which
every later illustration prompt for that character is conditioned on. The
contract caps the array but sets no minimum, so an empty one parses cleanly and
would produce a character that drifts page to page — the one thing the product
promises it will not do. `runCharacterBuild` now rejects an empty feature anchor
itself. `invalid_structured_output` is refundable, so that fails safe.

**Measured: 6.86c**, in 16.8s, against a 16c estimate. The reference sheet is
faithful to the drawing. 29 regression tests, fixture taken verbatim from the
live response.

### 18b. `createCharacter` could not reach the worker AT ALL

Found while answering 18c. `generation_jobs` is SELECT-only for `authenticated`
by design, and B1 supplied a security-definer claim function for
`story_generate` and nothing else. `_shared/jobs.ts` documented this and raised
a typed error; the catch block then deleted the character and the drawing.

So `character_build` was broken twice over, independently: the Edge Function
could not enqueue one, and the worker could not have completed one if it had.
The 18a measurement was only possible by inserting the job by hand.

Closed by migration `20260826200000_claim_character_build.sql`, mirroring
`claim_story_quota`'s discipline — ownership, limits, ceiling, reservation with
`cost_reserved = true`, job insert and `pgmq.send`, all in one transaction. It
is deliberately NARROWER than the story one: the drawing and character rows stay
under the caller's own JWT where RLS applies to them, and only what RLS must
forbid a client to do happens with elevated rights.

The cut-out storage key is resolved from the character id inside the function
rather than taken from the caller — a caller-supplied key would let one account
point a build at another account's drawing.

### 18c. The character slot: nothing incremented it, and a failure kept it

Both halves of the question, answered against the live database.

**Does the Edge Function increment `characters_used`?** No — and nothing else
does either. `usage_records.characters_used` is a dead column. `charactersUsed`
has always been DERIVED, by counting the caller's non-archived `characters`
rows (`_shared/quota.ts`). That is a good property: a derived count cannot drift
the way a counter incremented in one place and decremented in another can. The
column is now commented in the schema as dead so nobody starts writing it and
creates two sources of truth.

**Does a failed build give the slot back?** It did not. The row stayed at status
`building`, still counted, forever. On the free tier — one character, ever —
a user whose first build failed could never make another, with nothing
delivered. There was nothing to refund because nothing had been incremented.

Fixed by excluding `failed` from the count and having the worker mark the
character `failed` on any terminal failure. No second counter, no refund path,
nothing that can double-release. Verified live: with one `ready` character a
second claim is refused `character_quota_exhausted`; mark the first `failed` and
the claim succeeds.

The mark happens AFTER the refund and the reservation release, deliberately. A
missed slot costs the user a slot until the row is archived; a missed refund
costs real money and cannot be reconstructed.

### 18d. At-least-once delivery is not theoretical — it fired, and it double-paid

§15 finding 10 assumed a crash between settle and `queue.delete`. The real
trigger is far more ordinary: **any job slower than the visibility timeout**.

Observed live on a character_build whose image call was slow. `read_ct` went
1 -> 2, the stage went BACKWARDS from `building_character_refs` to
`analysing_drawing`, and every provider call in it was made and paid for twice.
The visibility timeout was 180s. A normal story measures 154s. There was
essentially no margin, and a bedtime story has none at all.

Two changes: `QUEUE_VISIBILITY_TIMEOUT_SECONDS` default 180 -> 900, and the
consumer now discards a redelivered message whose job already has `finished_at`.
The second closes redelivery-after-completion; only the timeout margin closes
the concurrent case.

**What held, under genuine concurrent double-processing: the exactly-once
reservation release.** `cost_cents_reserved` came back to 0, not -16. The
`cost_reserved` guard from §15 finding 4 did exactly what it was written to do,
against a race nobody had managed to reproduce before.

### 18e. The app now talks to the live backend (§13 resolved)

- `src/lib/api/supabase-client.ts` implements `ApiClient` against the Edge
  Functions. `endpoints` disambiguates only by fn+method, which collides for
  GET, so each function sub-routes by URL path — the client half of that
  convention is one explicit route table, so drift is a diff in one file rather
  than a 404 at runtime. Responses are re-validated against the contract schema.
- `apiClient` is live when Supabase credentials are present, mock otherwise.
  The flag is credentials-present rather than a manual switch, so populating
  `.env` is all it takes. It is NOT a failover: a configured-but-failing backend
  throws and screens render offline, never fabricated data.
- `features/session/SessionProvider` is now a thin re-export of B5's real
  `useSession()`. The mock session path is gone. `AuthProvider` MUST stay
  outside it — the `session` function returns 401 before an anonymous JWT
  exists.
- **The reader and cover screens were pointing at `picsum.photos`**, seeded with
  the storage key. Placeholder art from the mock era — and it put a private
  storage key in a request to a third-party host. Both now go through
  `useSignedMedia`, one batched `media-sign` call per screen.

### Where the economics stand

| | Modelled (§2) | Measured |
|---|---|---|
| Short (6pp) | $0.45 | **$0.283** |
| Normal (10pp) | $0.64 | **$0.43** |
| Bedtime (12pp) | $0.74 | ~$0.50 extrapolated |
| Character (one-off) | $0.16 | **$0.0686** |

**Free tier total lifetime exposure: 35.2c** (one short story + one character),
against the $0.61 modelled in §2.

Still not invoiced (§14 item 1). The quantities are measured; the unit prices
they multiply are researched. Do not reprice until a real Gemini bill confirms
them.

### Still open, found here

- **§15 finding 11 is NOT closed.** `CreateCharacterRequest` has no
  `idempotencyKey` field — unlike `CreateStoryRequest` — so there is nothing for
  `createCharacter` to honour but a fresh uuid, and a retried request still
  mints a second character and burns a second slot. Closing it is a contract
  change plus a client change.
- The claim of a character slot is atomic with the job insert, but not with the
  character row insert that precedes it. The existing catch block deletes both
  on failure, so the window is small and self-cleaning, but it is not zero.

### 18f. Two live-project blockers, found by trying to drive the app

The app builds, boots and renders against the live build. It cannot yet do
anything authenticated, for two reasons that are both configuration:

1. **Anonymous sign-ins are disabled on the project.**
   `422 anonymous_provider_disabled`. §12 makes anonymous the first-launch path
   and §7 makes it the base of the whole auth model, so this is not optional.
   One dashboard toggle.
2. **None of the eleven Edge Functions were deployed** — every one 404'd. They
   pass `deno check`, but the project had only ever been exercised through
   `psql` and the worker, so nothing had needed them. **Now deployed and
   answering**, with the correct envelope and `copyKey` on the error path.

   The deploy does not work with the documented command. `supabase functions
   deploy` fails to resolve `@papercub/shared`, because the import map points
   outside `supabase/functions`; passing `--import-map supabase/functions/deno.json`
   fixes it, even though the CLI announces that the flag is no longer supported.
   Recorded in STATUS.md — it is not discoverable from the error message.

Only the anonymous toggle remains, and it is the user's to make: enabling an
auth provider is a project security setting, not a deploy.

Worth recording because both were invisible from the code: the migrations, the
worker and the queue all work against this project, so "the backend is proven"
was true of everything except the layer the app actually talks to.

## 19. The rest of the security review, closed

§15's five remaining findings, fixed and verified against the live database on
26 Aug 2026. Migration `20260826210000_close_security_findings.sql`.

All five share a shape: **the guard existed and did not bind.** None was a
missing check; each was a check that was subtly the wrong check.

### 5 — one EUR 4.99 top-up, replayed, minted unlimited stories

The reconciler already defended against forged events by re-fetching subscriber
state from RevenueCat with the secret key. That defence is complete for
SUBSCRIPTIONS, which are a snapshot: applying the same state twice is
idempotent. It does nothing for TOP-UPS, which are an increment.
`confirmsTopup()` asked whether a top-up had **ever** been purchased — and "has
ever bought one" is not a fact you can safely add three stories to.

Now keyed on the store's own transaction id, in a `topup_grants` table whose
PRIMARY KEY is the transaction id. The grant is `insert … on conflict do
nothing` and the stories follow from how many rows were actually inserted, so a
replay grants zero **no matter what the reconciler gets wrong**. Verified: three
replays of one transaction id granted 3 stories and wrote 1 row, not 9.

### 6 — a paying customer silently stopped being able to generate

`apply_revenuecat_event` inserted a usage period only when none was open, and
never touched `period_end`. RevenueCat sends RENEWAL *while the period is still
open*, so the renewal was a no-op and `period_end` kept the previous cycle's
date. The moment it passed there was no open paid row, the subscriber fell back
to the free row — which never resets, because the free tier never renews — and
quietly stopped being able to make anything while still paying.

A renewal is now detected by `renews_at` advancing past the current period's
end: that closes the period and opens a fresh one with counters at zero.
Crucially, an event that does NOT advance `renews_at` changes nothing —
RevenueCat sends several per cycle, and resetting on each would hand out
unlimited stories. Both halves verified.

### 7 — merge completed lossily, having promised nothing was lost

The DB side was right: `merge_accounts` moves `child_profiles.parent_id` and
everything hangs off that. The storage side was not — keys keep the `<uidA>/`
prefix, and both the bucket policies and `media-sign` match on it. Every merged
story rendered with no pictures and no narration, straight after the "nothing
was lost" screen.

Re-keying genuinely cannot be done from the Edge Function: it needs read on A's
objects and write on B's, and by the time `mergeAccounts` runs only session B's
JWT exists. Only the worker's service-role client can bridge it. So until that
exists, **`merge` is refused** when it would move real content, with copy that
points at `keep_account_only` — which loses nothing, since §12a retains uid A's
content for 30 days either way. `keep_account_only` and an empty source are
unaffected.

Refusing is the right trade because the lossy outcome is silent and
unrecoverable by the user, while the refusal is visible and leaves both
libraries intact.

### 8 — the global daily spend cap stopped existing past 1000 jobs a day

`globalSpendTodayCents` selected the day's job rows and summed them in
TypeScript. PostgREST caps a response at 1000 rows and says nothing about it, so
from the 1001st job the total was "the first 1000 jobs" — an undercount that
only grows, on precisely the busy day DECISIONS.md §3.3's last backstop exists
for. The cap was strongest when it was needed least. Summed in the database now,
where there is no row limit.

### 11 — a retried create minted a second character

Not "the key was discarded" as §15 recorded it: `CreateCharacterRequest` had no
`idempotencyKey` field at all, unlike `CreateStoryRequest`, so there was nothing
to discard. Added to the contract, generated once per create-flow attempt and
stable for its whole life, cleared by `reset()` so the next character is a new
intent. On the free tier the slot it was burning is the only one the family
ever gets.

### The camera permission prompt was a dead end

Not a security finding, but the same class of not-actually-binding guard. iOS
shows the system camera dialog **once, ever**. After a decline,
`requestPermission()` resolves immediately with `granted: false` and no dialog
appears — so "Allow camera" did nothing, forever, with nothing on screen saying
why or what to do instead. The only route back is the Settings app and the user
was never told.

Now branches on `canAskAgain`: prompt when it can, otherwise open Settings, plus
a way out of the screen. The rule it violated is a general one — **never render
a button that cannot do anything.**

Also fixed alongside: `capture()` pushed to `isolation-preview` whether or not
`takePictureAsync` returned a photo, so a failed shutter landed the user on a
preview of nothing.

## 20. A whole story, made by tapping the app

29 Aug 2026. Not seeded, not curl'd — driven through the real UI on the iOS
simulator against the live project, from a photo to a narrated picture book.

```
pick a photo -> strip metadata -> isolate -> upload to Storage
   -> createCharacter -> claim_character_build -> worker -> "Pixel" ready (6.87c)
   -> Make a story -> space / adventurous / short
   -> claim_story_quota -> worker -> "Pixel and the Lost Star"
   -> 6 pages, 7 illustrations, 43s narration -> ready in 100.7s (28c)
   -> opened in the reader, illustration and audio both playing
```

**Free-tier lifetime exposure, measured end to end: 35c.** §2 modelled 61c.

### Two bugs the run found, both in the joins between screens

**The confirm screen had no character name.** Starting a story from an existing
character (Characters -> Pixel -> Make a story) skips the create-flow screens
that populate the draft, so `draft.characterName` was empty and the headline
rendered " goes to Space — a short adventurous story." with a gap where the name
belongs. Fixed by carrying the name in the route param.

The first attempt at that fix seeded the draft from `CharacterDetailScreen`
instead, which crashed the screen: it lives under `tabs`, OUTSIDE
`CreateFlowProvider`, so `useCreateFlow()` throws. Worth recording because the
provider boundary is invisible from the component — the create-flow draft is
reachable from `/create/*` only, and anything on a tab has to pass data by
route.

**Onboarding's "Skip this" left the account with no child** — covered in §19's
camera section, but this run is what made it matter: every downstream call takes
a `child_id`, so skipping produced a button that did nothing, forever, with no
message.

### The pattern in every UI bug found since going live

All of them were the same shape: **a failure with nothing on screen.** A silent
`return`, a bare `.then()`, a `finally` that navigated anyway, a button that
could not act. None was a wrong calculation; each was a missing way for the user
to find out. The mock could not surface any of them because the mock cannot
fail.

## 21. Narration voices, and a 402 that was consuming free stories

### The voices

One voice existed: `papercub_default` -> Gemini `sulafat`. Six now, in
`packages/shared/src/voices.ts`, with a tier on each:

| Voice | Reads like | Tier |
|---|---|---|
| **Ivy** | Warm and steady | **free** |
| Bramble | Gentle, for winding down | family |
| Pip | Bright and playful | family |
| Juniper | Soft and hushed | family |
| Marlow | Smooth, an old-fashioned storyteller | family |
| Fig | Quick and funny | family |

Exactly ONE free voice, deliberately: the free tier is a single short story
(§1), so a picker on it would be choice without consequence, and the premium
voices are worth more as something a family unlocks than as something they
sampled once.

The ids are ours, never a provider's — a narration is cached forever, so the id
on `narrations.voice_id` has to outlive any vendor. The adapters map them
(`GEMINI_VOICE_IDS`, `OPENAI_VOICE_IDS`); `packages/shared` still does not know
a provider exists.

**Enforced in SQL, not TypeScript.** `claim_story_quota` refuses a family voice
on a free tier the same way it already refuses a bedtime length, so the picker's
padlock is decoration and the gate is unbypassable (§8: the client never asserts
entitlement). Refused, not silently downgraded — a book read in a voice the
parent did not choose is worse than a clear no.

The reader also stopped printing `Voice · papercub_default`: an internal id on a
screen a child looks at, and against CLAUDE.md's rule that the app owns all copy.

### The bug found underneath it

`supabase/functions/stories` read `result.allowed` from `claim_story_quota`.
That function has ALWAYS returned `ok` — every branch, in every migration. So
`!result.allowed` was `true` on the SUCCESS path too, and **every story creation
returned `402 quota_exceeded`**.

What makes it bad rather than merely broken: the claim is atomic and had already
consumed the story, reserved the cost, written the story row and sent the pgmq
message before returning. So the book generated perfectly, in the background,
while the parent was told they had no stories left — losing their one free story
to a screen saying they had none. Live signature: `story quota blocked:
undefined`, a block with nothing that blocked it.

This is also a correction to §20. That story WAS triggered by tapping the app,
and it did generate — but the app would have shown a quota error at that moment.
It was not noticed because the run was verified in the database rather than on
the screen. **Check the screen, not just the row.**

### And a regression I introduced and caught within minutes

Adding the voice gate meant rebuilding `claim_story_quota`, and the body was
rebuilt from 20260826120000 — which predates the free-story bypass fix in
20260826130000. It silently reverted it. `coalesce(topup_stories_remaining, 0)`
INSIDE the select looks like a guard and is not one: when no row exists at all,
`select ... into` sets the variables to NULL regardless, and `true and NULL` is
NULL, so the quota check never fires. A free account at its limit claimed two
more stories before it was caught.

Two things came out of that:

- `claim_story_quota` now has exactly ONE definition in the repo, in
  `20260829152616`, with a header saying to start from THAT body. The 8-argument
  overload is dropped, so there is no second body to resolve to either.
- The lesson generalises: when rebuilding a security-definer function, start
  from the LATEST definition — or better, from `pg_get_functiondef` on the live
  database — not from whichever migration reads most completely.

## 22. The generating screen shows the book being made

~100 seconds is a long time for a five-year-old, and the screen was a text
checklist. It is now a paper workshop: their OWN cut-out sits on a kraft desk
while the book is assembled beside it — a sheet slides in and ink fills it, the
cover flips up, and a page flutters onto a growing stack.

The constraint that shaped it is the existing one from enums.ts: "Never invent
progress." So nothing in the scene is on a timer pretending to be work.

```
the sheet appears   when the job reaches `writing_story`
the cover flips up  when `coverReady` arrives — the real gate-4 pass
a page lands        once per index in `readablePageIndexes`, one for one
```

**The stack of pages IS the progress bar**, and it cannot show a page the server
has not finished — which is why there is still no percentage. The pile is the
honest version of one.

The character is the child's own drawing, the file the flow just uploaded, and
it hops each time a real page lands. Built on React Native's own `Animated`
rather than Reanimated: it is all transform and opacity, which `useNativeDriver`
already runs off the JS thread, and Reanimated 4 would need the worklets babel
plugin and a native rebuild to earn its keep. Motion is skipped entirely under
`prefers-reduced-motion` — the same elements appear, they just do not move.

The "start reading page 1 while page 5 renders" button stays exactly where it
was. It remains the strongest thing on the screen.

## 23. Seven languages, and the animation rebuilt

### Languages — free, and they change the STORY

Measured against the live API first: **one Gemini voice speaks every language.**
`vindemiatrix` returned valid audio for Spanish, German and French unchanged, so
the six voice characters are the cast in all seven locales — the catalogue does
not fork per language.

`locale` already reached the writer prompt, so choosing a language means the
story is *composed* in it, never an English story read in a French accent.

**Free on every tier**, deliberately. A family whose child speaks German should
not have to pay to use the product at all; a free story they cannot read is not
a free story, and they would never reach the paywall having seen any value.
Premium stays about the voice characters. `claim_story_quota` records the locale
and does not gate it.

en-GB · es-ES · de-DE · fr-FR · it-IT · el-GR · nl-NL

### The blocker underneath: the reading-level gate was English-only

`checkReadingLevel` is gate 3's second half and its verdict is REFUNDABLE. Two
faults made it dangerous outside English:

1. `syllableCount` stripped to `[a-z]`. "más" became "ms" and counted as one
   syllable; a Greek word was erased entirely and counted as one. Every accented
   language looked artificially SIMPLE — the opposite of the failure the gate
   guards against, and invisible because the number stayed plausible. Now NFD
   decomposition strips combining marks and keeps the base vowels, with a
   Unicode vowel set that includes Greek.
2. The "4+ syllables" ratio does not travel. German and Dutch compound as a
   matter of course; the English threshold is ordinary prose there, not dense
   prose. Left as-is, **every German story for a four-year-old would have failed
   and refunded** — the product silently impossible in that language.

So thresholds are per language (`languages.ts`), and where the long-word signal
is not calibrated it is **disabled rather than guessed**. A disabled check is an
honest gap; an invented number is a refund machine. Sentence length still
catches what the gate exists for.

Verified end to end in Greek: "Το Pixel και το Αστέρι που Χάθηκε", el-GR text,
el-GR narration by Bramble, 6 pages, 28c, gate 3 ran and passed.

### Voices got faces

A four-year-old will not read "Marlow — smooth, an old-fashioned storyteller",
and will not choose from a list of names. They will absolutely pick the green
one with the leaf. Each voice now has a paper-cutout creature — recognisable by
silhouette before it is readable — and **the selected one moves its mouth**,
which is the tell that this thing is going to talk to you. The mouth timing is
deliberately irregular: on a metronome it reads as a loading spinner.

They are Views with border radii, not illustrations: nothing to load, nothing to
fail to fetch, and they must not compete with the child's own drawing, which is
the only real character in a Papercub story.

### The generating animation, rebuilt

The first version did not read as anything, and the reason is worth keeping:
it put a manuscript, a cover and a stack of pages in three different places and
faded each in where it stood. Three islands. Every element was correct and the
whole had no flow — **because flow is direction, not motion.**

Rebuilt around one place to look and one direction of travel:

- the manuscript **becomes** the book — it crossfades into the pile from the
  same anchor rather than sitting beside it, so writing turns into the thing
  being written
- pages **fly in from the right**, arcing down and untwisting onto the pile, so
  every arrival travels the same path
- the desk is a thin shelf, not a slab: it had a third of the frame and was
  competing with the book

The honesty constraint is unchanged and is what makes it work: the manuscript on
`writing_story`, the cover on the real `coverReady`, one page per
`readablePageIndexes` entry. The pile IS the progress bar, so there is still no
percentage.

## §20 — What the app looked like on the device

A list of twelve things wrong with the running app, each reproduced in the
Simulator before the fix and re-checked there after it. Four were not visual at
all; they only presented that way.

### The three that were data or routing, not design

**Five of the eight stories in the account could not be opened.** The reader
showed "We couldn't open this story." for books that were complete, illustrated
and narrated on the server. `NarrationDto.language` is typed `StoryLocale`, the
column is plain `text`, and every narration written before the locale work
stored the bare subtag `'en'`. `StoryDetailDto` is parsed client-side, so the
enum rejected it and `getStory` threw. Backfilled and given a check constraint
in `20260829180000_narration_language_locale.sql` — the worker already writes
`job.locale`, and the constraint is what turns that habit into a guarantee.

The general lesson: a wire type that is stricter than its column is a bomb with
a delay on it. It does not fire when the row is written; it fires when somebody
reads it back, which may be weeks later and always on the client.

**Onboarding ran on every cold launch.** The "has this family onboarded" flag
was a module-level boolean in `app/index.tsx`, reset by every process start. A
returning family met the welcome screen and reported it as *"all the stories we
created before are gone"* — nothing was gone; the way back to them was behind
four screens. The launch gate now asks the account: a family that has onboarded
has a child profile, a fact that lives on the server and survives a reinstall.
When the session cannot be loaded at all the gate sends them to the tabs, not to
onboarding, because the library renders its own offline state and onboarding
would ask a returning family to set up an account they already have.

**`getCharacter` returned `cover: null` and `pageCount: 0` as literals.** The
same DTO built by the `stories` function carries both; this handler simply never
asked for them, so every story row on the character screen was an empty grey
rectangle.

### Narration that made no sound

The play button toggled a boolean and started a `setInterval`. The progress bar
moved, the timer counted up, and nothing was ever handed to an audio player —
`expo-audio` was already a dependency. `playsInSilentMode` is not an option
here: this product is used at bedtime on a phone that lives on silent, and
"I pressed play and heard nothing" is indistinguishable from broken.

### Emoji, three times, on purpose

The hand-built voice creatures were reported as *scary*, and they were: flat
geometry with two dots and a slot reads as uncanny, not friendly. The
alternatives were bundled sets — Twemoji (CC BY 4.0, redistribution plus an
attribution notice in the app) and OpenMoji (CC BY-SA 4.0, ShareAlike on a
commercial kids' product). System emoji has neither problem: rendering text in
the platform font is not redistribution, so there is nothing to bundle, nothing
to attribute, and no asset that can fail to load.

The same answer solved two more: children pick an animal instead of the first
letter of their name (a child who cannot read cannot find themselves in a list
of letters), and each story theme gets a picture instead of a coloured square
("Where should Pixel go?" answered with a navy rectangle is not a choice a
four-year-old can make).

The trade-off, stated: emoji render differently per platform, so this is not a
way to express brand. That is the right call here. The only character in a
Papercub story that should be distinctive is the child's own drawing, and the
app's furniture must not compete with it.

### Everything else was a flat colour block

Story tiles, character tiles and the character portrait all rendered their
identity as a beige or coloured rectangle with a label. They now show the cover,
the reference sheet, and the cut-out respectively. Two grids also stretched a
lone tile across the full row — `flex: 1` with `numColumns: 2` needs
`maxWidth: '48%'` — and two screens (the paywall, Family) had content below the
fold inside a plain `View` with no way to scroll to it.

## §21 — The narration reads the book

The reader was a picture, a paragraph and a play button. It is now driven by the
narration: the sentence being read carries a wash, the word being said carries a
mark, the page turns itself, and tapping any word plays from there.

### Timings we do not have

Gemini TTS returns audio and nothing else. `narrations.word_timings_key` is null
on every row and `sentence_level_only` is true, so there is no provider timing to
highlight against. The choice was to ship nothing, or to model it.

`packages/shared/src/narration-timing.ts` models it. The worker narrates the
whole story in one pass with the pages joined in order, so the audio is the pages
back to back; each word gets a weight in syllable equivalents plus a pause weight
for its trailing punctuation, and the weights are scaled so they sum to the one
hard number we do have — the duration measured off the PCM byte count, not
estimated. `estimated: true` is a field on the timeline rather than a comment,
because if a provider with real timings is ever adopted this module is what it
replaces.

Only the ratios between the weights matter, since the total is pinned. That is
also what makes the error tolerable: it cannot accumulate across a story, only
wander inside a sentence, and it is pulled back at every full stop. There is a
test for exactly that — twelve pages, and the last one still ends on the
measured duration.

The interface is built around the residual error. The SENTENCE takes the
marigold wash the design asks for and the WORD takes a stronger mark on top. A
word cursor half a beat out still sits inside the right sentence, which is the
band the eye is following, so being slightly wrong about the word is not felt as
being wrong.

### "Speak slower" is a playback rate, and here is why

The better fix would be a slower read at synthesis, with real pauses. Measured
against the live API on 59 characters of story that plainly synthesise to 6.05s:

| | |
|---|---|
| `"Read the following bedtime story aloud slowly…"` prefixed | **655s** |
| `"Say the following slowly and warmly…:"` prefixed | 10.85s |
| `speechConfig.speakingRate` | 400, no such field |

The first is not a typo — eleven minutes of audio for two sentences. The second
is 1.79x, about what you would expect if the instruction were simply read out as
well, and speech is billed per character of input, so a prefix is money spent
having an instruction read aloud to a child. `gemini-2.5-flash-preview-tts` does
not take delivery direction; it narrates it. The finding is written above
`synthesise` in `providers/gemini.ts` so nobody tries it a third time.

So the speed control in the reader is a real `playbackRate` with pitch
correction, defaulting to 0.85x. It cannot insert pauses, but it is honest, it
costs nothing, and it works on stories that already exist. `Speed` and
`Auto-turn` were both static labels describing settings that did not exist; they
are controls now.

### The heart nobody could fill

`setStoryFavourite` was in the contract, in the Edge Function and in the client's
route table, and no screen had ever called it. So no story could be favourited,
which made the library's ♥ filter permanently empty — and an empty filtered
library rendered the first-run empty state, which has no filter row, so tapping
the heart looked exactly like every story being deleted with no way back.

Two fixes, and the second is the general one: an empty library and an empty
filter are different states and must not share a screen. Any state reachable with
a filter applied has to keep rendering the filter, or the filter is a trap.

The heart itself now lives in the reader's top bar and on the end screen, which
is where a family actually decides they want to keep a story.
