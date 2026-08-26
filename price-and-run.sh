#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-final.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Add the 3.x price entries"
python3 - <<'PY' | tee -a "$OUT"
import pathlib
p = pathlib.Path("services/worker/src/providers/pricing.ts"); s = p.read_text()
if "gemini-3.1-flash-lite'" in s:
    print("  already present"); raise SystemExit
anchor = "  /* ── OpenAI (second provider, dark) ─────────────────────────────────── */"
block = """  /* ── Google, 3.x ──────────────────────────────────────────────────────
   * Added after the first live run: the table held only 2.5-* entries, so
   * every 3.x model threw UnknownModelPriceError before any provider call
   * completed. The guard worked exactly as intended — it refused to record a
   * zero — but the table had not kept up with the models actually configured.
   *
   * VERIFY THESE against Google's current pricing page before launch.
   * DECISIONS.md §14 item 1 still stands: these are researched figures, not
   * numbers read off an invoice, and §6 makes any change a repricing trigger.
   */
  'gemini-3.7-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },
  },
  'gemini-3.6-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },
  },
  'gemini-3.5-flash': {
    provider: 'google',
    text: { inputCentsPerMTok: 150, outputCentsPerMTok: 900 },
  },
  'gemini-3.5-flash-lite': {
    provider: 'google',
    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
  'gemini-3.1-flash-lite': {
    provider: 'google',
    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
  },
  /** Premium tier, cover only. ~$0.067 per 1K image. */
  'gemini-3.1-flash-image': { provider: 'google', image: { centsPerImage: 6.7 } },
  /** Fast tier, interior pages — the cheap half of the split. ~$0.0336. */
  'gemini-3.1-flash-lite-image': { provider: 'google', image: { centsPerImage: 3.36 } },
  'gemini-3-pro-image': { provider: 'google', image: { centsPerImage: 13.4 } },

"""
s = s.replace(anchor, block + anchor, 1)
p.write_text(s)
print("  added 8 entries for gemini-3.x")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -4) | tee -a "$OUT"
(cd services/worker && npx vitest run 2>&1 | tail -3) | tee -a "$OUT"

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
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','final-$(date +%s)');
EOSQL

say "3. Generate"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!; sleep 8
for i in $(seq 1 180); do
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
select 'p'||index||': '||left(text,90) from public.story_pages
  where story_id=(select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "5. Errors"
grep -a '"level":"error"' /tmp/pc-worker.log 2>/dev/null | tail -3 | cut -c1-320 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
