#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-qclient.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. Teach the worker the public-schema wrappers"
python3 - <<'PY' | tee -a "$OUT"
import re
p = "services/worker/src/db.ts"
s = open(p, encoding="utf-8").read()
if "PUBLIC_QUEUE_FN" in s:
    print("  already patched"); raise SystemExit

start = s.find("  const anyClient = client as any;\n  let schema:")
if start == -1:
    print("  ANCHOR NOT FOUND (anyClient/schema)"); raise SystemExit(1)
marker = "    throw new Error(\n      `pgmq.${fn} failed"
end = s.find(marker, start)
if end == -1:
    print("  ANCHOR NOT FOUND (throw)"); raise SystemExit(1)

new = '''  const anyClient = client as any;

  /**
   * Three ways a Supabase project can expose pgmq, in preference order:
   *
   *   'public'       queue_read/queue_send/... wrappers (migration
   *                  20260826180000). Needs NO dashboard configuration, so this
   *                  is tried first — a stock project exposes only `public` and
   *                  `graphql_public`, which is why the other two failed.
   *   'pgmq_public'  Supabase's Queues integration, if enabled.
   *   'pgmq'         projects that added pgmq to Exposed schemas directly.
   *
   * The public wrappers use different function names AND argument labels, so
   * the call is translated rather than just re-pointed at another schema.
   */
  type QueueFlavour = 'public' | 'pgmq_public' | 'pgmq';
  let flavour: QueueFlavour | null = null;

  const PUBLIC_QUEUE_FN: Record<string, string> = {
    read: 'queue_read',
    send: 'queue_send',
    delete: 'queue_delete',
    archive: 'queue_archive',
  };

  function toPublicArgs(fn: string, a: Record<string, unknown>): Record<string, unknown> {
    if (fn === 'read') {
      return { queue_name: a.queue_name, visibility_seconds: a.sleep_seconds, batch_size: a.n };
    }
    if (fn === 'send') {
      return { queue_name: a.queue_name, message: a.message, delay_seconds: 0 };
    }
    return { queue_name: a.queue_name, message_id: a.message_id };
  }

  async function call(fn: string, args: Record<string, unknown>) {
    const order: QueueFlavour[] = flavour ? [flavour] : ['public', 'pgmq_public', 'pgmq'];
    let lastError: unknown = null;

    for (const candidate of order) {
      const name = candidate === 'public' ? (PUBLIC_QUEUE_FN[fn] ?? fn) : fn;
      const payload = candidate === 'public' ? toPublicArgs(fn, args) : args;
      const q = candidate === 'public' ? anyClient : anyClient.schema(candidate);
      const { data, error } = await q.rpc(name, payload);
      if (!error) {
        flavour = candidate;
        return data;
      }
      lastError = error;
    }
'''
s = s[:start] + new + s[end:]
s = s.replace("`pgmq.${fn} failed (tried ${schemas.join(', ')}): `",
              "`queue.${fn} failed (tried public, pgmq_public, pgmq): `", 1)
open(p, "w", encoding="utf-8").write(s)
print("  patched services/worker/src/db.ts")
PY

say "2. Typecheck + tests"
(cd services/worker && npx tsc --noEmit 2>&1 | head -8) | tee -a "$OUT"
(cd services/worker && npx vitest run 2>&1 | tail -5) | tee -a "$OUT"

say "3. Run the worker against the 2 queued messages"
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
echo "queued: $(PSQL -c 'select count(*) from pgmq.q_papercub_generation;')" | tee -a "$OUT"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!
sleep 8
kill -0 $WPID 2>/dev/null || { tail -20 /tmp/pc-worker.log | tee -a "$OUT"; exit 1; }
for i in $(seq 1 84); do
  sleep 5
  kill -0 $WPID 2>/dev/null || { echo "  worker exited at t+$((i*5))s" | tee -a "$OUT"; break; }
  ST=$(PSQL -c "select status||' / '||coalesce(stage,'')||'  pages='||coalesce(pages_completed,0)||'/'||coalesce(pages_total,0)||'  cost='||coalesce(cost_cents,0)||'c' from public.generation_jobs order by created_at desc limit 1;")
  echo "  t+$((i*5))s  ${ST:-(none)}" | tee -a "$OUT"
  case "$ST" in succeeded*|failed*|dead_letter*) break;; esac
done
kill $WPID 2>/dev/null; sleep 1

say "4. RESULT"
PSQL <<'SQL' 2>&1 | tee -a "$OUT"
select 'story:      '||coalesce(title,'(none)')||'   ['||status||']' from public.stories order by created_at desc limit 1;
select 'pages:      '||count(*)||' written / '||count(illustration_asset_id)||' illustrated' from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1);
select 'job:        '||status||' / '||stage||'   error='||coalesce(error_code,'none') from public.generation_jobs order by created_at desc limit 1;
select 'COST:       measured '||cost_cents||'c   vs estimate '||estimated_cost_cents||'c' from public.generation_jobs order by created_at desc limit 1;
select 'usage:      used='||stories_used||'  accrued='||cost_cents_accrued||'c  RESERVED='||cost_cents_reserved||'c  <- must be 0' from public.usage_records order by period_start desc limit 1;
select 'narration:  '||coalesce((select storage_key||'   '||duration_ms||'ms' from public.narrations order by created_at desc limit 1),'none');
select 'moderation: '||count(*)||' events, '||count(*) filter (where verdict<>'pass')||' non-pass' from public.moderation_events;
select 'p'||index||': '||left(text,84) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "5. Worker log"
grep -viE '"level":"debug"' /tmp/pc-worker.log | tail -30 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
