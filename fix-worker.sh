#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-worker-fix.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }
set -a; . ./.env; set +a

say "1. Make empty env vars mean 'absent'"
python3 - <<'PY' | tee -a "$OUT"
p = "services/worker/src/config.ts"
s = open(p, encoding="utf-8").read()
if "emptyAsUndefined" in s:
    print("already patched"); raise SystemExit
anchor = "const Env = z.object({"
if anchor not in s:
    import re
    m = re.search(r"const \w+ = z\.object\(\{", s)
    if not m: print("ANCHOR NOT FOUND"); raise SystemExit(1)
    anchor = m.group(0)
helper = '''/**
 * A .env file writes an unset key as `KEY=`, which arrives as '' — and zod's
 * `.optional()` accepts *absent*, not *empty*. Without this the worker refuses
 * to boot whenever an optional provider key is left blank, which is the normal
 * state for OPENAI_API_KEY and REVENUECAT_SECRET_API_KEY.
 */
const emptyAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

'''
s = s.replace(anchor, helper + anchor, 1)
# Wrap every optional field so '' is treated as absent.
import re
def wrap(m):
    return f"{m.group(1)}: z.preprocess(emptyAsUndefined, {m.group(2)})"
s2, n = re.subn(r"(\b[A-Z][A-Z0-9_]*)\s*:\s*(z\.[^,\n]*\.optional\(\))", wrap, s)
open(p, "w", encoding="utf-8").write(s2)
print(f"patched {n} optional field(s)")
PY

say "2. Image + TTS models actually available"
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
| python3 -c "
import json,sys
d=json.load(sys.stdin)
rows=[(m['name'].replace('models/',''), ','.join(m.get('supportedGenerationMethods',[]))) for m in d.get('models',[])]
print('--- IMAGE ---')
for n,me in rows:
    if 'image' in n or 'imagen' in n or 'predict' in me: print(f'  {n:48} {me}')
print('--- TTS / AUDIO ---')
for n,me in rows:
    if 'tts' in n or 'audio' in n or 'speech' in n: print(f'  {n:48} {me}')
print('--- TEXT (flash/pro) ---')
for n,me in rows:
    if ('flash' in n or 'pro' in n) and 'image' not in n and 'tts' not in n: print(f'  {n:48} {me}')
" | tee -a "$OUT"

say "3. Worker boots now?"
export EXPO_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY
(cd services/worker && timeout 25 npx tsx src/index.ts 2>&1 | head -20) | tee -a "$OUT" \
  || (cd services/worker && npx tsx src/index.ts > /tmp/pc-boot.log 2>&1 & sleep 20; kill %1 2>/dev/null; head -20 /tmp/pc-boot.log | tee -a "$OUT")

sed -i '' -E -e 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' -e 's/(eyJ[A-Za-z0-9_.-]{10,})/[REDACTED]/g' \
  -e 's#postgres(ql)?://[^ "]*#[DB_URL]#g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
