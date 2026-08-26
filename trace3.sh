#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-trace3.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Instrument the moderation path"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
n = 0
# Every exported async function in moderation.ts announces itself.
p = pathlib.Path("services/worker/src/moderation.ts")
if p.exists():
    s = p.read_text()
    if "[T]" not in s:
        def ins(m):
            global n; n += 1
            return m.group(0) + f'\n  console.error("[T] moderation.{m.group(1)} enter");'
        s = re.sub(r"export async function (\w+)\([^)]*\)[^{]*\{", ins, s)
        p.write_text(s)
    print(f"  moderation.ts: {n} functions traced")
else:
    print("  moderation.ts NOT FOUND")

# Progress reporter — the other thing that runs on a stage change.
p2 = pathlib.Path("services/worker/src/progress.ts")
if p2.exists():
    s2 = p2.read_text()
    if "[T]" not in s2:
        s2 = re.sub(r"(async \w+\([^)]*\)[^{]*\{)",
                    lambda m: m.group(1) + '\n    console.error("[T] progress call");', s2, count=3)
        p2.write_text(s2)
    print("  progress.ts traced")

# Top of the story pipeline and its first stage transition.
p3 = pathlib.Path("services/worker/src/pipeline/story.ts")
s3 = p3.read_text()
if "[T] runStoryGenerate" not in s3:
    s3 = s3.replace("  const { job, deps, ledger, progress } = args;",
                    '  console.error("[T] runStoryGenerate enter");\n  const { job, deps, ledger, progress } = args;', 1)
    p3.write_text(s3)
    print("  story.ts entry traced")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -4) | tee -a "$OUT"

say "2. One job"
P=$(PSQL -c "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated','e2e-'||substr(md5(random()::text),1,8)||'@papercub.test','',now(),now(),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',false) returning id;" | UUID)
KEY="drawings/$P/e2e/cutout.png"
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/storage/v1/object/$KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: image/png" \
  --data-binary @/tmp/pc-drawing.png -o /dev/null -w "  cutout HTTP %{http_code}\n" | tee -a "$OUT"
C=$(PSQL -c "insert into public.child_profiles (parent_id,display_name,age_band) values ('$P','Mia','6_7') returning id;" | UUID)
D=$(PSQL -c "insert into public.original_drawings (child_id,cutout_storage_key,captured_at,source,retention_policy,exif_stripped,isolation_method,isolation_confidence,face_detected,text_detected,width_px,height_px) values ('$C','$KEY',now(),'camera','delete_after_cutout',true,'vision_subject_lift',0.93,false,false,512,512) returning id;" | UUID)
CH=$(PSQL -c "insert into public.characters (child_id,drawing_id,name,character_type,personality_traits,palette,feature_anchor,status) values ('$C','$D','Bobo','monster',array['funny','brave'],array['#7b4fc4'],'a purple monster','ready') returning id;" | UUID)
PSQL -c "insert into public.character_assets (character_id,kind,storage_key,version,is_primary,width_px,height_px) values ('$CH','cutout','$KEY',1,true,512,512);" >/dev/null
PSQL <<EOSQL >/dev/null 2>&1
select set_config('request.jwt.claims','{"sub":"$P","role":"authenticated"}',false);
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','t3-$(date +%s)');
EOSQL
echo "  queued" | tee -a "$OUT"

export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!
sleep 45
kill $WPID 2>/dev/null; sleep 1

say "3. Execution trace — last line reached is the culprit"
grep -a "\[T\]\|\[trace\]" /tmp/pc-worker.log | head -30 | tee -a "$OUT"
echo "--- errors ---" | tee -a "$OUT"
grep -a '"level":"error"' /tmp/pc-worker.log | tail -2 | cut -c1-260 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
