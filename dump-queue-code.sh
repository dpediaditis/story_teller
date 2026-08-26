#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-qcode.txt
{
echo "===== how the worker reads/deletes the queue ====="
grep -n "pgmq\|schema(\|queue_name\|msg_id\|readMessages\|deleteMessage\|archive" services/worker/src/db.ts | head -40
echo
echo "===== the surrounding functions ====="
awk '/pgmq|schema\(/{found=1} found' services/worker/src/db.ts | head -80
echo
echo "===== apply the public-schema wrappers ====="
yes | npx --yes supabase db push --db-url "$SUPABASE_DB_URL" 2>&1 | grep -viE "^npm warn" | tail -10
echo
echo "===== callable over PostgREST now? ====="
curl -s -o /tmp/pc-qr.json -w 'HTTP %{http_code}\n' \
  -X POST "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/rpc/queue_read" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"queue_name":"papercub_generation","visibility_seconds":1,"batch_size":1}'
head -c 300 /tmp/pc-qr.json; echo
} > "$OUT" 2>&1
sed -i '' -E -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' -e 's#https://[a-z0-9]{15,}\.supabase\.co#[URL]#g' "$OUT" 2>/dev/null
echo "Wrote $OUT"
