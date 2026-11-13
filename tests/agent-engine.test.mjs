import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The agent extension driven through a fake pi API, with fake children (fixtures/fake-pi.mjs).
const home = mkdtempSync(join(tmpdir(), "agent-engine-"));
process.env.PI_CODING_AGENT_DIR = home;
process.env.PITCREW_AGENT_PI = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
delete process.env.PITCREW_DEPTH;
delete process.env.PITCREW_TREE;
const { default: agent } = await import("../extensions/agent/index.ts");
const { registry } = await import("../extensions/agent/registry.ts");
const { readFileSync } = await import("node:fs");
test.after(() => rmSync(home, { recursive: true, force: true }));

function instance(sid, state = { idle: true }, entries = [], mode = undefined, cwd = home) {
  const tools = new Map();
  const commands = {};
  const handlers = {};
  const sent = [];
  const pi = {
    registerTool: (t) => tools.set(t.name, t), on: (n, f) => (handlers[n] ??= []).push(f), registerCommand: (n, c) => { commands[n] = c; }, registerShortcut() {},
    registerMessageRenderer() {}, getSettings: () => ({}), sendMessage: (m, o) => sent.push([m, o]),
  };
  agent(pi);
  const opened = [];
  const blocked = [];
  const notices = [];
  const ctx = { cwd, isProjectTrusted: () => true, hasUI: mode === "tui", mode, isIdle: () => state.idle, sessionManager: { getSessionId: () => sid, getEntries: () => entries, getSessionFile: () => "/p/parent.jsonl" },
    getContextUsage: () => ({ tokens: state.tokens ?? 1000 }), ui: { notify: (n) => notices.push(n), setStatus() {}, custom: async (_f, o) => { if (o?.blocked) blocked.push(o.blocked); else opened.push(true); } } };
  const emit = async (n, e = {}) => { for (const f of handlers[n] ?? []) await f(e, ctx); };
  const call = async (params, signal) => (await tools.get("agent").execute("id", params, signal, undefined, ctx)).content[0].text;
  const raw = (params) => tools.get("agent").execute("id", params, undefined, undefined, ctx);
  return { sent, emit, call, raw, state, opened, blocked, tools, notices, commands, ctx };
}
const until = async (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } };

test("background fan-out: each report arrives once; only the last one starts a turn", async () => {
  const a = instance("s-fan");
  await a.emit("session_start", { reason: "startup" });
  assert.match(await a.call({ action: "start", agent: "scout", task: "one" }), /Started scout-1/);
  assert.match(await a.call({ action: "start", agent: "scout", task: "two" }), /Started scout-2/);
  await until(() => a.sent.length === 2);
  const triggers = a.sent.map(([, o]) => o.triggerTurn);
  assert.equal(triggers.filter(Boolean).length, 1, "one turn for the fan-out");
  for (const [m] of a.sent) assert.match(m.content, /Status: done/);
  assert.match(await a.call({ action: "wait" }), /Nothing to wait for/);
});

test("a wait returns the report as the tool result, not as a message", async () => {
  const a = instance("s-wait");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "x" });
  assert.match(await a.call({ action: "wait", id: "scout-1" }), /scout-1 \(scout\) done[\s\S]*answer is 42/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.sent.length, 0);
});

test("Esc on a wait detaches: the child keeps running", async () => {
  const a = instance("s-esc");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "SLOW" });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  assert.match(await a.call({ action: "wait", ids: ["scout-1"] }, ac.signal), /detached/);
  assert.match(await a.call({ action: "status", id: "scout-1" }), /running/);
  await a.call({ action: "stop", id: "scout-1" });
  await until(() => a.sent.length === 1);
  assert.equal(a.sent[0][1].triggerTurn, false, "a stopped child starts no turn");
});

