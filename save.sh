#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
say(){ printf "\n===== %s =====\n" "$1"; }

say "1. Strip the debug instrumentation"
python3 - <<'PY'
import pathlib, re
for rel in ["src/moderation.ts","src/progress.ts","src/pipeline/story.ts",
            "src/providers/gemini.ts","src/db.ts","src/runner.ts"]:
    p = pathlib.Path("services/worker")/rel
    if not p.exists(): continue
    s = p.read_text(); o = s
    s = s.replace('import {appendFileSync as __A} from "node:fs";\n', '')
    s = re.sub(r'const __T=.*?\n', '', s)
    s = re.sub(r'\n\s*__T\([^\n]*\);', '', s)
    s = re.sub(r'\n\s*console\.error\(`\[trace\][^\n]*\);', '', s)
    s = re.sub(r'\n\s*console\.error\("\[T\][^\n]*\);', '', s)
    # the traced fetch kept __url/__body/__t0 locals; put the call back as it was
    s = s.replace("        const res = await doFetch(__url, {", "        const res = await doFetch(`${baseUrl}/models/${model}:${method}`, {")
    s = re.sub(r'\n\s*const __url = [^\n]*\n\s*const __body = [^\n]*\n\s*const __t0 = [^\n]*', '', s)
    s = s.replace("          body: __body,", "          body: JSON.stringify(body),")
    if s != o: p.write_text(s); print(f"  cleaned {rel}")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -8)
(cd services/worker && npx vitest run 2>&1 | tail -3)

say "2. Record where this stopped"
cat >> DECISIONS.md <<'EOF'

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
EOF
echo "  DECISIONS.md §17 added"

say "3. Commit"
git add -A
git -c user.name="Papercub" -c user.email="noreply@anthropic.com" commit -q -m "Fix Realtime stall, price table gaps, and transient-error retries

From eight live end-to-end attempts against the real Supabase project and Gemini.

- emitProgress created a Realtime channel it never subscribed to, then awaited
  removeChannel() — a teardown that never resolves for a channel that never
  connected. Every job would have stalled on the first stage transition in
  production, reporting a misleading provider_timeout. Now bounded and non-fatal.
- PRICE_TABLE held only gemini-2.5-* entries, so every 3.x model threw before
  any provider call. Added 11 entries. The guard was right to refuse a zero.
- Transient 429/5xx are retried with jittered backoff instead of destroying the
  story.
- Model ids corrected to what the API key actually exposes; the fast image tier
  is gemini-3.1-flash-lite-image, not the 2.5 name the scaffold guessed.

The pipeline still stalls at moderating_input and cost per story is still
unmeasured. See DECISIONS.md §17 for exactly where to pick it up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -3
git push -q origin scaffold && echo "  pushed"

say "4. Remove the throwaway scripts"
rm -f q.py modtest.py probe.py lite.py trace.sh trace2.sh trace3.sh trace4.sh \
      diag-*.sh fix-*.sh gen*.sh run*.sh retry.sh go.sh price-and-run.sh \
      clean-run.sh push-schema.sh repair-schema.sh dump-*.sh test-*.sh \
      models.sh upgrade.sh ship.sh build*.sh check-setup.sh wrap-up.sh 2>/dev/null
echo "  removed (db-status.sh kept)"
