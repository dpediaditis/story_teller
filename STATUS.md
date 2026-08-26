# Papercub — status

Last updated 26 Aug 2026. Branch `scaffold`, pushed.

## Green

| | |
|---|---|
| 4 packages typecheck | shared · worker · vision-module · mobile |
| Tests | 84 (78 worker, 6 shared) |
| Metro bundle | 4.8 MB, clean |
| **Native iOS build** | `expo prebuild` + `pod install` + `xcodebuild` — exit 0, zero errors |
| Vision module Swift | compiles; `libPapercubVision.a` built for arm64 + x86_64 |
| Schema | 25 migrations, 17 tables, all RLS, verified from scratch |
| Edge Functions | 11, all pass `deno check` |
| Stack | Expo 57 · RN 0.86 · React 19 · Xcode 26 |

## Not proven

**Nothing has generated a real story.** Supabase and Gemini keys are in `.env`
but no story has been produced end to end. Until that happens:

- `DECISIONS.md` §14: the worker's provider price table is **placeholder**,
  back-derived from the cost model rather than read off real pricing. The whole
  of §11's economics rests on it.
- Gemini TTS returns **PCM, not MP3**. The worker writes `.mp3` with an
  estimated duration. This is a certain bug, not a maybe.
- The four Gemini model ids in `services/worker/src/config.ts` are guesses and
  have never been checked against live model availability.

**The Vision module has never run.** Compiling proves the Swift is valid. It
says nothing about whether subject-lifting isolates a real crayon drawing, or
whether the ink-extraction fallback rescues pale pencil — the case most likely
to embarrass the product, and the one the Simulator will not answer honestly.

Milestone 0 bar: >85% clean isolation on crayon/marker, >60% on pencil, across
20+ real children's drawings.

## Open security findings

`DECISIONS.md` §15 has six unfixed items from the review. Two matter before launch:

- **Merge is lossy.** Storage keys keep the old uid prefix, so merged stories
  render with no pictures and no narration after the user was told "nothing was
  lost". Until re-keying exists, `merge` should refuse rather than complete.
- **Subscribers get permanently ceiling-locked.** The usage period is never
  renewed, so after the first renewal a paying customer falls back to the free
  never-resetting row and eventually cannot generate at all.

None are reachable while the app runs on mocks.

## Next, in order

1. **Run one real story.** Start the worker, create a character, generate.
   Compare measured cost/story against $0.45 / $0.64 / $0.74. This is the
   highest-value unknown in the project.
2. **Test Vision on a real device.** `open apps/mobile/ios/Papercub.xcworkspace`,
   Signing → Automatically manage → Personal Team, ⌘R. Free provisioning is
   enough; no Apple Developer Program needed. See `APPLE_SETUP.md`.
3. **Close §15 findings 5–8, 10–11** before real money moves.
4. Swap `SessionProvider` to B5's real `useSession()` and delete the mock
   session path (`DECISIONS.md` §13).

## Known cruft

- A stale `expo@51.0.39` still sits under `packages/vision-module/node_modules`,
  from `auto-install-peers=true` plus `"expo": "*"` peer ranges. Harmless today;
  tighten the ranges to `>=57`.
- `apps/mobile/ios/` is gitignored — `expo prebuild` regenerates it.
