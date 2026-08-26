#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-retry.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
# NOTE: status/stage are Postgres enums — `enum || text` has no implicit cast,
# so every status query I ran without ::text was silently erroring to stderr
# and printing nothing. That is why the poller showed "(none)" throughout.
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. State after the 503s"
PSQL <<'SQL' | tee -a "$OUT"
select 'jobs:      '||count(*)||'  failed='||count(*) filter (where status::text='failed')
       ||'  refunded='||count(*) filter (where quota_refunded) from public.generation_jobs;
select 'usage:     used='||stories_used||'  accrued='||cost_cents_accrued
       ||'c  RESERVED='||cost_cents_reserved||'c   <- must be 0 after refunds'
  from public.usage_records order by period_start desc limit 1;
select 'queued:    '||count(*) from pgmq.q_papercub_generation;
SQL

say "2. Which text model is actually available right now?"
PICK=""
for m in gemini-3.7-flash gemini-3.6-flash gemini-3.5-flash gemini-2.5-flash; do
  code=$(curl -s -o /tmp/pc-t.json -w '%{http_code}' \
    -X POST "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent?key=$GEMINI_API_KEY" \
    -H 'Content-Type: application/json' -d '{"contents":[{"parts":[{"text":"say ok"}]}]}')
  echo "  $m -> HTTP $code" | tee -a "$OUT"
  [ "$code" = "200" ] && [ -z "$PICK" ] && PICK="$m"
done
[ -n "$PICK" ] || { echo "  all text models unavailable — Gemini is still under load, try again shortly" | tee -a "$OUT"; exit 1; }
echo "  using: $PICK" | tee -a "$OUT"
export GEMINI_TEXT_MODEL="$PICK" GEMINI_VISION_MODEL="$PICK"

say "3. Fresh story"
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
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','retry-$(date +%s)');
EOSQL

say "4. Worker"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!; sleep 8
for i in $(seq 1 90); do
  sleep 5
  kill -0 $WPID 2>/dev/null || { echo "  worker exited t+$((i*5))s" | tee -a "$OUT"; break; }
  ST=$(PSQL -c "select status::text||' / '||coalesce(stage::text,'')||'  pages='||coalesce(pages_completed,0)||'/'||coalesce(pages_total,0)||'  cost='||coalesce(cost_cents,0)||'c' from public.generation_jobs order by created_at desc limit 1;")
  echo "  t+$((i*5))s  ${ST:-(none)}" | tee -a "$OUT"
  case "$ST" in succeeded*|failed*|dead_letter*) break;; esac
done
kill $WPID 2>/dev/null; sleep 1

say "5. RESULT"
PSQL <<'SQL' 2>&1 | tee -a "$OUT"
select 'story:      '||coalesce(title,'(none)')||'   ['||status::text||']' from public.stories order by created_at desc limit 1;
select 'pages:      '||count(*)||' written / '||count(illustration_asset_id)||' illustrated' from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1);
select 'job:        '||status::text||' / '||stage::text||'   error='||coalesce(error_code::text,'none') from public.generation_jobs order by created_at desc limit 1;
select 'COST:       measured '||cost_cents||'c   vs estimate '||estimated_cost_cents||'c' from public.generation_jobs order by created_at desc limit 1;
select 'usage:      used='||stories_used||'  accrued='||cost_cents_accrued||'c  RESERVED='||cost_cents_reserved||'c' from public.usage_records order by period_start desc limit 1;
select 'narration:  '||coalesce((select storage_key||'   '||duration_ms||'ms' from public.narrations order by created_at desc limit 1),'none');
select 'moderation: '||count(*)||' events' from public.moderation_events;
select 'p'||index||': '||left(text,84) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "6. Worker log"
grep -viE '"level":"debug"|Realtime send' /tmp/pc-worker.log | tail -25 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
