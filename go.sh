#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-go.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Retry transient upstream failures instead of losing the story"
python3 - <<'PY' | tee -a "$OUT"
p = "services/worker/src/providers/gemini.ts"
s = open(p, encoding="utf-8").read()
if "RETRYABLE_STATUSES" in s:
    print("  already patched"); raise SystemExit

old = """  async function post(model: string, method: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}/models/${model}:${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new GeminiError(res.status, text);
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }"""

new = """  /**
   * 503 UNAVAILABLE ("this model is currently experiencing high demand") and 429
   * are transient by Google's own description. Treating them as terminal means a
   * brief capacity spike costs a parent their story: they tap Create, wait, and
   * get nothing. Observed live — three consecutive stories lost to a spike that
   * cleared within minutes.
   *
   * Retries are bounded and only on transient statuses. A 400 or 404 is a real
   * bug and must still fail immediately rather than being retried four times.
   */
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
  const MAX_HTTP_ATTEMPTS = 4;

  async function post(model: string, method: string, body: unknown): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${baseUrl}/models/${model}:${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text);

        const error = new GeminiError(res.status, text);
        if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_HTTP_ATTEMPTS) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
      }

      // 1s, 2s, 4s, with jitter so concurrent workers do not retry in lockstep.
      const backoffMs = 2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    throw lastError;
  }"""

if old not in s:
    print("  ANCHOR NOT FOUND — post() differs from what was inspected"); raise SystemExit(1)
open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
print("  patched: bounded retry with jittered backoff on 429/5xx")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -5) | tee -a "$OUT"
(cd services/worker && npx vitest run 2>&1 | tail -4) | tee -a "$OUT"

say "2. Seed a story"
P=$(PSQL -c "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated','e2e-'||substr(md5(random()::text),1,8)||'@papercub.test','',now(),now(),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',false) returning id;" | UUID)
KEY="drawings/$P/e2e/cutout.png"
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/storage/v1/object/$KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: image/png" \
  --data-binary @/tmp/pc-drawing.png -o /dev/null -w "  cutout HTTP %{http_code}\n" | tee -a "$OUT"
C=$(PSQL -c "insert into public.child_profiles (parent_id,display_name,age_band) values ('$P','Mia','6_7') returning id;" | UUID)
D=$(PSQL -c "insert into public.original_drawings (child_id,cutout_storage_key,captured_at,source,retention_policy,exif_stripped,isolation_method,isolation_confidence,face_detected,text_detected,width_px,height_px) values ('$C','$KEY',now(),'camera','delete_after_cutout',true,'vision_subject_lift',0.93,false,false,512,512) returning id;" | UUID)
CH=$(PSQL -c "insert into public.characters (child_id,drawing_id,name,character_type,personality_traits,palette,feature_anchor,status) values ('$C','$D','Bobo','monster',array['funny','brave'],array['#7b4fc4'],'a purple monster with three horns and two differently sized eyes','ready') returning id;" | UUID)
PSQL -c "insert into public.character_assets (character_id,kind,storage_key,version,is_primary,width_px,height_px) values ('$CH','cutout','$KEY',1,true,512,512);" >/dev/null
PSQL <<EOSQL 2>&1 | tail -1 | tee -a "$OUT"
select set_config('request.jwt.claims','{"sub":"$P","role":"authenticated"}',false);
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','go-$(date +%s)');
EOSQL

say "3. Worker"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL=gemini-3.7-flash GEMINI_VISION_MODEL=gemini-3.7-flash
export GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!; sleep 8
for i in $(seq 1 100); do
  sleep 5
  kill -0 $WPID 2>/dev/null || { echo "  worker exited t+$((i*5))s" | tee -a "$OUT"; break; }
  ST=$(PSQL -c "select status::text||' / '||coalesce(stage::text,'')||'  pages='||coalesce(pages_completed,0)||'/'||coalesce(pages_total,0)||'  cost='||coalesce(cost_cents,0)||'c' from public.generation_jobs order by created_at desc limit 1;")
  echo "  t+$((i*5))s  ${ST:-(none)}" | tee -a "$OUT"
  case "$ST" in succeeded*|failed*|dead_letter*) break;; esac
done
kill $WPID 2>/dev/null; sleep 1

say "4. RESULT"
PSQL <<'SQL' 2>&1 | tee -a "$OUT"
select 'story:      '||coalesce(title,'(none)')||'   ['||status::text||']' from public.stories order by created_at desc limit 1;
select 'pages:      '||count(*)||' written / '||count(illustration_asset_id)||' illustrated' from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1);
select 'job:        '||status::text||' / '||stage::text||'   error='||coalesce(error_code::text,'none') from public.generation_jobs order by created_at desc limit 1;
select 'COST:       measured '||cost_cents||'c   vs estimate '||estimated_cost_cents||'c' from public.generation_jobs order by created_at desc limit 1;
select 'usage:      used='||stories_used||'  accrued='||cost_cents_accrued||'c  RESERVED='||cost_cents_reserved||'c' from public.usage_records order by period_start desc limit 1;
select 'narration:  '||coalesce((select storage_key||'   '||duration_ms||'ms' from public.narrations order by created_at desc limit 1),'none');
select 'moderation: '||count(*)||' events' from public.moderation_events;
select 'p'||index||': '||left(text,86) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "5. Worker log"
grep -viE '"level":"debug"|Realtime send' /tmp/pc-worker.log | tail -25 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
