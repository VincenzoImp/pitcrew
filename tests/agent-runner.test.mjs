import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { childArgs, piInvocation, RpcChild } from "../lib/rpc-child.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const inv = { command: process.execPath, args: [FAKE] };
const loadout = { id: "scout-1", agent: "scout", model: "role/scout", tools: ["read", "ask_parent"], cwd: "/tmp", depth: 1, timeoutMs: 1000, session: "s", createdAt: "" };

function child(onUi = () => {}) {
  const c = new RpcChild(inv, ["--mode", "rpc"], tmpdir(), process.env, { onUi: (req) => onUi(c, req), onUpdate() {} });
  c.start();
  return c;
}

test("child args load extensions, skip project files, and name a role", () => {
  const args = childArgs(loadout, "/r/scout-1", "/r/scout-1/session/s.jsonl");
  assert.ok(!args.includes("--no-extensions"));
  assert.deepEqual(args, ["--mode", "rpc", "--no-approve", "--offline", "--session-dir", "/r/scout-1/session", "--session", "/r/scout-1/session/s.jsonl",
    "--model", "role/scout", "--tools", "read,ask_parent", "--append-system-prompt", "/r/scout-1/role.md"]);
});

test("prompt → agent_settled with final text, usage and tool calls", async () => {
  const c = child();
  assert.equal((await c.send({ type: "prompt", message: "go" })).success, true);
  assert.deepEqual(await c.nextOutcome(), { kind: "settled", aborted: false });
  assert.match(c.finalText, /^Status: done/);
  assert.equal(c.usage.turns, 1);
  assert.equal(c.usage.input, 100);
  assert.equal(c.lastTool, "read src/a.ts");
  assert.deepEqual(c.toolCalls.map((t) => t.name), ["read"]);
  await c.close();
  assert.equal(c.running, false);
});

test("ask_parent input round trip", async () => {
  let asked;
  const c = child((c, req) => { asked = req.title; c.respondUi(req.id, { value: "blue" }); });
  await c.send({ type: "prompt", message: "ASK" });
  await c.nextOutcome();
  assert.equal(asked, "ask_parent: which color?");
  assert.match(c.finalText, /answer is blue/);
  await c.close();
});

test("stop aborts a running child; exit is reported", async () => {
  const c = child();
  await c.send({ type: "prompt", message: "SLOW" });
  const outcome = c.nextOutcome();
  await c.stop();
  assert.deepEqual(await outcome, { kind: "settled", aborted: true });
  assert.equal(c.running, false);
  assert.equal((await c.send({ type: "prompt", message: "x" })).success, false);
});

test("outside pi (pitcrew run) the child is pi from PATH, never the calling script", () => {
  const saved = process.env.PITCREW_AGENT_PI;
  delete process.env.PITCREW_AGENT_PI;
  try {
    assert.deepEqual(piInvocation(false), { command: "pi", args: [] });
  } finally {
    if (saved !== undefined) process.env.PITCREW_AGENT_PI = saved;
  }
});
