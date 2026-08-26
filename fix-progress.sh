#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
OUT=/tmp/pc-prog.txt
: > "$OUT"
say(){ printf "\n===== %s =====\n" "$1" | tee -a "$OUT"; }

say "1. Current emitProgress"
sed -n '/async emitProgress/,/^    },$/p' services/worker/src/db.ts | cat -n | tee -a "$OUT"

say "2. Make progress advisory — it must never block the pipeline"
python3 - <<'PY' | tee -a "$OUT"
import pathlib
p = pathlib.Path("services/worker/src/db.ts"); s = p.read_text()
if "PROGRESS_EMIT_TIMEOUT_MS" in s:
    print("  already patched"); raise SystemExit

start = s.find("    async emitProgress(event: JobProgressEvent) {")
if start == -1:
    print("  ANCHOR NOT FOUND"); raise SystemExit(1)
# Brace-match to find the end of the method.
i = s.index("{", start); depth = 0
for j in range(i, len(s)):
    if s[j] == "{": depth += 1
    elif s[j] == "}":
        depth -= 1
        if depth == 0: end = j + 1; break
tail = s[end:end+1]
if tail == ",": end += 1

new = '''    async emitProgress(event: JobProgressEvent) {
      // Progress is ADVISORY. The client polls GET jobs/:id every 2s
      // (SLO.jobPollIntervalMs), so a dropped broadcast costs slightly staler
      // progress and nothing else.
      //
      // It must therefore never be able to block the pipeline — and it could.
      // The channel is created but never subscribed, so supabase-js falls back
      // to REST for send(), and removeChannel() then awaits a socket teardown
      // that never resolves for a channel that never connected. Observed live:
      // every job sat at `moderating_input` with no provider call ever made,
      // until the job timeout fired ~100s later and reported a misleading
      // "provider_timeout".
      //
      // Both calls are now bounded, and a failure here is swallowed by design.
      const PROGRESS_EMIT_TIMEOUT_MS = 2_000;
      const bounded = <T>(work: Promise<T>): Promise<T | undefined> =>
        Promise.race([
          work,
          new Promise<undefined>((resolve) =>
            setTimeout(() => resolve(undefined), PROGRESS_EMIT_TIMEOUT_MS),
          ),
        ]);

      try {
        const channel = client.channel(`job:${event.jobId}`);
        await bounded(
          channel.send({ type: 'broadcast', event: 'progress', payload: event }),
        );
        // Not awaited: teardown is housekeeping, and the pipeline owes it nothing.
        void bounded(client.removeChannel(channel)).catch(() => undefined);
      } catch {
        // Deliberately ignored — see above.
      }
    },'''
p.write_text(s[:start] + new + s[end:])
print("  emitProgress is now bounded and non-fatal")
PY
(cd services/worker && npx tsc --noEmit 2>&1 | head -5) | tee -a "$OUT"
(cd services/worker && npx vitest run 2>&1 | tail -3) | tee -a "$OUT"
echo; echo "Wrote $OUT"
