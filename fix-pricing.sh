#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-pricing.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "0. The current price table"
sed -n '1,90p' services/worker/src/providers/pricing.ts | cat -n | tee -a "$OUT"

say "1. Who asks for gemini-3.7-flash?"
grep -rn "3\.7-flash\|3_7\|textModel\|visionModel" services/worker/src/providers/index.ts services/worker/src/config.ts 2>/dev/null | head -20 | tee -a "$OUT"
echo "--- .env model lines ---" | tee -a "$OUT"
grep -n "GEMINI_.*MODEL" .env | tee -a "$OUT"
echo "--- config.ts defaults ---" | tee -a "$OUT"
grep -n "GEMINI_.*MODEL.*default" services/worker/src/config.ts | tee -a "$OUT"

say "2. Restore the timeout I wrongly lowered"
python3 - <<'PY' | tee -a "$OUT"
import re, pathlib
p = pathlib.Path("services/worker/src/providers/gemini.ts"); s = p.read_text()
s2 = re.sub(r"(const DEFAULT_TIMEOUT_MS\s*=\s*)90_000", r"\g<1>120_000", s)
p.write_text(s2)
print("  DEFAULT_TIMEOUT_MS back to 120_000 (it was never the problem)")
PY
echo; echo "Wrote $OUT"
