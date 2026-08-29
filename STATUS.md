# Papercub — status

Last updated 26 Aug 2026. Branch `scaffold`, pushed.

## Green

| | |
|---|---|
| 4 packages typecheck | shared · worker · vision-module · mobile |
| Tests | 116 (110 worker, 6 shared) |
| Metro bundle | 4.8 MB, clean |
| **Native iOS build** | `expo prebuild` + `pod install` + `xcodebuild` — exit 0, zero errors |
| Vision module Swift | compiles; `libPapercubVision.a` built for arm64 + x86_64 |
| Schema | 28 migrations, 18 tables, 18 with RLS, verified on the live instance |
| Edge Functions | 11, all pass `deno check` |
| Stack | Expo 57 · RN 0.86 · React 19 · Xcode 26 |

## Proven end to end

**Stories and characters both generate against live Supabase + Gemini**
(26 Aug 2026). Stories reach `status = 'ready'` with cover, pages, narration and
all four moderation gates; the reservation returns to zero every time.
`DECISIONS.md` §17 and §18 have the full account.

**Measured cost** — quantities read off the provider's own responses:

| | Modelled | Measured |
|---|---|---|
| Short (6pp) | $0.45 | **$0.283** |
| Normal (10pp) | $0.64 | **$0.43** |
| Bedtime (12pp) | $0.74 | ~$0.50 extrapolated |
| Character build | $0.16 | **$0.0686** |

Images are 95% of a story. Free-tier total lifetime exposure is **35.2c**
against the $0.61 modelled. The thin annual-at-30% margin moves from 5% to ~25%.
Do NOT reprice yet — see below.

Gemini TTS PCM and the model ids are both closed: TTS is wrapped in a WAV header
with an exact duration, and the model ids are verified against the live key.

**The app is on the live backend** (`DECISIONS.md` §13 resolved). `apiClient`
talks to the Edge Functions whenever Supabase credentials are present and falls
back to the mock only when there is no `.env`; the mock session path is deleted.
Reader and cover art now come from `media-sign` signed URLs instead of the
`picsum.photos` placeholders left over from the mock era.

**A pass over what the app actually looks like** (29 Aug 2026), driven by a
list of things that were wrong on the device. Every item below was reproduced
in the Simulator and re-checked there after the fix:

- **Narration made no sound.** The play button toggled a boolean and ran a
  `setInterval`; `expo-audio` was already a dependency and nothing was wired to
  it. Now a real `useAudioPlayer` on the signed narration URL, with
  `playsInSilentMode` — a bedtime story is played on a phone that lives on
  silent.
- **Five of eight stories could not be opened at all.** `narrations.language`
  is typed `StoryLocale` in the contract but the column is free text, and every
  narration written before `20260829160000_story_locale.sql` stored `'en'`.
  `StoryDetailDto` parses client-side, so `getStory` threw and the reader said
  "We couldn't open this story." for a complete, illustrated, narrated book.
  Backfilled and constrained in `20260829180000_narration_language_locale.sql`.
- **Onboarding ran on every cold launch**, because the "have they onboarded"
  flag was a module-level boolean. A returning family met the welcome screen
  and read it as "my stories are gone". `app/index.tsx` now routes on whether
  the account has a child profile.
- **`getCharacter` hardcoded `cover: null` and `pageCount: 0`**, so every story
  row on the character screen was an empty grey rectangle.
- Story and character tiles show their cover / reference sheet instead of a flat
  colour block; a lone tile no longer stretches the full row (`maxWidth: 48%`).
- The paywall and the Family screen scroll — both had content below the fold in
  a plain `View`.
- Voice characters are system emoji (`VoiceCreature.tsx` documents the licence
  comparison against Twemoji and OpenMoji). Same approach gives each child an
  avatar (`avatars.ts`) and each story theme a picture (`themes.ts`) instead of
  six coloured squares.
- The library has a "＋ New story" button; character-screen story rows and
  library tiles both navigate.

**The reader follows the narration** (30 Aug 2026). Word and sentence
highlighting, automatic page turns, swipe to turn, tap a word to play from
there, a real speed control at 0.85x, and the book navigates to The End when the
audio does. The timings are modelled from the text and the measured duration
(`packages/shared/src/narration-timing.ts`, 17 tests) because the synthesiser
returns none — `DECISIONS.md` §21 has the reasoning and the measurement that
ruled out asking the synthesiser to read slower.

`packages/shared` now runs its tests. It had a `test/` directory and no `test`
script, so `sql-constants-sync.test.ts` had never executed in CI or locally.

## Not proven

- `DECISIONS.md` §14 item 1: the price table is **researched, not invoiced**.
  The quantities multiplied by it are now measured; the unit prices are not.
  Reconcile against the first real Gemini bill before repricing anything.
