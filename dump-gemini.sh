#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-gem.txt
{
echo "===== the HTTP layer in gemini.ts ====="
grep -n "async function post\|fetch(\|throw new Error(\`Gemini\|response.ok\|res.ok\|status" services/worker/src/providers/gemini.ts | head -25
echo
echo "===== post() in full ====="
awk '/async function post/{f=1} f{print NR": "$0} f&&/^  }$/{exit}' services/worker/src/providers/gemini.ts | head -60
echo
echo "===== is the 503 still happening right now? ====="
python3 - <<'PY'
import base64, json, os, urllib.request
key = os.environ["GEMINI_API_KEY"]
img = base64.b64encode(open("/tmp/pc-drawing.png","rb").read()).decode()
for m in ["gemini-3.7-flash","gemini-3.5-flash","gemini-2.5-flash","gemini-3.1-flash-lite"]:
    body = json.dumps({"contents":[{"parts":[
        {"text":"Describe this drawing in one short sentence."},
        {"inlineData":{"mimeType":"image/png","data":img}}]}]}).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}",
        data=body, headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
            txt = d["candidates"][0]["content"]["parts"][0]["text"][:70]
            print(f"  IMAGE-INPUT OK  {m:26} -> {txt}")
    except Exception as e:
        code = getattr(e, "code", "?")
        print(f"  FAILED          {m:26} HTTP {code}")
PY
} > "$OUT" 2>&1
sed -i '' -E 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo "Wrote $OUT"; cat "$OUT"
