#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-audio.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "Patch: PCM -> WAV, exact duration, format-aware extension"
python3 - <<'PY' | tee -a "$OUT"
import re, sys
ok = True
def patch(path, pairs, label):
    global ok
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            print(f"  MISS  {label}: anchor not found -> {old[:60]!r}"); ok = False; return
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write(s)
    print(f"  OK    {label}")

# 1. The interface must carry the format; the pipeline cannot guess it.
patch("services/worker/src/providers/types.ts", [(
 "}): Promise<WithUsage<{ audioBytes: Uint8Array; durationMs: number }>>;",
 "}): Promise<WithUsage<{ audioBytes: Uint8Array; durationMs: number; mimeType: string }>>;"
)], "types.ts SpeechSynthesizer")

# 2. Gemini: wrap PCM in a WAV container and compute the real duration.
helper = '''
/**
 * Gemini TTS returns HEADERLESS 16-bit little-endian PCM
 * (audio/L16;codec=pcm;rate=24000), not a container format. Writing those bytes
 * to a .mp3 produces a file no player will open — confirmed against the live
 * API, and previously shipped as exactly that bug.
 *
 * A 44-byte RIFF header makes it playable everywhere with no encoder
 * dependency. The cost is size: 24kHz/16-bit mono is ~2.9 MB per minute, so a
 * 3-minute story is ~8.6 MB against the ~1.4 MB the storage model assumed.
 * Converting to AAC needs ffmpeg in the worker image — tracked in DECISIONS.md.
 */
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BYTES_PER_SAMPLE = 2;

function pcmToWav(pcm: Uint8Array, sampleRate = PCM_SAMPLE_RATE): Uint8Array {
  const byteRate = sampleRate * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const tag = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[off + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);            // PCM fmt chunk size
  view.setUint16(20, 1, true);             // format = PCM
  view.setUint16(22, PCM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, PCM_CHANNELS * PCM_BYTES_PER_SAMPLE, true);
  view.setUint16(34, PCM_BYTES_PER_SAMPLE * 8, true);
  tag(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}
'''
patch("services/worker/src/providers/gemini.ts", [
 ("  const speech: SpeechSynthesizer = {", helper + "\n  const speech: SpeechSynthesizer = {"),
 ("      const audioBytes = firstInlineImage(response);\n\n      // Speech is billed per character of input.",
  "      const pcm = firstInlineImage(response);\n"
  "      const audioBytes = pcmToWav(pcm);\n\n"
  "      // Speech is billed per character of input."),
 ("      // Duration is not reported by the API. Estimated from a typical narration\n"
  "      // rate — it drives a progress bar, never money.\n"
  "      const durationMs = Math.round((toSpeak.length / 14) * 1000);\n\n"
  "      return { value: { audioBytes, durationMs }, usage };",
  "      // PCM duration is exact: bytes / (rate * channels * bytesPerSample).\n"
  "      // The previous estimate from text length drifts, which would desync the\n"
  "      // reader's sentence highlighting from the audio.\n"
  "      const durationMs = Math.round(\n"
  "        (pcm.byteLength / (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE)) * 1000,\n"
  "      );\n\n"
  "      return { value: { audioBytes, durationMs, mimeType: 'audio/wav' }, usage };"),
], "gemini.ts synthesise")

# 3. OpenAI genuinely returns mp3 — say so rather than let the pipeline assume.
s = open("services/worker/src/providers/openai.ts", encoding='utf-8').read()
s2 = s.replace(
 "return { value: { audioBytes, durationMs: Math.round((toSpeak.length / 14) * 1000) }, usage };",
 "return {\n        value: {\n          audioBytes,\n          durationMs: Math.round((toSpeak.length / 14) * 1000),\n          mimeType: 'audio/mpeg',\n        },\n        usage,\n      };", 1)
if s2 != s:
    open("services/worker/src/providers/openai.ts", 'w', encoding='utf-8').write(s2); print("  OK    openai.ts")
else:
    print("  MISS  openai.ts"); ok = False

# 4. Extension follows the provider's actual format.
EXT = ("    ext: speech.value.mimeType === 'audio/wav' ? 'wav' : 'mp3',")
for f in ("services/worker/src/pipeline/narration.ts", "services/worker/src/pipeline/story.ts"):
    s = open(f, encoding='utf-8').read()
    if "    ext: 'mp3'," not in s:
        print(f"  MISS  {f}"); ok = False; continue
    open(f, 'w', encoding='utf-8').write(s.replace("    ext: 'mp3',", EXT, 1))
    print(f"  OK    {f}")

# 5. Fakes must satisfy the widened interface.
s = open("services/worker/src/testing/fakes.ts", encoding='utf-8').read()
s2 = s.replace("value: { audioBytes: new Uint8Array([7, 7]), durationMs: 30_000 },",
               "value: { audioBytes: new Uint8Array([7, 7]), durationMs: 30_000, mimeType: 'audio/wav' },", 1)
if s2 != s:
    open("services/worker/src/testing/fakes.ts", 'w', encoding='utf-8').write(s2); print("  OK    fakes.ts")
else:
    print("  MISS  fakes.ts"); ok = False

sys.exit(0 if ok else 1)
PY

say "Typecheck + tests"
pnpm -r typecheck 2>&1 | tail -12 | tee -a "$OUT"
(cd services/worker && npx vitest run 2>&1 | tail -6) | tee -a "$OUT"

say "Image generation unblocked now?"
set -a; . ./.env; set +a
for m in gemini-2.5-flash-image gemini-3.1-flash-image gemini-3-pro-image; do
  code=$(curl -s -o /tmp/pc-i.json -w '%{http_code}' \
    -X POST "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent?key=$GEMINI_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"contents":[{"parts":[{"text":"a small purple cartoon monster"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}')
  grep -q inlineData /tmp/pc-i.json 2>/dev/null && echo "  IMAGE OK  $m" | tee -a "$OUT" \
    || echo "  blocked   $m  HTTP $code  $(python3 -c "import json;print(json.load(open('/tmp/pc-i.json')).get('error',{}).get('message','')[:60])" 2>/dev/null)" | tee -a "$OUT"
done

sed -i '' -E 's/(AIza[A-Za-z0-9_-]{10,})/[REDACTED]/g' "$OUT" 2>/dev/null
echo; echo "Wrote $OUT"
