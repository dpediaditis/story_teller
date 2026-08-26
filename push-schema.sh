#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "=== before ==="
PSQL -tA -c "select 'public tables: '||count(*) from information_schema.tables where table_schema='public';"

echo
echo "=== pushing (output live, prompt auto-answered) ==="
# `supabase db push` prompts for confirmation; piping it hides the prompt and
# the command appears to hang. Feed it a yes and do not swallow stdout.
yes | npx --yes supabase db push --db-url "$SUPABASE_DB_URL" 2>&1 | tee /tmp/pc-push.txt | tail -30

echo
echo "=== after ==="
PSQL -tA -c "select 'public tables: '||count(*) from information_schema.tables where table_schema='public';"
PSQL -tA -c "select 'migrations: '||count(*) from supabase_migrations.schema_migrations;" 2>/dev/null
PSQL -tA -c "select 'extensions: '||coalesce(string_agg(extname,', '),'none') from pg_extension where extname in ('pgmq','pg_cron');"
PSQL -tA -c "select string_agg(table_name,', ' order by table_name) from information_schema.tables where table_schema='public';"
