#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
echo "=== where does timeoutMs come from? ==="
grep -rn "timeoutMs\|TIMEOUT\|timeout" services/worker/src/providers/gemini.ts services/worker/src/config.ts services/worker/src/providers/index.ts 2>/dev/null | grep -viE "visibility|queue|poll" | head -20
echo
echo "=== which model does moderation use? ==="
grep -n "opts.textModel\|opts.visionModel\|classify\|moderat" services/worker/src/providers/gemini.ts | head -15
