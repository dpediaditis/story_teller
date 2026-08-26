#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-trace.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Trace every fetch: URL, size, duration"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
p = pathlib.Path("services/worker/src/providers/gemini.ts"); s = p.read_text()
if "[trace]" in s: print("  already traced"); raise SystemExit
old = "        const res = await doFetch(`${baseUrl}/models/${model}:${method}`, {"
new = """        const __url = `${baseUrl}/models/${model}:${method}`;
        const __body = JSON.stringify(body);
        const __t0 = Date.now();
        console.error(`[trace] -> ${model} ${method} bodyBytes=${__body.length} attempt=${attempt}`);
        const res = await doFetch(__url, {"""
if old not in s: print("  ANCHOR 1 MISS"); raise SystemExit(1)
s = s.replace(old, new, 1)
s = s.replace("          body: JSON.stringify(body),\n          signal: controller.signal,",
              "          body: __body,\n          signal: controller.signal,", 1)
old2 = "        const text = await res.text();"
new2 = ("        const text = await res.text();\n"
        "        console.error(`[trace] <- ${model} HTTP ${res.status} in ${Date.now() - __t0}ms`);")
if old2 not in s: print("  ANCHOR 2 MISS"); raise SystemExit(1)
s = s.replace(old2, new2, 1)
p.write_text(s); print("  gemini.ts traced")
PY

say "2. Trace the storage download (the other suspect at this stage)"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
p = pathlib.Path("services/worker/src/db.ts"); s = p.read_text()
if "[trace] storage" in s: print("  already traced"); raise SystemExit
m = re.search(r"(async downloadObject\([^)]*\)[^{]*\{)", s)
if not m:
    print("  downloadObject not found — dumping candidates:")
    for i, line in enumerate(s.splitlines(), 1):
        if "download" in line or "storage" in line.lower():
            print(f"    {i}: {line.strip()[:110]}")
    raise SystemExit
s = s[:m.end()] + '\n    console.error(`[trace] storage download start`);' + s[m.end():]
p.write_text(s); print("  db.ts traced")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -4) | tee -a "$OUT"

say "3. One job, traced"
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
select public.claim_story_quota('$C'::uuid, array['$CH']::uuid[], 'space','funny','short','cutout_rerender','e2e','trace-$(date +%s)');
EOSQL
echo "  queued" | tee -a "$OUT"

export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
export GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL
(cd services/worker && npx tsx src/index.ts) > /tmp/pc-worker.log 2>&1 &
WPID=$!
sleep 75
kill $WPID 2>/dev/null; sleep 1

say "4. Trace output"
grep -a "\[trace\]" /tmp/pc-worker.log | head -25 | tee -a "$OUT"
echo "--- errors ---" | tee -a "$OUT"
grep -a '"level":"error"' /tmp/pc-worker.log | tail -2 | cut -c1-300 | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