test("a child survives /reload and reports once to the new instance", async () => {
  const old = instance("s-reload");
  await old.emit("session_start", { reason: "startup" });
  await old.call({ action: "start", agent: "scout", task: "SLOW" });
  await old.emit("session_shutdown", { reason: "reload" });
  const fresh = instance("s-reload");
  await fresh.emit("session_start", { reason: "reload" });
  assert.match(await fresh.call({ action: "status" }), /scout-1 · scout · running/);
  await fresh.call({ action: "stop", id: "scout-1" });
  await until(() => fresh.sent.length === 1);
  assert.equal(old.sent.length, 0);
  assert.match(fresh.sent[0][0].content, /scout-1 \(scout\) stopped/);
});

test("quit ends live children as interrupted", async () => {
  const a = instance("s-quit");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "SLOW" });
  await new Promise((r) => setTimeout(r, 200));
  await a.emit("session_shutdown", { reason: "quit" });
  const b = instance("s-quit");
  await b.emit("session_start", { reason: "startup" });
  assert.match(await b.call({ action: "status", id: "scout-1" }), /interrupted/);
});

test("a long report: the parent gets the head and the path; report.md is whole", async () => {
  const a = instance("s-long");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "LONG" });
  const out = await a.call({ action: "wait", id: "scout-1" });
  const path = /Report: (\S+)/.exec(out)[1];
  assert.ok(out.length < 31_000);
  assert.match(out, /Report continues: \d+ more characters\. Read \S+report\.md from line \d+\./);
  const whole = readFileSync(path, "utf8");
  assert.ok(whole.length > 100_000);
  assert.match(whole, /THE END/);
});

test("a restart neither loses nor repeats a result: the session file is the receipt", async () => {
  const a = instance("s-restart", { idle: false }); // busy: the result is queued, not yet in the file
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "x" });
  await until(() => a.sent.length === 1);
  const message = a.sent[0][0];
  // The process dies before pi writes the queued message: a new process delivers it again, quietly.
  registry.sent.clear(); registry.runs.clear();
  const b = instance("s-restart");
  await b.emit("session_start", { reason: "startup" });
  assert.equal(b.sent.length, 1);
  assert.equal(b.sent[0][1].triggerTurn, false, "opening a session starts no turn");
  // The message is in the file now: the next start delivers nothing.
  registry.sent.clear(); registry.runs.clear();
  const c = instance("s-restart", { idle: true }, [{ type: "custom_message", customType: "agent-result", details: message.details }]);
  await c.emit("session_start", { reason: "startup" });
  assert.equal(c.sent.length, 0);
  assert.match(await c.call({ action: "wait" }), /Nothing to wait for/);
});

test("headless: a child's question goes to the parent model, which replies", async () => {
  const a = instance("s-ask");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "ASK" });
  await until(() => a.sent.some(([m]) => m.customType === "agent-question"));
  assert.match(a.sent[0][0].content, /scout-1 \(scout\) asks: which color\?/);
  assert.match(await a.call({ action: "reply", id: "scout-1", text: "blue" }), /Replied/);
  await until(() => a.sent.some(([m]) => m.customType === "agent-result"));
  assert.match(a.sent.at(-1)[0].content, /answer is blue/);
});

test("with a human in a terminal: the question waits for the owner, not a model turn", async () => {
  const a = instance("s-ask-tui", { idle: true }, [], "tui");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "ASK" });
  await until(() => a.notices.some((n) => /scout-1 asks: which color/.test(n)));
  assert.equal(a.opened.length, 0, "the panel does not open by itself");
  assert.deepEqual(a.blocked, [{ kind: "question", message: "scout-1 asks: which color?" }], "pi reports blocked (OSC 7501) while it waits");
  assert.equal(a.sent.filter(([m]) => m.customType === "agent-question").length, 0);
  assert.ok(a.tools.has("ask_user"));
  await a.call({ action: "reply", id: "scout-1", text: "red" });
  await until(() => a.sent.some(([m]) => m.customType === "agent-result"));
  assert.match(a.sent.at(-1)[0].content, /answer is red/);
});

