#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-gen5.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
die(){ printf "\nSTOPPED: %s\n" "$1" | tee -a "$OUT"; exit 1; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA -v ON_ERROR_STOP=1 "$@"; }

say "1. Treat empty env vars as absent"
python3 - <<'PY' | tee -a "$OUT"
import re
p = "services/worker/src/config.ts"
s = open(p, encoding="utf-8").read()
if "emptyAsUndefined" in s:
    print("  already patched"); raise SystemExit
helper = '''/**
 * A .env writes an unset key as `KEY=`, which arrives as ''. zod's `.optional()`
 * accepts *absent*, not *empty*, so the worker refused to boot whenever an
 * optional provider key was left blank — the normal state for OPENAI_API_KEY
 * and REVENUECAT_SECRET_API_KEY.
 */
const emptyAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

'''
m = re.search(r"const \w+ = z\.object\(\{", s)
if not m:
    print("  ANCHOR NOT FOUND"); raise SystemExit(1)
s = s[:m.start()] + helper + s[m.start():]
s, n = re.subn(r"(\b[A-Z][A-Z0-9_]*)\s*:\s*(z\.[^,\n]*\.optional\(\))",
               r"\1: z.preprocess(emptyAsUndefined, \2)", s)
open(p, "w", encoding="utf-8").write(s)
print(f"  wrapped {n} optional field(s)")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -6) | tee -a "$OUT"

say "2. Queue state"
echo "queued: $(PSQL -c 'select count(*) from pgmq.q_papercub_generation;')" | tee -a "$OUT"
PSQL -c "select 'job: '||status||' / '||stage from public.generation_jobs order by created_at desc limit 1;" | tee -a "$OUT"

say "3. Worker"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!
sleep 8
kill -0 $WPID 2>/dev/null || { echo "WORKER DIED:" | tee -a "$OUT"; tail -25 /tmp/pc-worker.log | tee -a "$OUT"; die "worker did not start"; }
echo "worker up" | tee -a "$OUT"
for i in $(seq 1 72); do
  sleep 5
  kill -0 $WPID 2>/dev/null || { echo "  worker exited at t+$((i*5))s" | tee -a "$OUT"; break; }
  ST=$(PSQL -c "select status||' / '||coalesce(stage,'')||'  pages='||coalesce(pages_completed,0)||'/'||coalesce(pages_total,0)||'  cost='||coalesce(cost_cents,0)||'c' from public.generation_jobs order by created_at desc limit 1;")
  echo "  t+$((i*5))s  $ST" | tee -a "$OUT"
  case "$ST" in succeeded*|failed*|dead_letter*) break;; esac
done
kill $WPID 2>/dev/null; sleep 1

say "4. RESULT"
PSQL <<'SQL' 2>&1 | tee -a "$OUT"
select 'story:     '||coalesce(title,'(none)')||'   ['||status||']' from public.stories order by created_at desc limit 1;
select 'pages:     '||count(*)||' written / '||count(illustration_asset_id)||' illustrated' from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1);
select 'job:       '||status||' / '||stage||'   error='||coalesce(error_code,'none') from public.generation_jobs order by created_at desc limit 1;
select 'COST:      measured '||cost_cents||'c   vs estimate '||estimated_cost_cents||'c' from public.generation_jobs order by created_at desc limit 1;
select 'usage:     used='||stories_used||'  accrued='||cost_cents_accrued||'c  RESERVED='||cost_cents_reserved||'c  <- must be 0' from public.usage_records;
select 'narration: '||coalesce((select storage_key||'   '||duration_ms||'ms' from public.narrations order by created_at desc limit 1),'none');
select 'moderation: '||count(*)||' events, '||count(*) filter (where verdict<>'pass')||' non-pass' from public.moderation_events;
select 'p'||index||': '||left(text,84) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "5. Worker log"
tail -35 /tmp/pc-worker.log | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
