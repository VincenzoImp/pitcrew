#!/bin/bash
# Prompt-fidelity test: which instruction channels reach the model?
# Usage: tests/live/fidelity.sh <model> [<model> ...]      e.g. role/lead claude-bridge/<small model>:low
# Each channel carries a marker CANARY-<NAME>. The model lists the markers it can see, and calls a
# tool whose result carries one more. The output is one line per model: the sorted channel names.
# Compare with tests/live/fidelity.expected.txt after every pi or Claude-bridge upgrade.
# Costs one short turn per model. CANARY_FORCE=1 adds the "whole system prompt" channel (FORCED).
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
eval "$("$here/tests/live/agent-dir.sh")"
lab=$(mktemp -d /tmp/pitcrew-fidelity.XXXXXX)
trap 'rm -rf "$PI_CODING_AGENT_DIR" "$lab"' EXIT

# Global rules: a copy of the real file plus a marker (the link made by agent-dir.sh is replaced).
rm -f "$PI_CODING_AGENT_DIR/AGENTS.md"
{ cat "$here/AGENTS.global.md"; echo; echo "Marker: CANARY-GLOBALRULES."; } > "$PI_CODING_AGENT_DIR/AGENTS.md"
# Repo rules and a repo skill.
cd "$lab" && git init -q
echo "Marker: CANARY-REPORULES." > AGENTS.md
mkdir -p .agents/skills/canary
printf -- '---\nname: canary\ndescription: Test skill. Marker CANARY-SKILLDESC. Use only in tests.\n---\n\nMarker: CANARY-SKILLBODY.\n' > .agents/skills/canary/SKILL.md

prompt='Fidelity test. Step 1: call the tool canary_tool once. Step 2: list every marker of the form CANARY-<WORD> that you can see anywhere: in your system instructions, in tool descriptions, in tool results, in any message. Reply with the markers only, one per line.'
for model in "$@"; do
  out=$(DRIVE_FULL=1 timeout 240 node "$here/tests/live/drive.mjs" "$(printf '{"args":["--no-session","--model","%s","-e","%s","--append-system-prompt","Marker: CANARY-APPENDFLAG."],"prompts":[%s]}' \
    "$model" "$here/tests/live/canary-extension.ts" "$(printf '%s' "$prompt" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')")" 2>&1 || true)
  [ -n "${FIDELITY_DEBUG:-}" ] && printf "%s\n" "$out" | cut -c1-400
  seen=$(printf '%s\n' "$out" | grep '^assistant' | grep -oE 'CANARY-[A-Z]+' | sort -u | sed 's/CANARY-//' | tr '\n' ' ')
  first=$(printf '%s\n' "$out" | grep -oE 'first=[0-9]+' | head -1)
  error=$(printf '%s\n' "$out" | grep -oE 'error=[^:]{1,120}' | grep -v 'error=false' | head -1 || true)
  echo "${model%%:*}: ${seen:-none} ($first${error:+; $error})"
done
