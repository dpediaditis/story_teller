#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-dburl.txt
: > "$OUT"
set -a; . ./.env; set +a
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

# Supabase offers three connection strings and they are NOT interchangeable:
#   direct           db.<ref>.supabase.co:5432          IPv6 only   DDL ok
#   session pooler   <region>.pooler.supabase.com:5432  IPv4        DDL ok  <- what we need
#   transaction      <region>.pooler.supabase.com:6543  IPv4        DDL NOT ok
REF=$(echo "$SUPABASE_DB_URL" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
PW=$(echo "$SUPABASE_DB_URL"  | sed -nE 's#.*://[^:]+:([^@]*)@.*#\1#p')
[ -n "$REF" ] || { echo "could not parse project ref from SUPABASE_DB_URL" | tee -a "$OUT"; exit 1; }
echo "project ref: $REF" | tee -a "$OUT"

say "Which host actually answers on IPv4?"
BEST=""
for REGION in eu-west-1 eu-central-1 eu-central-2 us-east-1 us-west-1 ap-southeast-1; do
  for N in 0 1 2; do
    H="aws-$N-$REGION.pooler.supabase.com"
    getent hosts "$H" >/dev/null 2>&1 || host "$H" >/dev/null 2>&1 || continue
    URL="postgresql://postgres.$REF:$PW@$H:5432/postgres"
    if docker run --rm -i postgres:16 psql "$URL" -tAc "select 1;" >/dev/null 2>&1; then
      echo "  WORKS  $H:5432 (session pooler)" | tee -a "$OUT"; BEST="$URL"; break 2
    fi
  done
done

if [ -z "$BEST" ]; then
  echo "  no session pooler responded — get the exact string from the dashboard:" | tee -a "$OUT"
  echo "  Settings -> Database -> Connection string -> Session pooler" | tee -a "$OUT"
  exit 1
fi

say "Point SUPABASE_DB_URL at it"
python3 - "$BEST" <<'PY' | tee -a "$OUT"
import sys, re
url = sys.argv[1]
s = open(".env", encoding="utf-8").read()
s = re.sub(r"^SUPABASE_DB_URL=.*$", "SUPABASE_DB_URL=" + url, s, count=1, flags=re.M)
if "SUPABASE_DB_URL=" not in s:
    s += f"\nSUPABASE_DB_URL={url}\n"
open(".env", "w", encoding="utf-8").write(s)
print("  .env updated (session pooler, IPv4, DDL-capable)")
PY

say "Verify"
docker run --rm -i postgres:16 psql "$BEST" -tAc "select 'connected as '||current_user;" 2>&1 | head -3 | tee -a "$OUT"
docker run --rm -i postgres:16 psql "$BEST" -tAc "select 'public tables: '||count(*) from information_schema.tables where table_schema='public';" 2>&1 | head -3 | tee -a "$OUT"

sed -i '' -E -e 's#(://[^:]+:)[^@]*@#\1***@#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
