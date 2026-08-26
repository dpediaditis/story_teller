#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-p2.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. What keys are actually in PRICE_TABLE?"
grep -oE "^\s+'[a-z0-9.-]+':" services/worker/src/providers/pricing.ts | tr -d " ':" | sort | tee -a "$OUT"

say "2. What models will the worker actually use?"
set -a; . ./.env; set +a
for v in GEMINI_TEXT_MODEL GEMINI_VISION_MODEL GEMINI_IMAGE_MODEL_PREMIUM GEMINI_IMAGE_MODEL_FAST GEMINI_TTS_MODEL; do
  echo "  $v = ${!v:-(unset -> config.ts default)}" | tee -a "$OUT"
done
echo "  --- config.ts defaults ---" | tee -a "$OUT"
grep -E "GEMINI_.*MODEL.*default" services/worker/src/config.ts | sed 's/^/  /' | tee -a "$OUT"

say "3. Add every model that is missing a price"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re
p = pathlib.Path("services/worker/src/providers/pricing.ts"); s = p.read_text()
have = set(re.findall(r"^\s+'([a-z0-9.\-]+)':", s, re.M))

# Text prices in cents per 1M tokens; images in cents each; speech per 1M chars.
# Researched, NOT invoiced — DECISIONS.md §14 item 1 still applies.
want = {
  "gemini-3.7-flash":            "    provider: 'google',\n    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },",
  "gemini-3.6-flash":            "    provider: 'google',\n    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },",
  "gemini-3.5-flash":            "    provider: 'google',\n    text: { inputCentsPerMTok: 150, outputCentsPerMTok: 900 },",
  "gemini-3.5-flash-lite":       "    provider: 'google',\n    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },",
  "gemini-3.1-flash-lite":       "    provider: 'google',\n    text: { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },",
  "gemini-3.1-flash":            "    provider: 'google',\n    text: { inputCentsPerMTok: 75, outputCentsPerMTok: 375 },",
  "gemini-3.1-flash-image":      "    provider: 'google',\n    image: { centsPerImage: 6.7 },",
  "gemini-3.1-flash-lite-image": "    provider: 'google',\n    image: { centsPerImage: 3.36 },",
  "gemini-3-pro-image":          "    provider: 'google',\n    image: { centsPerImage: 13.4 },",
  "gemini-3.1-flash-tts-preview":"    provider: 'google',\n    speech: { centsPerMChar: 1000 },",
  "gemini-2.5-pro-preview-tts":  "    provider: 'google',\n    speech: { centsPerMChar: 1000 },",
}
missing = {k: v for k, v in want.items() if k not in have}
if not missing:
    print("  nothing missing"); raise SystemExit

block = "".join(f"  '{k}': {{\n{v}\n  }},\n" for k, v in missing.items())
anchor = "  /* ── OpenAI (second provider, dark) ─────────────────────────────────── */"
if anchor not in s:
    anchor = "};"
    s = s.replace(anchor, block + anchor, 1)
else:
    s = s.replace(anchor, block + anchor, 1)
p.write_text(s)
print(f"  added: {', '.join(sorted(missing))}")
PY

say "4. Verify every configured model now has a price"
python3 - <<'PY' | tee -a "$OUT"
import pathlib, re, os
s = pathlib.Path("services/worker/src/providers/pricing.ts").read_text()
have = set(re.findall(r"^\s+'([a-z0-9.\-]+)':", s, re.M))
env = {}
for line in pathlib.Path(".env").read_text().splitlines():
    line = line.strip()
    if line.startswith("GEMINI_") and "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip()
cfg = pathlib.Path("services/worker/src/config.ts").read_text()
for k, v in re.findall(r"(GEMINI_[A-Z_]*MODEL[A-Z_]*):\s*z\.string\(\)\.default\('([^']+)'\)", cfg):
    env.setdefault(k, v)
    # config default is the fallback; check BOTH, since either can be in play
    d = v
    print(f"  {k:32} env={env.get(k,'-'):30} default={d:30} "
          f"{'OK' if env.get(k, d) in have and d in have else 'MISSING PRICE'}")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -4) | tee -a "$OUT"
echo; echo "Wrote $OUT"
