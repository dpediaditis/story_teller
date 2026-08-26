#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-build.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. Confirm the pod really is linked"
grep -i papercub apps/mobile/ios/Podfile.lock 2>/dev/null | head | tee -a "$OUT"
ls "apps/mobile/ios/Pods/Local Podspecs" 2>/dev/null | tee -a "$OUT"

say "2. COMPILE THE SWIFT — simulator build, no signing needed"
# This is the first time B4's 1540 lines are put through swiftc.
cd apps/mobile/ios
xcodebuild \
  -workspace Papercub.xcworkspace \
  -scheme Papercub \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -quiet \
  CODE_SIGNING_ALLOWED=NO \
  build 2>&1 | tail -80 | tee -a "$OUT"
BUILD_RC=${PIPESTATUS[0]}
cd ../..
echo "xcodebuild exit code: $BUILD_RC" | tee -a "$OUT"

say "3. Errors only (if any)"
grep -E "error:|warning: .*Papercub|SWIFT" /tmp/pc-build.txt 2>/dev/null | grep -v "^$" | head -40 | tee -a "$OUT"

echo; echo "Wrote $OUT"
