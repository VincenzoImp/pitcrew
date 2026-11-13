#!/bin/bash
set -e
mkdir -p plans
cat > session.js <<'J'
// In-memory sessions for the admin panel.
const sessions = new Map();
export function create(user) {
  const id = crypto.randomUUID();
  sessions.set(id, { user, created: Date.now() });
  return id;
}
export function get(id) {
  return sessions.get(id) ?? null;
}
J
cat > README.md <<'J'
# Admin panel
Small admin panel for one shop. One process; sessions are kept in memory.
J
cat > plans/session-expiry.md <<'J'
# Session expiry for the admin panel

Status: draft

## Outcome
Admin sessions end on their own, so a forgotten browser tab does not stay logged in.

## Behaviour
- A session expires after 30 minutes without a request. Each request resets the timer.
- An expired session is deleted; the next request gets HTTP 401 and the login page.
- There is no "remember me".

## Decisions
- Store `lastSeen` (milliseconds) on the session object in `session.js`.
- Check expiry in `get(id)`: expired → delete and return null.
- Rejected: a background timer that sweeps sessions (one process, few sessions; checking on read is enough).

## Slices
1. Expiry on read. `get(id)` returns null for a session idle for more than 30 minutes, and deletes it.
   - [ ] V1: a session idle for 31 minutes is gone. Check: `node --test`
2. Keep admins logged in during long edits. Sessions stay valid for 24 hours from login, with no
   idle timeout, so an admin who edits a long product page is not logged out.
   - [ ] V2: a session 23 hours old and idle for 2 hours still works. Check: `node --test`

## Done-check
`node --test` passes, and a manual login, 31 minutes idle, then a request, shows the login page.
J
git add -A && git commit -qm init
