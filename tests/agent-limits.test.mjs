import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { childLimit, DEFAULTS, failureText, parseLimits, readSettings, TreeBudget } from "../lib/limits.ts";

test("settings: defaults, then pitcrew.agent, then session changes; 0 is no limit (\"off\" read as 0); bad values ignored", () => {
  assert.deepEqual(readSettings(undefined), DEFAULTS);
  assert.equal(DEFAULTS.maxRunning, 6);
  assert.equal(DEFAULTS.askTimeoutSeconds, 600);
  const s = readSettings({ pitcrew: { agent: { maxRunning: 2, unknown: 50 } } }, { maxRunning: 4 });
  assert.equal(s.maxRunning, 4);
  assert.equal("unknown" in s, false, "unknown keys are ignored");
  assert.equal(readSettings({ pitcrew: { agent: { maxRunning: "off" } } }).maxRunning, 0);
  assert.equal(readSettings({ pitcrew: { agent: { maxRunning: 0 } } }).maxRunning, 0);
  assert.equal(readSettings({ pitcrew: { agent: { maxRunning: -1 } } }).maxRunning, 6);
});

test("/agents limits arguments", () => {
  assert.deepEqual(parseLimits("running 3"), { maxRunning: 3 });
  assert.deepEqual(parseLimits("running 0"), { maxRunning: 0 });
  assert.deepEqual(parseLimits("running off"), { maxRunning: 0 });
  assert.throws(() => parseLimits("quota 70"), /unknown limit "quota"/);
  assert.throws(() => parseLimits("running"), /usage/);
  assert.throws(() => parseLimits("running zero"), /is not a number \(0: no limit\)/);
  assert.throws(() => parseLimits("speed 3"), /unknown limit/);
});

test("a start waits while all slots of its depth are taken; other depths are separate pools", async () => {
  const budget = new TreeBudget(mkdtempSync(join(tmpdir(), "tree-")));
  const held = [];
  for (let i = 0; i < 2; i++) held.push(await budget.acquire(2, 1, `w${i}`, undefined, 20));
  // Two workers hold both depth-1 slots; their scouts (depth 2) still start: no deadlock.
  assert.equal(typeof (await budget.acquire(2, 2, "s0", undefined, 20)), "function");
  let third;
  const pending = budget.acquire(2, 1, "w2", undefined, 20).then((r) => { third = r; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(third, undefined);
  held[0]();
  await pending;
  assert.equal(typeof third, "function");
  assert.equal(typeof (await budget.acquire(0, 1, "x")), "function");
});

test("a waiting start can be aborted; stale slots of dead processes are reclaimed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tree-"));
  const budget = new TreeBudget(dir);
  assert.equal(typeof (await budget.acquire(1, 1, "a", undefined, 20)), "function");
  writeFileSync(join(dir, "slots", "1", "0"), "999999999 ghost\n");
  assert.equal(typeof (await budget.acquire(1, 1, "b", undefined, 20)), "function");
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  assert.equal(await budget.acquire(1, 1, "c", ac.signal, 20), undefined);
});

test("a quota failure tells how to resume; other failures are unchanged", () => {
  assert.match(failureText("scout-1", "quota exceeded — rate limit (five_hour)", true), /nothing is lost[\s\S]*agent resume scout-1/);
  assert.equal(failureText("scout-1", "boom", false), "boom");
});

test("maxMinutes: no child deadline by default; a number bounds every child", () => {
  assert.equal(DEFAULTS.maxMinutes, 0);
  assert.equal(childLimit(readSettings(undefined)), 0);
  assert.equal(childLimit(readSettings({ pitcrew: { agent: { maxMinutes: 90 } } })), 90 * 60_000);
  assert.equal(readSettings({ pitcrew: { agent: { maxMinutes: 90 } } }, { maxMinutes: 0 }).maxMinutes, 0, "a session can lift it");
});
