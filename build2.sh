#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-build2.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. Correct the stale expo-av comment"
python3 - <<'PY' | tee -a "$OUT"
p = "apps/mobile/src/features/reader/ReaderScreen.tsx"
s = open(p, encoding="utf-8").read()
old = " * wiring `expo-av` to a real file is a one-line swap once B2 exists."
new = " * wiring `expo-audio` (useAudioPlayer) to a real file is the remaining step\n * once the worker produces narration."
if old in s:
    open(p, "w", encoding="utf-8").write(s.replace(old, new))
    print("comment updated")
else:
    print("anchor not found — left alone")
PY

say "2. Regenerate native project without expo-av"
(cd apps/mobile && npx expo prebuild --platform ios --clean 2>&1 | tail -12) | tee -a "$OUT"

say "3. Confirm EXAV is gone and PapercubVision is still linked"
grep -c "EXAV" apps/mobile/ios/Podfile.lock 2>/dev/null | sed 's/^/EXAV refs: /' | tee -a "$OUT"
grep -i papercub apps/mobile/ios/Podfile.lock 2>/dev/null | head -3 | tee -a "$OUT"

say "4. COMPILE — this is the run that tests our Swift"
cd apps/mobile/ios
set -o pipefail
xcodebuild \
  -workspace Papercub.xcworkspace \
  -scheme Papercub \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -quiet \
  CODE_SIGNING_ALLOWED=NO \
  build > /tmp/pc-xcode-raw.txt 2>&1
RC=$?
cd ../..
echo "xcodebuild exit code: $RC" | tee -a "$OUT"

say "5. Errors (if any)"
grep -E "error:" /tmp/pc-xcode-raw.txt | head -30 | tee -a "$OUT"
echo "--- total error lines: $(grep -cE 'error:' /tmp/pc-xcode-raw.txt) ---" | tee -a "$OUT"

say "6. Anything mentioning our own Swift files"
grep -E "vision-module|PapercubVision|IsolationPipeline|SubjectLift|InkExtractor|PaperNormaliser|PrivacyScan|PrivateImageIO|ImageStats|CaptureGuidance" /tmp/pc-xcode-raw.txt \
  | grep -iE "error|warning" | head -25 | tee -a "$OUT"
echo "(nothing above = our Swift is clean)" | tee -a "$OUT"

echo; echo "Wrote $OUT  (full log: /tmp/pc-xcode-raw.txt)"
