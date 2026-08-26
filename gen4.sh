#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-gen4.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
die(){ printf "\nSTOPPED: %s\n" "$1" | tee -a "$OUT"; exit 1; }
set -a; . ./.env; set +a
# -q suppresses the "INSERT 0 1" command tag that swallowed the UUID last run.
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA -v ON_ERROR_STOP=1 "$@"; }
UUID(){ grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

say "1. Seed"
python3 > /tmp/pc-drawing.png <<'PY'
import zlib,struct,sys
W=H=512
px=[[(255,255,255) for _ in range(W)] for _ in range(H)]
def disc(cx,cy,r,c):
    for y in range(max(0,cy-r),min(H,cy+r)):
        for x in range(max(0,cx-r),min(W,cx+r)):
            if (x-cx)**2+(y-cy)**2<=r*r: px[y][x]=c
V=(123,79,196); D=(40,30,60); Wt=(255,255,255)
disc(256,270,120,V); disc(210,240,34,Wt); disc(300,248,26,Wt)
disc(214,244,14,D); disc(303,251,11,D)
for i in range(60): disc(200+i,340+int((i-30)**2/45),7,D)
for hx,hy in ((190,165),(256,150),(322,168)):
    for t in range(46): disc(hx+int(t*0.25),hy+t,max(3,11-t//5),V)
for t in range(70): disc(140+t//3,300+t,6,V); disc(372-t//3,300+t,6,V)
raw=b''.join(b'\x00'+bytes(v for p in row for v in p) for row in px)
def ck(t,d):
    c=t+d; return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
sys.stdout.buffer.write(b'\x89PNG\r\n\x1a\n'+ck(b'IHDR',struct.pack('>IIBBBBB',W,H,8,2,0,0,0))+ck(b'IDAT',zlib.compress(raw,6))+ck(b'IEND',b''))
PY

PARENT=$(PSQL -c "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated','e2e-'||substr(md5(random()::text),1,8)||'@papercub.test','',now(),now(),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',false) returning id;" | UUID)
[ -n "$PARENT" ] || die "auth user insert failed"
echo "parent: $PARENT" | tee -a "$OUT"

KEY="drawings/$PARENT/e2e/cutout.png"
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/storage/v1/object/$KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: image/png" \
  --data-binary @/tmp/pc-drawing.png -w "  cutout upload HTTP %{http_code}\n" -o /tmp/pc-up.json | tee -a "$OUT"

PSQL -v parent="$PARENT" -v key="$KEY" <<'SQL' 2>&1 | tee -a "$OUT"
do $$
declare c uuid; d uuid; ch uuid; res jsonb;
begin
  insert into public.child_profiles (parent_id, display_name, age_band)
    values (:'parent','Mia','6_7') returning id into c;
  insert into public.original_drawings (child_id,cutout_storage_key,captured_at,source,retention_policy,
    exif_stripped,isolation_method,isolation_confidence,face_detected,text_detected,width_px,height_px)
    values (c,:'key',now(),'camera','delete_after_cutout',true,'vision_subject_lift',0.93,false,false,512,512)
    returning id into d;
  insert into public.characters (child_id,drawing_id,name,character_type,personality_traits,palette,feature_anchor,status)
    values (c,d,'Bobo','monster',array['funny','brave'],array['#7b4fc4'],
      'a purple monster with three horns and two differently sized eyes','ready') returning id into ch;
  insert into public.character_assets (character_id,kind,storage_key,version,is_primary,width_px,height_px)
    values (ch,'cutout',:'key',1,true,512,512);
  perform set_config('request.jwt.claims', json_build_object('sub',:'parent','role','authenticated')::text, true);
  res := public.claim_story_quota(c,array[ch],'space','funny','short','cutout_rerender','e2e',
    'e2e-'||substr(md5(random()::text),1,10));
  raise notice 'claim -> %', res;
end $$;
SQL
echo "queued: $(PSQL -c 'select count(*) from pgmq.q_papercub_generation;')" | tee -a "$OUT"

say "2. Worker"
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

say "3. RESULT"
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

say "4. Worker log"
tail -30 /tmp/pc-worker.log | tee -a "$OUT"
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' \
  -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
