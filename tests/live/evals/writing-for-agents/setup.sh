#!/bin/bash
set -e
cat > AGENTS.md <<'M'
# Instructions for AI agents

Welcome, dear AI assistant! We are really happy that you are here to help us with this wonderful
project. It is very important to us that you always do your very best work, because quality
matters a great deal to everyone on the team. Please always be careful and thoughtful.

Before you finish any change, it is essential and absolutely required that you run `make check`,
which runs the linter and the whole test suite. Please never forget this step.

As a general note, you should always try to write good code that is clean and readable, and you
should try to follow best practices in all cases, as any good engineer would naturally do.

Database migrations live in `db/migrations/`. Never edit a migration that has already been
merged; add a new one instead. This is critical because merged migrations already ran in
production.

Thank you so much for your help, we really appreciate it!
M
git add -A && git commit -qm init
