#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-db.txt
: > "$OUT"
set -a; . ./.env; set +a

{
echo "===== connection shape (password masked) ====="
echo "$SUPABASE_DB_URL" | sed -E 's#(://[^:]+:)[^@]*@#\1***@#'
case "$SUPABASE_DB_URL" in
  *6543*) echo "  -> POOLER (port 6543). Migrations need the DIRECT url on 5432.";;
  *5432*) echo "  -> direct (5432) — correct for migrations";;
  *)      echo "  -> unrecognised port";;
esac

echo; echo "===== can docker psql connect at all? ====="
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -tAc "select 'connected as '||current_user||' to '||current_database();" 2>&1 | head -8

echo; echo "===== is the schema there? ====="
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -tAc "select 'public tables: '||count(*) from information_schema.tables where table_schema='public';" 2>&1 | head -4
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -tAc "select string_agg(table_name,', ' order by table_name) from information_schema.tables where table_schema='public';" 2>&1 | head -4

echo; echo "===== can we write to auth.users? (the step that failed) ====="
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -tAc "
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_anonymous)
values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated',
  'diag-'||substr(md5(random()::text),1,8)||'@papercub.test','',now(),now(),now(),
  '{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',false) returning id;" 2>&1 | head -12

echo; echo "===== pgmq present? ====="
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -tAc "select extname from pg_extension where extname in ('pgmq','pg_cron');" 2>&1 | head -4

echo; echo "===== migration history ====="
docker run --rm -i postgres:16 psql "$SUPABASE_DB_URL" -tAc "select count(*)||' migrations applied' from supabase_migrations.schema_migrations;" 2>&1 | head -4
} > "$OUT" 2>&1

sed -i '' -E -e 's#(://[^:]+:)[^@]*@#\1***@#g' -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo "Wrote $OUT"; cat "$OUT"
