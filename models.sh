#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-models.txt
{
echo "===== ALL models on this key ====="
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d.get('models',[]):
    name=m['name'].replace('models/','')
    methods=','.join(m.get('supportedGenerationMethods',[]))
    print(f\"{name:52} {methods}\")
"
} > "$OUT" 2>&1
echo "===== IMAGE-capable =====" >> "$OUT"
grep -iE "image|imagen" "$OUT" | head -20 >> "$OUT"
echo "===== TTS-capable =====" >> "$OUT"
grep -iE "tts|speech|audio" "$OUT" | head -10 >> "$OUT"
sed -i '' -E 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
