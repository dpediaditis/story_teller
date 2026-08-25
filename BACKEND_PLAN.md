# Papercub — Backend & App Build Plan

Stack: Expo (React Native) · Supabase (Postgres, Auth, Storage) · Node worker on Fly.io · RevenueCat · Gemini

---

## 0. Findings from the design file that change the plan

| # | Finding | Impact | Action needed |
|---|---|---|---|
| 1 | Paywall says **"3 free stories this month"** — a *recurring monthly* free allowance | At $0.55/story that is **$1.65/month per free user, forever**. 10,000 non-converting free users = **$16,500/month burn** with no path to recovery. My cost model assumed 1 free story *total*. | **Your call before we build the quota engine.** Recommend: 1 free character + 1 free short story, one-off, non-renewing. |
| 2 | **No sign-in screen exists** in the design | You now want Apple + Google auth. There is nowhere to put it. | Add one screen. Recommend it appears *after* the first free story (anonymous → linked), not at launch. |
| 3 | Copy reads "A STORY BY MIA" | Child name is rendered into story artwork/metadata | Fine, but child name must stay in our DB only and never reach an AI provider prompt. Enforce in the prompt builder. |
| 4 | Paid tier = 8 stories / 5 characters | Matches the plan. No change. | — |

---

## 1. Stack decisions

### 1.1 RevenueCat — yes, use it

**I could not find a RevenueCat MCP server in this session.** Available MCPs are Supabase, Stripe (×2), Context7, HuggingFace, Google Drive, Linear-like, and a few others. If you configured RevenueCat, it isn't loaded here — check your connector settings. It is **not a blocker**: RevenueCat's REST API + webhooks are straightforward and the MCP would only be a convenience.

RevenueCat is the right choice, and more clearly right than it was in the original plan:

- The original plan recommended raw StoreKit 2 partly because *"StoreKit 2 is materially simpler natively."* Moving to Expo **deletes that argument entirely** — you'd be wiring `expo-iap` plus JWS receipt verification, App Store Server Notifications V2, and a subscription state machine (grace period, billing retry, refund, upgrade, Family Sharing) by hand.
- Android is on the V2 roadmap. RevenueCat abstracts App Store + Play Store behind one entitlement API. That is its real value.
- First-class Expo support via `react-native-purchases`.
- Cost: free to $2.5k/month tracked revenue, then ~1% of tracked revenue. At 1,000 subscribers (~$6k/mo net) that's ~$60/month. Acceptable.

**Non-negotiable architectural rule:** RevenueCat is a *convenience layer, not an authorization source*.

```
RevenueCat webhook → our Edge Function → verify signature → write to our `subscriptions` table
Generation request → worker reads OUR table → decides
```

The client never tells the server it is subscribed. `react-native-purchases` in the app is for *presenting* the paywall and *triggering* purchase only.

### 1.2 Stripe — not for this

Apple requires IAP for digital subscriptions; Stripe would get you rejected. Keep the Stripe MCP for **V2 print fulfilment**, which is physical goods and legitimately outside IAP.

### 1.3 Auth

