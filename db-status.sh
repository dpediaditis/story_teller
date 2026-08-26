#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-status.txt
PSQL(){ docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -tAc "$1" 2>&1; }
{
echo "public tables:       $(PSQL "select count(*) from information_schema.tables where table_schema='public';")"
echo "migrations recorded: $(PSQL "select count(*) from supabase_migrations.schema_migrations;")"
echo "local .sql files:    $(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')"
echo "rls-enabled tables:  $(PSQL "select count(*) from pg_tables t join pg_class c on c.relname=t.tablename and c.relnamespace='public'::regnamespace where t.schemaname='public' and c.relrowsecurity;")"
echo "extensions:          $(PSQL "select coalesce(string_agg(extname,', '),'NONE') from pg_extension where extname in ('pgmq','pg_cron');")"
echo "storage buckets:     $(PSQL "select coalesce(string_agg(name,', '),'NONE') from storage.buckets;")"
echo "pgmq queues:         $(PSQL "select coalesce(string_agg(queue_name,', '),'NONE') from pgmq.list_queues();")"
echo "definer functions:   $(PSQL "select coalesce(string_agg(proname,', ' order by proname),'NONE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;")"
echo
echo "tables:"
PSQL "select '  '||table_name from information_schema.tables where table_schema='public' order by table_name;"
} > "$OUT" 2>&1
sed -i '' -E 's#(://[^:]+:)[^@]*@#\1***@#g' "$OUT" 2>/dev/null
cat "$OUT"; echo; echo "(also at $OUT)"
