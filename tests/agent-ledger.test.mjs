import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunDir, findSessionFile, listEntries, readJson, reconcile, writeJson } from "../lib/ledger.ts";

test("run dirs get unique ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  assert.equal(createRunDir(dir, "scout").id, "scout-1");
  assert.equal(createRunDir(dir, "scout").id, "scout-2");
  assert.equal(createRunDir(dir, "My Task!").id, "my-task-1");
});

test("reconcile marks undriven children interrupted, keeps own and foreign live runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  const make = (id, status, pid, parentPid) => {
    const { dir: d } = createRunDir(dir, id);
    writeJson(join(d, "loadout.json"), { id: `${id}-1`, role: "worker", tools: ["read", "edit", "ask_parent"], model: "role/worker" });
    writeJson(join(d, "state.json"), { status, pid, parentPid, startedAt: "2026-11-11T00:00:00Z" });
    return d;
  };
  const dead = make("dead", "running", 111, process.pid); // this process restarted: nobody drives it
  const own = make("own", "running", 222, process.pid); // survived /reload: still in the registry
  const orphan = make("orphan", "asking", 333, 444); // parent gone
  const foreign = make("foreign", "running", 555, 666); // another live pi drives it
  const done = make("done", "done", 111, process.pid);
  const alive = (pid) => [222, 333, 555, 666].includes(pid);
  assert.deepEqual(reconcile(dir, (d) => d === own, alive).sort(), ["dead-1", "orphan-1"]);
  assert.equal(readJson(join(dead, "state.json")).status, "interrupted");
  assert.equal(readJson(join(own, "state.json")).status, "running");
  assert.equal(readJson(join(orphan, "state.json")).status, "interrupted");
  assert.equal(readJson(join(foreign, "state.json")).status, "running");
  assert.equal(readJson(join(done, "state.json")).status, "done");
  // resume uses the stored loadout: tools cannot widen
  assert.deepEqual(listEntries(dir).find((e) => e.id === "dead-1").loadout.tools, ["read", "edit", "ask_parent"]);
});

test("finds the child's session file", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  assert.equal(findSessionFile(dir), undefined);
  mkdirSync(join(dir, "session", "--x--"), { recursive: true });
  writeFileSync(join(dir, "session", "--x--", "2026-11-11T10-00-00_abc.jsonl"), "");
  assert.match(findSessionFile(dir), /abc\.jsonl$/);
});
