#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-av.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. Where is expo-av used?"
grep -rn "expo-av\|from 'expo-av'\|Audio\.\|Sound\b" apps/mobile/src apps/mobile/app 2>/dev/null \
  | grep -v node_modules | head -30 | tee -a "$OUT"
echo "--- files importing expo-av ---" | tee -a "$OUT"
grep -rl "expo-av" apps/mobile/src apps/mobile/app 2>/dev/null | tee -a "$OUT" || echo "NONE" | tee -a "$OUT"

say "2. Full contents of each file that imports it"
for f in $(grep -rl "expo-av" apps/mobile/src apps/mobile/app 2>/dev/null); do
  echo "########## $f ##########" | tee -a "$OUT"
  cat -n "$f" | tee -a "$OUT"
done

say "3. Swap expo-av -> expo-audio"
pnpm --filter @papercub/mobile remove expo-av 2>&1 | tail -4 | tee -a "$OUT"
pnpm --filter @papercub/mobile add expo-audio 2>&1 | tail -4 | tee -a "$OUT"

say "4. Installed audio packages"
node -p "Object.entries(require('./apps/mobile/package.json').dependencies).filter(([k])=>/audio|av$/.test(k)).map(([k,v])=>k+' '+v).join('\n')||'none'" 2>&1 | tee -a "$OUT"

echo; echo "Wrote $OUT"
