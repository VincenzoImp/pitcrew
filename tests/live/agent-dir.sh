#!/bin/bash
# Make a throwaway pi agent dir that loads this checkout instead of the installed package.
# Usage: eval "$(tests/live/agent-dir.sh [profile])"   -> exports PI_CODING_AGENT_DIR
# The profile (default `local`) is the argument, or PI_TEST_PROFILE exported before the call.
# Logins and the Claude bridge are reused from ~/.pi/agent. Remove the dir when done.
# The default profile is `local`, so tests spend no subscription quota unless they ask for a profile.
# Repos are trusted, so a test repo's .pi/settings.json applies.
set -euo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
real=${PI_REAL_AGENT_DIR:-$HOME/.pi/agent}
dir=$(mktemp -d /tmp/pitcrew-agent.XXXXXX)
bridge=$(node -p 'require(process.argv[1]).dependencies["pi-claude-bridge"]' "$here/box/package.json")
cp "$real/auth.json" "$dir/auth.json"
chmod 600 "$dir/auth.json"
for item in npm claude-bridge models-store.json; do
  [ -e "$real/$item" ] && ln -s "$real/$item" "$dir/$item"
done
[ -f "$here/AGENTS.global.md" ] && ln -s "$here/AGENTS.global.md" "$dir/AGENTS.md"
cat > "$dir/settings.json" <<JSON
{
  "packages": ["npm:pi-claude-bridge@$bridge", "$here"],
  "defaultProvider": "role",
  "defaultModel": "lead",
  "enabledModels": ["role/*"],
  "cacheWarming": "off",
  "enableInstallTelemetry": false,
  "defaultProjectTrust": "always",
  "pitcrew": { "profile": "${1:-${PI_TEST_PROFILE:-local}}" }
}
JSON
echo "export PI_CODING_AGENT_DIR=$dir"
