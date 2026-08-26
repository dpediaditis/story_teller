#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-run2.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "0. Diagnostics I could not read from my side"
{ echo "--- timeout config ---"
  grep -rn "timeoutMs" services/worker/src/providers/gemini.ts services/worker/src/config.ts services/worker/src/providers/index.ts 2>/dev/null | head -12
  echo "--- which model does moderation use? ---"
  grep -n "opts.textModel\|opts.visionModel\|function classify" services/worker/src/providers/gemini.ts 2>/dev/null | head -12
} | tee -a "$OUT"

say "1. Point everything at the fast model"
# gemini-3.5-flash answers in 8-17s; the worker's HTTP timeout aborts before
# that, which is why the error moved from 503 to provider_timeout. flash-lite
# answers in ~1s and was 10/10, so it cannot trip any timeout. Prose quality is
# a step down — that is a deliberate trade for this run, whose purpose is to
# prove the pipeline and MEASURE COST, not to judge writing.
python3 - <<'PY' | tee -a "$OUT"
import re, pathlib
env = pathlib.Path(".env"); s = env.read_text()
for k in ("GEMINI_TEXT_MODEL","GEMINI_VISION_MODEL"):
    s = re.sub(rf"^{k}=.*$", f"{k}=gemini-3.1-flash-lite", s, flags=re.M)
env.write_text(s)
print("  text + vision -> gemini-3.1-flash-lite")
PY
set -a; . ./.env; set +a
echo "  text=$GEMINI_TEXT_MODEL vision=$GEMINI_VISION_MODEL premium=$GEMINI_IMAGE_MODEL_PREMIUM fast=$GEMINI_IMAGE_MODEL_FAST" | tee -a "$OUT"

say "2. Seed"
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
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','run2-$(date +%s)');
EOSQL

say "3. Generate"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!; sleep 8
for i in $(seq 1 144); do
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
select 'illustrations: '||count(*) from public.page_illustrations;
select 'p'||index||': '||left(text,88) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "5. Log"
grep -a '"level":"error"' /tmp/pc-worker.log 2>/dev/null | tail -4 | cut -c1-300 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