test("a provider quota refusal: the child fails with the reason and how to resume; resume continues it", async () => {
  const a = instance("s-quota");
  await a.emit("session_start", { reason: "startup" });
  await a.call({ action: "start", agent: "scout", task: "QUOTA" });
  await until(() => a.sent.length === 1);
  assert.match(a.sent[0][0].content, /scout-1 \(scout\) failed[\s\S]*quota exceeded[\s\S]*nothing is lost[\s\S]*agent resume scout-1, or \/agents resume/);
  // No admission check: a new child starts at once, whatever the quota file says.
  assert.match(await a.call({ action: "start", agent: "scout", task: "x" }), /Started scout-2/);
  // One gesture resumes every child a quota refusal stopped.
  await a.commands.agents.handler("resume", a.ctx);
  assert.match(a.notices.at(-1), /resumed scout-1$/);
  assert.match(await a.call({ action: "wait", id: "scout-1" }), /scout-1 \(scout\) done[\s\S]*answer is 42/);
});

test("run: checked JSON as structured data, with one repair turn", async () => {
  const a = instance("s-run");
  await a.emit("session_start", { reason: "startup" });
  const schema = { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] };
  const ok = await a.raw({ action: "run", agent: "scout", task: "BADJSON", schema });
  assert.equal(ok.isError, false, ok.content[0].text);
  assert.deepEqual(ok.structuredContent.data, { answer: 42 });
  assert.equal(a.sent.length, 0, "the result is the tool result, no message");
  const bad = await a.raw({ action: "run", agent: "scout", task: "NOJSON", schema });
  assert.equal(bad.isError, true);
  assert.match(bad.structuredContent.error, /no valid JSON/);
});

test("the agent and role parameters say what they are; a second worker in one repo gets its own worktree, removed once its work is taken", async () => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const repo = join(home, "repo");
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("commit", "-q", "--allow-empty", "-m", "init");
  const a = instance("s-trees", { idle: true }, [], undefined, repo);
  await a.emit("session_start", { reason: "startup" });
  assert.match(await a.call({ action: "start", role: "scout", task: "x" }), /Unknown agent "": name one in agent/);
  assert.match(await a.call({ action: "start", agent: "scout", role: "boss", task: "x" }), /Unknown role "boss"/);
  assert.match(await a.call({ action: "start", agent: "worker", task: "SLOW" }), /^Started worker-1 \(worker\) in the background/);
  const second = await a.call({ action: "start", agent: "worker", task: "SLOW" });
  const path = /in its own worktree (\S+) \(branch (agent\/\S+)\)/.exec(second);
  assert.ok(path, second);
  assert.ok(existsSync(path[1]));
  await a.call({ action: "stop", id: "worker-1" });
  await a.call({ action: "stop", id: "worker-2" });
  await until(() => a.sent.filter(([m]) => m.customType === "agent-result").length === 2);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "w2"], { cwd: path[1] });
  await a.emit("agent_settled");
  assert.ok(existsSync(path[1]), "not taken yet: the worktree stays");
  git("merge", "-q", "--no-edit", path[2]);
  await a.emit("agent_settled");
  assert.equal(existsSync(path[1]), false, "taken: the worktree and branch are gone");
  assert.doesNotMatch(git("branch"), /agent\//);
});

test("a child gets the repo's check as PI_VERIFY only where the parent's gate would run it (your own or a trusted repo)", async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  const repo = join(home, "checked");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "package.json"), '{"scripts":{"check":"true"}}');
  const out = join(home, "argv-verify.json");
  process.env.FAKE_ARGV_OUT = out;
  try {
    const a = instance("s-verify", { idle: true }, [], undefined, repo);
    await a.emit("session_start", { reason: "startup" });
    await a.call({ action: "start", agent: "scout", task: "x" });
    await a.call({ action: "wait", id: "scout-1" });
    assert.equal(JSON.parse(readFileSync(out, "utf8")).verify, null, "not yours, not trusted: no check handed over");
    new ProjectTrustStore(home).set(repo, true);
    await a.call({ action: "start", agent: "scout", task: "x" });
    await a.call({ action: "wait", id: "scout-2" });
    assert.equal(JSON.parse(readFileSync(out, "utf8")).verify, "npm run check");
  } finally {
    delete process.env.FAKE_ARGV_OUT;
  }
});
