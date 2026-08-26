#!/usr/bin/env bash
# Generate ONE real story end to end against the live Supabase + Gemini.
# Cost: roughly $0.45 for a short story.
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-gen.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
die(){ printf "\nSTOPPED: %s\n" "$1" | tee -a "$OUT"; exit 1; }

set -a; . ./.env; set +a
[ -n "$EXPO_PUBLIC_SUPABASE_URL" ]   || die "EXPO_PUBLIC_SUPABASE_URL empty"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]  || die "SUPABASE_SERVICE_ROLE_KEY empty"
[ -n "$GEMINI_API_KEY" ]             || die "GEMINI_API_KEY empty"
[ -n "$SUPABASE_DB_URL" ]            || die "SUPABASE_DB_URL empty (needed to seed)"

PSQL() { docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

say "1. Which Gemini models actually exist on this key?"
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | grep -oE '"models/[a-z0-9.-]+"' | tr -d '"' | sed 's|models/||' | sort -u | head -40 | tee -a "$OUT"
echo "--- the four the worker expects ---" | tee -a "$OUT"
ALL=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY")
for m in "${GEMINI_TEXT_MODEL:-gemini-2.5-flash}" "${GEMINI_IMAGE_MODEL_PREMIUM:-gemini-2.5-flash-image}" \
         "${GEMINI_IMAGE_MODEL_FAST:-gemini-2.5-flash-lite-image}" "${GEMINI_TTS_MODEL:-gemini-2.5-flash-preview-tts}"; do
  echo "$ALL" | grep -q "models/$m\"" && echo "  OK      $m" | tee -a "$OUT" || echo "  MISSING $m" | tee -a "$OUT"
done

say "2. Push schema to the live project"
npx --yes supabase db push --db-url "$SUPABASE_DB_URL" 2>&1 | tail -15 | tee -a "$OUT"

say "3. Make a test drawing (crayon-ish monster, pure-python PNG)"
python3 - <<'PY'
import zlib, struct
W=H=512
px=[[(255,255,255) for _ in range(W)] for _ in range(H)]
def disc(cx,cy,r,col):
    for y in range(max(0,cy-r),min(H,cy+r)):
        for x in range(max(0,cx-r),min(W,cx+r)):
            if (x-cx)**2+(y-cy)**2 <= r*r: px[y][x]=col
V=(123,79,196); D=(40,30,60); W_=(255,255,255)
disc(256,270,120,V)                      # body
disc(210,240,34,W_); disc(300,248,26,W_) # eyes, different sizes
disc(214,244,14,D);  disc(303,251,11,D)
for i in range(60): disc(200+i,340+int((i-30)**2/45),7,D)   # smile
for hx,hy in ((190,165),(256,150),(322,168)):               # horns
    for t in range(46): disc(hx+int(t*0.25),hy+t,max(3,11-t//5),V)
for t in range(70): disc(140+t//3,300+t,6,V); disc(372-t//3,300+t,6,V)  # arms
raw=b''.join(b'\x00'+bytes(v for p in row for v in p) for row in px)
def chunk(t,d):
    c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
png=(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,2,0,0,0))
     +chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b''))
open('/tmp/pc-drawing.png','wb').write(png)
print(f"wrote /tmp/pc-drawing.png ({len(png)} bytes)")
PY
tee -a "$OUT" < /dev/null

say "4. Seed parent / child / character, and upload the cut-out"
IDS=$(PSQL -tA <<'SQL'
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated','authenticated',
  'e2e-'||substr(md5(random()::text),1,8)||'@papercub.test','', now(), now(), now(),
  '{"provider":"email","providers":["email"]}','{}', false)
returning id;
SQL
) || die "could not create auth user"
PARENT=$(echo "$IDS" | tail -1)
echo "parent: $PARENT" | tee -a "$OUT"

