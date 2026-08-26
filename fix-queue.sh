#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -qtA "$@"; }
echo "=== how the worker calls the queue ==="
grep -nE "schema\(|rpc\(|pgmq" services/worker/src/db.ts | head -20
echo
echo "=== apply the wrapper migration ==="
yes | npx --yes supabase db push --db-url "$SUPABASE_DB_URL" 2>&1 | grep -viE "^npm warn" | tail -12
echo
echo "=== wrappers present? ==="
PSQL -c "select 'pgmq_public.'||proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pgmq_public' order by proname;"
echo
echo "=== message still queued? ==="
PSQL -c "select 'messages: '||count(*) from pgmq.q_papercub_generation;"
