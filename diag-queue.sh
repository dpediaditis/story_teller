#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-queue.txt
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
{
echo "=== 1. Did the wrapper migration apply? ==="
echo "pgmq_public functions: $(PSQL -c "select coalesce(string_agg(proname,', ' order by proname),'NONE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pgmq_public';")"
echo "migrations recorded:   $(PSQL -c 'select count(*) from supabase_migrations.schema_migrations;')"
echo "local .sql files:      $(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"

echo
echo "=== 2. Message still in the queue? ==="
echo "messages: $(PSQL -c 'select count(*) from pgmq.q_papercub_generation;')"

echo
echo "=== 3. Can PostgREST reach pgmq_public? (the actual question) ==="
code=$(curl -s -o /tmp/pc-q.json -w '%{http_code}' \
  -X POST "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/rpc/read" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Profile: pgmq_public" -H "Accept-Profile: pgmq_public" \
  -H "Content-Type: application/json" \
  -d '{"queue_name":"papercub_generation","sleep_seconds":1,"n":1}')
echo "HTTP $code"
head -c 400 /tmp/pc-q.json; echo
case "$code" in
  200) echo "  -> pgmq_public IS exposed and callable. Worker should work.";;
  404) echo "  -> schema not exposed. Dashboard -> Settings -> API -> Exposed schemas -> add pgmq_public";;
  *)   echo "  -> see the error body above";;
esac

echo
echo "=== 4. What schemas ARE exposed? ==="
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  | head -c 300; echo
} > "$OUT" 2>&1
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
cat "$OUT"
