#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-trace4.txt
: > "$OUT"; : > /tmp/pc-T.log
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Replace console.error traces with synchronous file appends"
# console.error to a redirected fd is block-buffered by Node; SIGTERM before a
# flush loses everything. appendFileSync cannot be buffered away.
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
helper = 'import {appendFileSync as __A} from "node:fs";\nconst __T=(m:string)=>{try{__A("/tmp/pc-T.log",Date.now()+" "+m+"\\n")}catch{}};\n'
changed = []
for rel in ["src/moderation.ts","src/progress.ts","src/pipeline/story.ts",
            "src/providers/gemini.ts","src/db.ts","src/runner.ts"]:
    p = pathlib.Path("services/worker")/rel
    if not p.exists(): continue
    s = p.read_text()
    s = s.replace('console.error("[T] ', '__T("')
    s = re.sub(r'console\.error\(`\[trace\] ([^`]*)`\)', r'__T(`\1`)', s)
    s = s.replace("console.error(`[gemini] ", "__T(`")
    if "__T(" in s and "__A" not in s:
        s = helper + s
        changed.append(rel)
    p.write_text(s)
print("  rewired:", ", ".join(changed) or "none")
PY

say "2. Add coarse markers so we see the last point reached"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
helper = 'import {appendFileSync as __A} from "node:fs";\nconst __T=(m:string)=>{try{__A("/tmp/pc-T.log",Date.now()+" "+m+"\\n")}catch{}};\n'
p = pathlib.Path("services/worker/src/runner.ts"); s = p.read_text()
if "__T(" not in s:
    s = helper + s
n = 0
def mark(m):
    global n; n += 1
    return m.group(0) + f'\n  __T("runner:{m.group(1)}");'
s2 = re.sub(r"export async function (\w+)\([^)]*\)[^{]*\{", mark, s)
p.write_text(s2)
print(f"  runner.ts: {n} entry points marked")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -6) | tee -a "$OUT"

say "3. One job"
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
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','t4-$(date +%s)');
EOSQL
echo "  queued" | tee -a "$OUT"

export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!
sleep 50
kill $WPID 2>/dev/null; sleep 1

say "4. TRACE — last line is where it stops"
cat /tmp/pc-T.log 2>/dev/null | tail -40 | tee -a "$OUT"
echo "  (lines: $(wc -l < /tmp/pc-T.log 2>/dev/null || echo 0))" | tee -a "$OUT"
echo "--- errors ---" | tee -a "$OUT"
grep -a '"level":"error"' /tmp/pc-worker.log | tail -2 | cut -c1-260 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
