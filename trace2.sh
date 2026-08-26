#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-trace2.txt
: > "$OUT"
{
echo "===== pipeline/story.ts — the first 70 lines ====="
sed -n '1,70p' services/worker/src/pipeline/story.ts | cat -n

echo
echo "===== everything db.ts exposes ====="
grep -nE "^\s{2}async [a-zA-Z]+\(|^\s{2}[a-zA-Z]+\(|^export (async )?function" services/worker/src/db.ts | head -40

echo
echo "===== the progress / realtime emit path ====="
grep -n "channel\|broadcast\|realtime\|emit\|progress\|send(" services/worker/src/db.ts | head -25

echo
echo "===== runner: what wraps a stage transition ====="
grep -n "setStage\|updateJob\|stage\|emitProgress" services/worker/src/runner.ts | head -25
} > "$OUT" 2>&1
echo "Wrote $OUT"
