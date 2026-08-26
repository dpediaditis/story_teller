#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"; }

echo "=== actual state ==="
TABLES=$(PSQL -tA -c "select count(*) from information_schema.tables where table_schema='public';" | tr -d ' ')
MIGS=$(PSQL -tA -c "select count(*) from supabase_migrations.schema_migrations;" 2>/dev/null | tr -d ' ')
echo "  public tables:      ${TABLES:-?}"
echo "  migrations recorded: ${MIGS:-0}"
echo "  local migration files: $(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')"

if [ "${TABLES:-0}" -ge 15 ]; then
  echo "  -> schema is present. Nothing to repair."
  PSQL -tA -c "select string_agg(table_name,', ' order by table_name) from information_schema.tables where table_schema='public';"
  exit 0
fi

echo
echo "=== repairing: history claims applied, tables absent ==="
# The first push (over the transaction pooler) recorded rows before stalling, so
# the CLI now short-circuits with "up to date". Clear the history so the
# migrations actually run. Safe here: there are no tables and therefore no data.
PSQL -tA -c "delete from supabase_migrations.schema_migrations;" 2>&1 | tail -2
echo "  history cleared"

echo
echo "=== pushing for real (live output) ==="
yes | npx --yes supabase db push --db-url "$SUPABASE_DB_URL" 2>&1 | tee /tmp/pc-push2.txt | grep -viE "^npm warn" | tail -40

echo
echo "=== after ==="
PSQL -tA -c "select 'public tables: '||count(*) from information_schema.tables where table_schema='public';"
PSQL -tA -c "select 'migrations: '||count(*) from supabase_migrations.schema_migrations;" 2>/dev/null
PSQL -tA -c "select 'extensions: '||coalesce(string_agg(extname,', '),'NONE') from pg_extension where extname in ('pgmq','pg_cron');"
PSQL -tA -c "select 'rls-enabled tables: '||count(*) from pg_tables t join pg_class c on c.relname=t.tablename where t.schemaname='public' and c.relrowsecurity;"
PSQL -tA -c "select string_agg(table_name,', ' order by table_name) from information_schema.tables where table_schema='public';"
