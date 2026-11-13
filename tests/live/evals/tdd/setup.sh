#!/bin/bash
set -e
cat > package.json <<'J'
{ "name": "versions", "type": "module", "scripts": { "test": "node --test" } }
J
mkdir test && printf '// Version helpers.\n' > versions.js
git add -A && git commit -qm init
