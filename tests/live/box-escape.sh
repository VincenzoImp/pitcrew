#!/bin/bash
# Escape test of the sandbox (docs/sandbox.md). Usage: tests/live/box-escape.sh <repo>
# Runs checks inside a box on a clone of <repo>, one PASS or FAIL line each. Exit 1 on any FAIL.
set -uo pipefail
here=$(cd "$(dirname "$0")/../.." && pwd)
read -r -d '' checks <<'SH'
check() { if bash -c "$2" >/dev/null 2>&1; then echo "PASS $1"; else echo "FAIL $1"; fi; }
check "host home is not visible" '[ "$(ls -A /home)" = agent ]'
check "no SSH keys anywhere" '[ -z "$(find / -path /proc -prune -o \( -name "id_rsa*" -o -name "id_ed25519*" -o -name known_hosts \) -print 2>/dev/null | head -1)" ]'
check "no other repo and no host .git" '[ "$(find / -path /proc -prune -o -name .git -print 2>/dev/null)" = /work/.git ]'
check "the clone has no remote and is a plain repo" '[ -z "$(git -C /work remote)" ] && [ -d /work/.git ] && [ ! -e /work/.git/commondir ]'
check "pitcrew and the root file system are read-only" '! touch /opt/pitcrew/x && ! touch /etc/x && ! touch /usr/x'
check "no docker socket" '[ ! -e /var/run/docker.sock ] && [ ! -e /run/docker.sock ]'
check "no credentials in home or env" '[ ! -e ~/.config/gh ] && [ ! -e ~/.pi/agent/auth.json ] && ! env | grep -q -E "GH_TOKEN|GITHUB_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|API_KEY"'
check "a host not on the allow list is blocked" 'node -e "fetch(\"https://example.com\").then(()=>process.exit(1),()=>process.exit(0))"'
check "the model API is not reachable directly" 'node -e "fetch(\"https://api.anthropic.com/v1/models\").then(()=>process.exit(1),()=>process.exit(0))"'
check "no route around the proxy" 'env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy NODE_USE_ENV_PROXY=0 node -e "fetch(\"https://github.com\",{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))"'
check "an allowed host works through the proxy" 'node -e "fetch(\"https://registry.npmjs.org/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"'
SH
out=$(node "$here/bin/pitcrew" box exec "$1" -- bash -c "$checks")
echo "$out"
! grep -q '^FAIL' <<<"$out"