- **Bedtime has never been generated.** Short and Normal are measured; Bedtime
  is extrapolated from the measured per-page marginal (3.66c/page fast tier).
- **Neither run retried.** §2's 15% retry overhead is still an assumption, and
  §16's 503 storms suggest the real figure is bursty rather than flat.
- **The app has not been driven end to end in the Simulator.** The wiring is
  written, the signed build works and the shell renders; the only thing left in
  the way is that anonymous sign-ins are disabled on the Supabase project. See
  "Running the app" below.
- Storage per short story is **8.7 MB** (5.2 MB images + 3.5 MB uncompressed WAV
  narration), roughly double the model. Fits the 12 MB bucket cap; AAC needs
  ffmpeg in the worker image.

**The Vision module has never run.** Compiling proves the Swift is valid. It
says nothing about whether subject-lifting isolates a real crayon drawing, or
whether the ink-extraction fallback rescues pale pencil — the case most likely
to embarrass the product, and the one the Simulator will not answer honestly.

Milestone 0 bar: >85% clean isolation on crayon/marker, >60% on pencil, across
20+ real children's drawings.

## Languages

Seven, all free on every tier (`DECISIONS.md` §23): English, Español, Deutsch,
Français, Italiano, Ελληνικά, Nederlands. Choosing one changes the STORY, not
just the narration — `locale` drives the writer prompt, the narration and the
reading-level thresholds. One Gemini voice speaks all of them, so the six voice
characters are the cast everywhere. Verified end to end in Greek.

**The reading-level gate is calibrated per language** and its long-word signal
is DISABLED for German, Dutch and Greek rather than guessed at — the verdict is
refundable, so a wrong threshold makes the product silently impossible in that
language.

## Narration voices

Six, one free (`DECISIONS.md` §21). **Ivy** is free; Bramble, Pip, Juniper,
Marlow and Fig are family. The picker is on the story-confirm screen; the gate
is in `claim_story_quota`, so the padlock is decoration and the SQL is the
enforcement. Verified live both ways: a free account is refused with
`entitlement_required`/`reason: voice`, and a family account generated a full
story narrated by Bramble.

## Security findings — all closed

`DECISIONS.md` §15's eleven findings are **all fixed**: six in the original
pass, finding 10 in §18d, and findings 5, 6, 7, 8 and 11 in §19. Every one was
verified against the live database, not just reasoned about.

Two behaviours worth knowing, because they are deliberate refusals rather than
repairs:

- **`merge` now REFUSES** when it would move real content, because storage
  re-keying is still unimplemented and a completed merge renders every story
  with no pictures. `keep_account_only` works and loses nothing (§12a).
  Re-keying needs the worker's service-role client — it structurally cannot be
  done from the Edge Function.
- **A failed character build returns the slot** by being marked `failed`, which
  the derived count excludes. There is no counter to refund.

## Next, in order

1. **Enable anonymous sign-ins** (Dashboard -> Authentication -> Sign In /
   Providers -> Anonymous Sign-Ins). One toggle, ~30 seconds, and it is the only
   thing standing between the current build and a working app. Nothing else on
   this list can be verified until it is on.
2. **Drive photograph -> character -> story -> read** in the Simulator against
   the live backend. Everything below the UI is proven; this is the last
   unverified layer, and the first run will find UI-layer bugs the typechecker
   cannot.
3. **Test Vision on a real device.** `open apps/mobile/ios/Papercub.xcworkspace`,
   Signing → Automatically manage → Personal Team, ⌘R. Free provisioning is
   enough; no Apple Developer Program needed. See `APPLE_SETUP.md`. This is the
   highest-risk unknown in the product — the Simulator will not answer it.
4. **Reconcile the price table against the first real Gemini invoice**
   (§14 item 1). Measured quantities are real; the unit prices are researched.
   Do not reprice until this is done.

## Building the app — the `.env` must be present at BUILD time

`app.config.ts` reads `process.env.EXPO_PUBLIC_*` and its output is baked into
`Papercub.app/EXConstants.bundle/app.config` by xcodebuild. `Constants.expoConfig
.extra` comes from THERE, not from the Metro manifest — so a build made without
the env produces an app that silently falls back to `mockApiClient` no matter
how Metro is started afterwards. The symptom is the library showing "Bobo and the
Missing Moon" and "Luna Finds the Secret Forest", which are mock-client fixtures.

```
cd apps/mobile && set -a && . ../../.env && set +a && xcodebuild …
```

To check what a build actually baked:

```
python3 -c "import json;print(list(json.load(open('ios/build/Build/Products/Debug-iphonesimulator/Papercub.app/EXConstants.bundle/app.config'))['extra'].keys()))"
```

CocoaPods also needs a UTF-8 locale or it dies in `unicode_normalize` before it
reads the Podfile: `LANG=en_US.UTF-8 pod install`.

