#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-native.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" >> "$OUT"; }

say "1. Does autolinking see the module at all?"
(cd apps/mobile && npx expo-modules-autolinking search 2>&1 | head -40) >> "$OUT" 2>&1
echo "--- grep for papercub ---" >> "$OUT"
(cd apps/mobile && npx expo-modules-autolinking search 2>&1 | grep -i papercub) >> "$OUT" 2>&1 || echo "NOT DISCOVERED" >> "$OUT"

say "2. Package files that make it discoverable"
echo "--- expo-module.config.json ---" >> "$OUT"
cat packages/vision-module/expo-module.config.json >> "$OUT" 2>&1
echo "--- package.json ---" >> "$OUT"
cat packages/vision-module/package.json >> "$OUT" 2>&1
echo "--- app.plugin.js ---" >> "$OUT"
cat packages/vision-module/app.plugin.js >> "$OUT" 2>&1
echo "--- podspec ---" >> "$OUT"
cat packages/vision-module/ios/PapercubVision.podspec >> "$OUT" 2>&1
echo "--- ios/ contents ---" >> "$OUT"
ls -la packages/vision-module/ios >> "$OUT" 2>&1

say "3. Is it linked from the app's node_modules?"
ls -la apps/mobile/node_modules/@papercub 2>&1 >> "$OUT"
ls -la node_modules/@papercub 2>&1 >> "$OUT"

say "4. Pods actually installed (expo ones)"
ls apps/mobile/ios/Pods 2>/dev/null | grep -i "^Expo\|^React" | head -25 >> "$OUT"
echo "--- total pods: $(ls apps/mobile/ios/Pods 2>/dev/null | wc -l) ---" >> "$OUT"
echo "--- Podfile ---" >> "$OUT"
cat apps/mobile/ios/Podfile >> "$OUT" 2>&1

say "5. Autolinking manifest generated during prebuild"
find apps/mobile/ios -name "*autolinking*" -o -name ".xcode.env*" 2>/dev/null | head >> "$OUT"
cat apps/mobile/ios/Pods/Target\ Support\ Files/Pods-Papercub/ExpoModulesProvider.swift 2>/dev/null | head -40 >> "$OUT"

echo "Wrote $OUT"
