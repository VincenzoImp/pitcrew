#!/bin/bash
set -e
printf '{ "name": "notes", "type": "module", "dependencies": { "turndown": "7.2.5" } }\n' > package.json
npm install --silent --ignore-scripts >/dev/null 2>&1
printf 'node_modules/\n' > .gitignore
git add -A && git commit -qm init
