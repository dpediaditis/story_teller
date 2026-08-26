#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
say(){ printf "\n===== %s =====\n" "$1"; }

say "1. Make the retry patient enough for a real capacity spike"
python3 - <<'PY'
p = "services/worker/src/providers/gemini.ts"
s = open(p, encoding="utf-8").read()
old_a = "  const MAX_HTTP_ATTEMPTS = 4;"
new_a = """  // Observed live: Gemini's multimodal capacity degraded for ~15 minutes while
  // text-only calls kept succeeding. Four attempts over ~7s was nowhere near
  // enough. 6 attempts with 2/4/8/16/32s backoff rides out ~62s, which is worth
  // it — the alternative is telling a parent their story failed.
  const MAX_HTTP_ATTEMPTS = 6;"""
old_b = "      const backoffMs = 2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 250);"
new_b = "      const backoffMs = 2 ** attempt * 1000 + Math.floor(Math.random() * 500);"
ok = True
for o, n in ((old_a, new_a), (old_b, new_b)):
    if o not in s: print(f"  MISS {o[:40]!r}"); ok = False
    else: s = s.replace(o, n, 1)
if ok:
    open(p, "w", encoding="utf-8").write(s); print("  retry budget: 6 attempts, ~62s")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -4)
(cd services/worker && npx vitest run 2>&1 | tail -3)

say "2. Record what the live run proved"
cat >> DECISIONS.md <<'EOF'

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
EOF
echo "  DECISIONS.md §16 added"

say "3. Commit"
git add -A
git -c user.name="Papercub" -c user.email="noreply@anthropic.com" commit -q -m "Fix five bugs found by the first live end-to-end run

Ran the pipeline against the real Supabase project and Gemini. The schema,
storage, quota gate and — four times over — the refund path all work. Five
bugs surfaced that would each have hit on first deploy:

- worker refused to boot when an optional env var was empty rather than absent
- gemini-2.5-flash-lite-image does not exist; the real fast tier is
  gemini-3.1-flash-lite-image, which keeps the cheap-pages/premium-cover split
- pgmq was unreachable over PostgREST, so the worker could never read its own
  queue. Added public.queue_* wrappers needing no dashboard configuration
- Gemini TTS returns PCM, not MP3. Wrapped in WAV, duration now computed from
  byte count instead of estimated from text length
- transient 503s failed entire stories. Now retried with jittered backoff

Cost per story is still unmeasured: Gemini's multimodal capacity was degraded
throughout, so no story completed. See DECISIONS.md §16.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -3
git push -q origin scaffold && echo "  pushed"