## Running the app

```
cd apps/mobile && pnpm start
```

`apiClient` goes live automatically when `.env` has Supabase credentials — there
is no flag to flip.

The app boots and renders against the live build — onboarding, navigation and
the whole shell are confirmed working on the iOS 26 simulator.

**All eleven Edge Functions are now deployed** and answering on the live
project — 401 unauthenticated, 422 on an unsupported method, both in the correct
`ApiResponse` envelope with a `copyKey`. They had never been pushed before; every
one 404'd. `revenuecat-webhook` is deployed with `--no-verify-jwt` because it
authenticates by its own header secret, not a Supabase JWT.

**Anonymous sign-in works.** The app boots, signs in anonymously against the
live project, and the library screen loads over the real Edge Functions. Verified
29 Aug 2026 on the iOS 26 simulator.

**The upload flow is wired and proven end to end** (29 Aug 2026). Exercised
against the live project with a real anonymous JWT and a real child's drawing:

```
anonymous sign-in -> upsertChild -> createUploadUrl -> PUT to the signed URL
   -> createCharacter -> claim_character_build -> pgmq -> worker
   -> gate 1 downloads THAT object -> vision -> reference sheet -> ready
```

Character `ready`, feature anchor written, one reference sheet, palette in hex,
reservation released to 0, **6.86c** — matching the earlier measurement. The
worker read exactly the object the client uploaded, which is the step that was
previously impossible.

**A COMPLETE STORY HAS NOW BEEN MADE FROM THE APP** (29 Aug 2026), by tapping
through the real UI on the simulator against the live backend:

```
pick a photo -> isolate -> upload -> character "Pixel" (6.87c)
   -> Make a story -> theme/mood/length -> "Pixel and the Lost Star"
   -> 6 pages, 7 illustrations, 43s narration -> READ IT IN THE READER
```

Story `ready` in 100.7s for **28c**, reservation released to 0. The reader
renders the illustrations through `media-sign` signed URLs and plays the
narration. `original_drawings` recorded `source: photos`, `2048x1536` measured
off the image, and `exif_stripped: true` genuinely — the file is re-encoded, not
just flagged.

**Free-tier lifetime exposure, measured: 35c** (7c character + 28c story),
against the 61c modelled in §2. That is the whole free grant, end to end, on
real infrastructure.

`revenuecat-webhook` currently 500s because `REVENUECAT_WEBHOOK_SECRET` is not
set as a function secret. Expected — RevenueCat is Step 3 in `.env` and is not
configured yet.

**Also fixed while getting there:** the prebuilt Debug app in DerivedData
carried NO entitlements, so `expo-secure-store` failed with "A required
entitlement isn't present" and no session could be stored. Rebuilding with
`CODE_SIGN_ENTITLEMENTS` resolved it; the build now lives in
`apps/mobile/ios/build`. Re-signing an existing bundle ad-hoc does NOT work —
the simulator then refuses to launch it. Do NOT "fix" the Keychain failure by
moving the session to AsyncStorage (`src/lib/supabase.ts` explains why).

## Deploying Edge Functions — CLI gotcha

`supabase functions deploy <name> --project-ref <ref>` fails with:

```
Error: failed to create the graph
Module not found ".../packages/shared/src/index.ts"
```

even though the file is there and `deno check` passes. Adding
`--import-map supabase/functions/deno.json` makes it work — the CLI prints
"Specifying import_map through flags is no longer supported" and then bundles
correctly anyway. The bare specifier `@papercub/shared` maps to a path OUTSIDE
`supabase/functions`, which is what the default resolution cannot follow.

```
npx supabase functions deploy <name> --project-ref <ref> \
  --import-map supabase/functions/deno.json
```

Bundled script size is ~1.1 MB per function — the whole shared package goes into
each one.

## Running the worker — read this first

`tsx` loads the source once at start, so a worker process is a **frozen snapshot
of the code from the moment it launched**. Fourteen stale workers accumulated
across earlier sessions and raced each other for the same queue, which is why
three rounds of instrumentation appeared to produce nothing: the patched code
was genuinely not the code running. Kill everything before every run.

```
pkill -f "tsx src/index.ts"
```

Two more had accumulated by the start of the next session. Check every time.

The queue visibility timeout is now **900s**, up from 180s: a normal story takes
154s, so at 180s pgmq redelivered the message while the job was still running and
a second worker generated and PAID FOR the whole thing again (§18d).

## Known cruft

- A stale `expo@51.0.39` still sits under `packages/vision-module/node_modules`,
  from `auto-install-peers=true` plus `"expo": "*"` peer ranges. Harmless today;
  tighten the ranges to `>=57`.
- `apps/mobile/ios/` is gitignored — `expo prebuild` regenerates it.