CUTOUT_KEY="drawings/$PARENT/e2e/cutout.png"
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/storage/v1/object/$CUTOUT_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: image/png" --data-binary @/tmp/pc-drawing.png -o /tmp/pc-upload.json -w "upload HTTP %{http_code}\n" | tee -a "$OUT"
cat /tmp/pc-upload.json | head -3 | tee -a "$OUT"

PSQL -tA -v parent="$PARENT" -v key="$CUTOUT_KEY" <<'SQL' | tee -a "$OUT"
\set p :parent
insert into public.child_profiles (parent_id, display_name, age_band)
  values (:'parent', 'Mia', '6_7') returning 'child '||id;
SQL

say "5. Enqueue a real story job"
PSQL -tA -v parent="$PARENT" -v key="$CUTOUT_KEY" <<'SQL' | tee -a "$OUT"
do $$
declare c uuid; d uuid; ch uuid; res jsonb;
begin
  select id into c from public.child_profiles where parent_id = :'parent';
  insert into public.original_drawings (child_id, cutout_storage_key, captured_at, source,
    retention_policy, exif_stripped, isolation_method, isolation_confidence,
    face_detected, text_detected, width_px, height_px)
  values (c, :'key', now(), 'camera', 'delete_after_cutout', true,
    'vision_subject_lift', 0.93, false, false, 512, 512) returning id into d;

  insert into public.characters (child_id, drawing_id, name, character_type,
    personality_traits, palette, feature_anchor, status)
  values (c, d, 'Bobo', 'monster', array['funny','brave'], array['#7b4fc4'],
    'a purple monster with three horns and two differently sized eyes', 'ready')
  returning id into ch;

  insert into public.character_assets (character_id, kind, storage_key, version, is_primary,
    width_px, height_px)
  values (ch, 'cutout', :'key', 1, true, 512, 512);

  perform set_config('request.jwt.claims',
    json_build_object('sub', :'parent', 'role','authenticated')::text, true);
  res := public.claim_story_quota(c, array[ch], 'space','funny','short',
    'cutout_rerender','e2e-test', 'e2e-'||substr(md5(random()::text),1,10));
  raise notice 'claim: %', res;
end $$;
SQL

PSQL -tA -c "select 'queued messages: '||count(*) from pgmq.q_papercub_generation;" | tee -a "$OUT"

say "6. Run the worker until the story finishes (max 6 min)"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
pnpm --filter @papercub/worker dev > /tmp/pc-worker.log 2>&1 &
WPID=$!
for i in $(seq 1 72); do
  sleep 5
  ST=$(PSQL -tA -c "select status from public.stories order by created_at desc limit 1;" 2>/dev/null | tr -d ' ')
  echo "  t+$((i*5))s  story=$ST"
  case "$ST" in ready|failed) break;; esac
done
kill $WPID 2>/dev/null; sleep 1; pkill -f "papercub/worker" 2>/dev/null

say "7. RESULT"
PSQL -tA <<'SQL' | tee -a "$OUT"
select 'story:  '||coalesce(title,'(no title)')||'  ['||status||']' from public.stories order by created_at desc limit 1;
select 'pages:  '||count(*)||' text, '||count(illustration_asset_id)||' illustrated' from public.story_pages
  where story_id = (select id from public.stories order by created_at desc limit 1);
select 'job:    stage='||stage||' status='||status||' cost='||cost_cents||'c est='||estimated_cost_cents||'c err='||coalesce(error_code,'none')
  from public.generation_jobs order by created_at desc limit 1;
select 'usage:  used='||stories_used||' accrued='||cost_cents_accrued||'c reserved='||cost_cents_reserved||'c' from public.usage_records;
select 'narration: '||coalesce((select storage_key from public.narrations order by created_at desc limit 1),'none');
select 'page '||index||': '||left(text,90) from public.story_pages
  where story_id = (select id from public.stories order by created_at desc limit 1) order by index;
SQL

say "8. Worker log tail"
tail -40 /tmp/pc-worker.log | tee -a "$OUT"

sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(https://[a-z0-9]{15,}\.supabase\.co)#[URL]#g' -e 's#postgres(ql)?://[^ "]*#[DB_URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
