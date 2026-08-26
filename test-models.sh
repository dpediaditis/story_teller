#!/usr/bin/env bash
# Listing a model proves nothing — this actually CALLS each candidate.
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
OUT=/tmp/pc-models.txt
: > "$OUT"
B="https://generativelanguage.googleapis.com/v1beta/models"

echo "===== Every model this key exposes =====" | tee -a "$OUT"
curl -s "$B?key=$GEMINI_API_KEY&pageSize=200" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in sorted(d.get('models',[]), key=lambda x:x['name']):
    print(f\"  {m['name'].replace('models/',''):50} {','.join(m.get('supportedGenerationMethods',[]))}\")
" | tee -a "$OUT"

echo | tee -a "$OUT"
echo "===== Can it actually GENERATE AN IMAGE? =====" | tee -a "$OUT"
for m in gemini-3.5-flash-image gemini-3-pro-image gemini-3.1-flash-image \
         gemini-2.5-flash-image gemini-flash-latest imagen-4.0-generate-001; do
  code=$(curl -s -o /tmp/pc-img.json -w '%{http_code}' \
    -X POST "$B/$m:generateContent?key=$GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"a small purple cartoon monster on white"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}')
  if [ "$code" = "200" ] && grep -q inlineData /tmp/pc-img.json; then
    printf "  IMAGE OK   %s\n" "$m" | tee -a "$OUT"
  else
    printf "  no image   %-34s HTTP %s  %s\n" "$m" "$code" \
      "$(python3 -c "import json;print(json.load(open('/tmp/pc-img.json')).get('error',{}).get('message','')[:70])" 2>/dev/null)" | tee -a "$OUT"
  fi
done

echo | tee -a "$OUT"
echo "===== Can it actually do TTS? =====" | tee -a "$OUT"
for m in gemini-2.5-flash-preview-tts gemini-3.5-flash-tts gemini-3.1-flash-tts; do
  code=$(curl -s -o /tmp/pc-tts.json -w '%{http_code}' \
    -X POST "$B/$m:generateContent?key=$GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"Bobo looked behind the clouds."}]}],"generationConfig":{"responseModalities":["AUDIO"]}}')
  if [ "$code" = "200" ]; then
    MIME=$(python3 -c "
import json
d=json.load(open('/tmp/pc-tts.json'))
try:
  print(d['candidates'][0]['content']['parts'][0]['inlineData']['mimeType'])
except Exception: print('(no inlineData)')" 2>/dev/null)
    printf "  TTS OK     %-34s mimeType=%s\n" "$m" "$MIME" | tee -a "$OUT"
  else
    printf "  no tts     %-34s HTTP %s\n" "$m" "$code" | tee -a "$OUT"
  fi
done

sed -i '' -E 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
