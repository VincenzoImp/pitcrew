#!/bin/bash
set -e
cat > package.json <<'J'
{ "name": "schedule", "type": "module", "scripts": { "test": "node --test" } }
J
cat > duration.js <<'J'
// "1h30m" -> seconds
export function parseDuration(text) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text);
  if (!m) throw new Error(`bad duration ${text}`);
  return Number(m[1] ?? 0) * 3600 + (m[1] ? 0 : Number(m[2] ?? 0) * 60);
}
J
cat > total.js <<'J'
import { parseDuration } from "./duration.js";
console.log(`total: ${process.argv.slice(2).reduce((s, d) => s + parseDuration(d), 0)}`);
J
mkdir test && cat > test/duration.test.js <<'J'
import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration } from "../duration.js";
test("minutes", () => assert.equal(parseDuration("15m"), 900));
J
git add -A && git commit -qm init
