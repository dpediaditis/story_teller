#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-tts-code.txt
: > "$OUT"
echo "===== files touching TTS / narration =====" >> "$OUT"
grep -rln "synthesise\|TTS\|narration\|Narration\|audio" services/worker/src >> "$OUT" 2>&1
for f in $(grep -rln "synthesise\|responseModalities\|AUDIO" services/worker/src 2>/dev/null); do
  echo "########## $f ##########" >> "$OUT"
  cat -n "$f" >> "$OUT"
done
echo "===== ffmpeg available? =====" >> "$OUT"
(command -v ffmpeg && ffmpeg -version 2>&1 | head -1) >> "$OUT" 2>&1 || echo "ffmpeg NOT installed" >> "$OUT"
echo "===== afconvert (macOS built-in)? =====" >> "$OUT"
(command -v afconvert && echo present) >> "$OUT" 2>&1 || echo "afconvert not found" >> "$OUT"
echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