Supabase Auth, three providers:
- **Anonymous sign-in** at first launch — lets the free story happen with no account (matches the design's onboarding, which has no auth screen).
- **Sign in with Apple** — mandatory. App Review Guideline 4.8 requires it if you offer any other third-party login.
- **Google** — as requested.

Anonymous → permanent account via `linkIdentity()`, so the free story survives sign-up. Prompt for sign-in at the paywall, not before.

### 1.4 The Expo problem you need to know about

The original plan's strongest argument for native Swift was on-device drawing isolation via `VNGenerateForegroundInstanceMaskRequest` — it is the privacy story, it is free, and it makes the first 60 seconds fast. **No Expo module exposes it.**

Two options:

| | Approach | Verdict |
|---|---|---|
| A | Write an Expo native module (Swift) wrapping Vision + a config plugin | **Recommended.** ~200 lines of Swift, clean via `expo-modules-core`. Keeps isolation on-device, free, private. |
| B | Do isolation server-side | Rejected. Adds a network round-trip to the most latency-sensitive step, adds cost, uploads the raw photo (face/name exposure), and kills the privacy positioning. |

**Consequence you must accept:** once the native module lands, **Expo Go stops working**. You need `expo-dev-client` development builds via EAS.

**Prerequisite — this will block you:** installing a development build on your physical iPhone requires an **Apple Developer Program membership ($99/year)**. Get this started now; enrolment can take a few days.

**Sequencing that keeps you previewing throughout:**
1. Phase B builds the UI shell — **works in stock Expo Go today**, scan a QR and you're running.
2. When the native module lands, switch to `eas build --profile development` once, install the dev build, then `npx expo start --dev-client` gives you the same live-reload preview.

### 1.5 Where things run

| Concern | Home | Why |
|---|---|---|
| Postgres, Auth, Storage, RLS | **Supabase** | One vendor, RLS is the security backbone |
| CRUD, enqueue, job status, webhooks | **Supabase Edge Functions** (Deno) | Short, fast, close to the DB |
| **AI generation pipeline** | **Node worker on Fly.io** | 60–120s multi-stage jobs with per-stage retry and streaming partial results do **not** fit Edge Function timeouts |
| Job queue | **pgmq** (Supabase Queues) | Keeps Postgres as the single coordination point — no Redis |
| Object storage | **Supabase Storage** for MVP | S3-compatible, so swappable. Note: egress is pricier than R2 — revisit if bandwidth becomes a real line item |

### 1.6 Repo layout

```
papercub/
├── apps/mobile/              Expo app
├── packages/shared/          zod schemas, generated DB types, API contract
├── packages/vision-module/   Expo native module (Swift + TS)
├── services/worker/          generation worker → Fly.io
└── supabase/
    ├── migrations/
    └── functions/            Edge Functions
```

pnpm workspaces. No Turborepo yet.

---

## 2. Multi-agent workflow

### 2.1 Principles

- **Contract first.** Phase A produces the schema, shared types and API contract. Everything after codes *against* that. This is what stops five agents inventing five names for the same thing.
- **Opus where mistakes are expensive or the ground is unfamiliar.** Architecture, the native module, the generation pipeline, entitlement, and all review.
- **Sonnet for well-specified construction.** Screens from a finished design, CRUD against a fixed schema, migrations from a written data model.
- **Worktree isolation for anything parallel.** Agents editing the same files concurrently is the main way this goes wrong.
- **Every agent starts cold.** Briefs must be self-contained — file paths, contract location, conventions, and what *not* to touch.

### 2.2 Agent roster

| Phase | Agent | Type | Model | Task | Why this model |
|---|---|---|---|---|---|
| **A** | `architect` | `feature-dev:code-architect` | **Opus** | Monorepo scaffold, module boundaries, API contract, shared zod schemas, naming conventions, CLAUDE.md | Architecture decisions are expensive to reverse and every later agent inherits them |
| **B1** | `schema` | `general-purpose` | Sonnet | Migrations for the §7 data model, RLS policies, pgmq setup, generated TS types | Fully specified in the plan — transcription, not design |
| **B2** | `api` | `general-purpose` | Sonnet | Edge Functions: CRUD, enqueue, job status, signed URLs | Codes against a fixed contract |
| **B3** | `mobile-ui` | `general-purpose` | Sonnet | Expo app: navigation, all 25 screens from the design, token extraction, states | High volume, low ambiguity — the design is finished. **Biggest win from a cheap model.** |
| **B4** | `vision-module` | `claude` | **Opus** | Expo native module wrapping `VNGenerateForegroundInstanceMaskRequest`, config plugin, ink-extraction fallback, confidence scoring | Highest-risk, least-documented piece. Swift + Expo native modules + config plugins is exactly where a cheaper model burns hours |
| **B5** | `auth` | `general-purpose` | Sonnet | Supabase Auth: anonymous, Apple, Google, anonymous→linked upgrade, sign-in screen | Well-trodden path with good docs |
| **C1** | `pipeline` | `claude` | **Opus** | Generation worker: provider adapters, orchestration, cover-first streaming, retries, cost accounting per job | Hardest correctness surface; subtle bugs cost real money on every run |
| **C2** | `safety` | `general-purpose` | Sonnet | Four moderation gates, `moderation_events`, prompt-injection hardening on the name field | Mechanical once the pipeline exists — **but Opus reviews it in E1** |
| **D** | `payments` | `general-purpose` | Sonnet | RevenueCat SDK, paywall wiring, webhook → entitlement, quota engine | Well-documented — **but Opus reviews it in E1**, since entitlement bugs mean lost revenue or free access |
| **E1** | `reviewer` | `feature-dev:code-reviewer` | **Opus** | Correctness + security: RLS coverage, service-role key handling, quota bypass, injection | The review pass you specifically asked for. Never cheap out here |
| **E2** | `efficiency` | `claude` | **Opus** | N+1 queries, redundant AI calls, image sizing, caching, cost-per-story audit against the model | Directly protects unit economics |
| **E3** | `adversary` | `general-purpose` | **Opus** | Actively try to bypass quota and entitlement with a modified client | Adversarial thinking is where model strength shows most |
| **F** | `glue` | `general-purpose` | **Haiku** | Seed data, fixtures, env templates, README, test scaffolding | Genuinely mechanical |

### 2.3 Execution order

```
A  architect ──────────────────────────────── (blocks everything)
   │
B  ├── schema ────┐
   ├── api ───────┤  parallel, separate worktrees
   ├── mobile-ui ─┤  ← you can preview in Expo Go from here
   ├── vision ────┤
   └── auth ──────┘
   │
   ▼ integration pass (me, in main session)
   │
C  ├── pipeline ──┐  parallel
   └── safety ────┘
   │
D  payments
   │
E  ├── reviewer ──┐
   ├── efficiency ┤  parallel, read-only
   └── adversary ─┘
   │
   ▼ I triage findings, then fix passes
   │
F  glue
```

### 2.4 Honest limitations

- **Cold starts cost tokens.** Fourteen agents each re-deriving context is the expensive path. It is worth it here because the work genuinely parallelises, but it is not free.
- **Integration is on me, not the agents.** Phase B produces five worktrees that have never seen each other's code. Budget real time for the merge.
- **Sonnet on `mobile-ui` will need a second pass.** 25 screens is a lot of surface; expect the review phase to find inconsistencies.
- **I cannot verify the app runs on your phone.** I can build, typecheck, and test — you have to scan the QR.

---

## 3. Milestones

| M | Goal | Agents | Your checkpoint |
|---|---|---|---|
| **M1** | Scaffold + contract + schema live in Supabase | A, B1 | `list_tables` shows the schema |
| **M2** | **App runs on your phone in Expo Go**, screens navigable with mock data | B3 | You scan a QR and click through |
| **M3** | Auth working; anonymous → Apple/Google | B5 | You sign in on device |
| **M4** | Isolation works on-device; dev build required from here | B4 | You photograph a real drawing |
| **M5** | Full generation pipeline; a real story end to end | C1, C2, B2 | You read a generated story |
| **M6** | Paywall, entitlement, quotas enforced server-side | D | Sandbox purchase |
| **M7** | Review, hardening, fixes | E1–E3, F | Findings report |

Prerequisites to start: **Apple Developer Program enrolment** (blocks M4), Supabase project, RevenueCat account, Gemini API key.

---

## 4. Decisions I need from you

1. **Free tier — 3 stories/month recurring, or 1 story one-off?** (See §0.1. This changes the quota engine.)
2. **Confirm RevenueCat** given the MCP isn't visible here — I'll use the REST API + webhooks.
3. **Apple Developer Program** — enrolled already, or should I sequence around it?
4. **Approve the agent roster** or adjust the model tiering.
