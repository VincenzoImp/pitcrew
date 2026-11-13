#!/bin/bash
# Sandbox entrypoint. The home dir is a fresh tmpfs per run: write the agent settings and the
# global rules, then run the command. Nothing of an earlier run is there.
set -euo pipefail
mkdir -p "$HOME/.pi/agent" "$CLAUDE_CONFIG_DIR"
cp /opt/pitcrew-box/settings.json "$HOME/.pi/agent/settings.json"
ln -s /opt/pitcrew/AGENTS.global.md "$HOME/.pi/agent/AGENTS.md"
echo '{}' > "$CLAUDE_CONFIG_DIR/settings.json"
exec "$@"
