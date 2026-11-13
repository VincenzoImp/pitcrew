#!/bin/bash
set -e
cat > CONTRIBUTING.md <<'M'
# Contributing
- Branch from `main` as `feature/<issue>-<slug>`.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`).
- Run `npm run ci` before you open a pull request; it must pass.
M
printf '{ "name": "lib", "scripts": { "ci": "node --test" } }\n' > package.json
git add -A && git commit -qm init
