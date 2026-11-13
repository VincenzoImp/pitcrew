// Fake `pi --mode rpc` child for agent tests: strict JSONL in, JSONL out, no model.
// Behaviour by prompt text: ASK (ask_parent round trip), CONFIRM (guard-style confirm), SLOW (runs
// until abort), LONG (a 100K-character report), TURN (one turn, then waits for a steer), BADJSON (JSON that fails the schema, fixed on the repair prompt), ECHO (reports its prompt), QUOTA (the provider refuses for quota; a resumed child works), a `pitcrew run` worker prompt (FAKE_QUOTA=<issue>: refused for quota) (commits a file; FAKE_BREAK=<issue> breaks verify), else one tool call and a Markdown report.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.FAKE_ARGV_OUT) writeFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv: process.argv.slice(2), depth: process.env.PITCREW_DEPTH, guardAllow: process.env.PI_GUARD_ALLOW ?? null, verify: process.env.PI_VERIFY ?? null }));
// Like pi, keep a session file in --session-dir, so a run can be resumed.
const sessionDir = process.argv[process.argv.indexOf("--session-dir") + 1];
// A resumed child (--session) sees its earlier prompts, as a real one sees its history.
const resumed = process.argv.includes("--session") ? readFileSync(process.argv[process.argv.indexOf("--session") + 1], "utf8") : "";
const sessionFile = process.argv.includes("--session-dir") ? join(sessionDir, "fake.jsonl") : undefined;
if (sessionFile) { mkdirSync(sessionDir, { recursive: true }); writeFileSync(sessionFile, resumed); }
const out = (rec) => process.stdout.write(JSON.stringify(rec) + "\n");
const waiting = new Map();
let n = 0;
const ask = (rec) => new Promise((resolve) => { const id = `ui${++n}`; waiting.set(id, resolve); out({ type: "extension_ui_request", id, ...rec }); });
const report = (answer = "42") => `Status: done\n\nThe answer is ${answer}.`;
const assistant = (text, toolCalls = []) => out({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }, ...toolCalls.map((c) => ({ type: "toolCall", name: c, arguments: { path: "x" } }))], usage: { input: 100, output: 10, cacheRead: 50, cacheWrite: 0, cost: { total: 0.01 } } } });
let abort;
let steered;

const refuse = () => out({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "quota exceeded — rate limit (five_hour) — resets 7:30:00 PM", content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } });

async function run(prompt) {
  if (sessionFile) appendFileSync(sessionFile, `${prompt}\n`);
  const message = `${resumed}${prompt}`;
  if (message.includes("QUOTA") && !resumed) {
    refuse();
  } else if (process.env.FAKE_QUOTA && (message.includes("Unattended worker of `pitcrew run`") || message.includes("Fix round")) && /issue #(\d+)/.exec(message)?.[1] === process.env.FAKE_QUOTA) {
    refuse();
  } else if (message.includes("ASK")) {
    const reply = await ask({ method: "input", title: "ask_parent: which color?" });
    assistant(report(reply.value ?? "none"));
  } else if (message.includes("CONFIRM")) {
    const reply = await ask({ method: "confirm", title: "guard: git push", message: "git push origin main" });
    assistant(report(`confirmed=${reply.confirmed}`));
  } else if (message.includes("LONG")) {
    assistant(`Status: done\n\n${Array.from({ length: 2000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n")}\nTHE END`);
  } else if (message.includes("NOJSON")) {
    assistant("Status: done\n\nNo JSON here.");
  } else if (message.includes("not usable")) {
    assistant("Status: done\n```json\n{\"answer\": 42}\n```");
  } else if (message.includes("BADJSON")) {
    assistant("Status: done\n```json\n{\"answer\": \"many\"}\n```");
  } else if (message.includes("ECHO")) {
    assistant(`Status: done\n\n${message}`);
  } else if (message.includes("TURN")) {
    // One model turn, then work until a steer arrives; the report quotes the steer.
    assistant("working");
    const steer = await new Promise((resolve) => { steered = resolve; });
    assistant(`Status: partial\n\nGot: ${steer}`);
  } else if (message.includes("Unattended worker of `pitcrew run`") || message.includes("Fix round")) {
    // A runner worker: commit one file per issue; FAKE_BREAK=<issue> also leaves bad.txt (verify fails).
    const n = /issue #(\d+)/.exec(message)[1];
    writeFileSync(`issue-${n}.txt`, `${n}\n`);
    if (process.env.FAKE_BREAK === n) writeFileSync("bad.txt", "x\n");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", `issue ${n}`]);
    assistant(report(`issue ${n}`));
  } else if (message.includes("SLOW")) {
    await new Promise((resolve) => { abort = resolve; });
    return out({ type: "agent_settled", aborted: true });
  } else {
    out({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "src/a.ts" } });
    assistant(report(), ["read"]);
  }
  out({ type: "agent_settled", aborted: false });
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
    const rec = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (rec.type === "extension_ui_response") { waiting.get(rec.id)?.(rec); waiting.delete(rec.id); continue; }
    out({ type: "response", id: rec.id, command: rec.type, success: true, data: {} });
    if (rec.type === "prompt") void run(rec.message);
    if (rec.type === "abort") abort?.();
    if (rec.type === "steer") steered?.(rec.message);
  }
});
process.stdin.on("end", () => process.exit(0));
