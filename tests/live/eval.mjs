#!/usr/bin/env node
// Behavioural eval of one skill: run its case on a model and print pass/fail per check with token use.
// Not part of `npm run check`: it calls a model.
//
//   node tests/live/eval.mjs <skill> [--profile <name> | --model <provider/id> [--thinking <level>]] [--keep]
//   node tests/live/eval.mjs <skill> --load-only ...   only the check "loads the skill": stop at the
//            first read of the skill file, or when the first turn ends (no subagent wait). Cheap.
//   node tests/live/eval.mjs --list
//
// A case is tests/live/evals/<skill>/case.json:
//   setup    shell script (relative to the case folder) that builds a scratch repo; it gets the repo
//            folder as $1 and runs inside it. The repo is a fresh `git init` in /tmp.
//   tracking none | local | github (the repo setting pitcrew.tracking; unset: from the repo)
//   args     extra pi arguments (session mode flags)
//   prompts  messages sent in order; each waits for the turn and for every subagent to end
//   checks   [{ name, tool?, args?, text?, transcript?, command?, expect? }]
//            tool + args: a tool call whose name matches `tool` (a regex, whole name) and whose JSON
//            arguments match the regex `args`
//            text: a regex on the final assistant message
//            transcript: a regex on everything (assistant text, tool calls and results, agent reports)
//            command + expect: a shell command in the repo whose output matches the regex `expect`
//            not: true inverts a check
// The model is the profile's (default `local`, no subscription quota), in a throwaway agent dir.
// --model runs every role on one model (for example the smallest model of the Claude bridge, when
// the local model is too weak for a case); --thinking sets its level (default low).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
if (argv[0] === "--list" || !argv[0]) {
  console.log(readdirSync(join(here, "evals")).join("\n"));
  process.exit(argv[0] ? 0 : 2);
}
const skill = argv[0];
const model = flag("--model");
const profile = model ? "eval" : flag("--profile") ?? "local";
const caseDir = join(here, "evals", skill);
const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
const loadOnly = argv.includes("--load-only");
if (loadOnly) spec.checks = spec.checks.filter((c) => /loads the skill/.test(c.name));
let loaded = () => {};

// Throwaway agent dir that loads this checkout (tests/live/agent-dir.sh), and the scratch repo.
const agentDir = execFileSync("bash", [join(here, "agent-dir.sh")], { encoding: "utf8", env: { ...process.env, PI_TEST_PROFILE: profile } })
  .trim().replace(/^export PI_CODING_AGENT_DIR=/, "");
// Tracking is a repo setting; a case sets it in the throwaway agent dir, so the scratch repo stays clean.
if (spec.tracking) {
  const file = join(agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.pitcrew = { ...settings.pitcrew, tracking: spec.tracking };
  writeFileSync(file, JSON.stringify(settings, null, 2));
}
if (model) {
  const role = { model, thinking: flag("--thinking") ?? "low" };
  mkdirSync(join(agentDir, "profiles"), { recursive: true });
  writeFileSync(join(agentDir, "profiles", "eval.json"), JSON.stringify({ lead: role, worker: role, scout: role, reviewer: role }));
}
const repo = mkdtempSync(join(tmpdir(), `eval-${skill}-`));
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
sh("git init -q -b main && git config user.email eval@local && git config user.name eval");
execFileSync("bash", [join(caseDir, spec.setup), repo], { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });

const log = { calls: [], texts: [], last: "", transcript: [] };
const usage = { requests: 0, sent: 0, output: 0, children: 0 };
const started = Date.now();
let running = 0;
let settled = () => {};

const pi = spawn("pi", ["--mode", "rpc", ...(spec.args ?? [])], {
  cwd: repo,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  stdio: ["pipe", "pipe", "inherit"],
});
const waiting = new Map();
createInterface({ input: pi.stdout }).on("line", (line) => {
  let r;
  try { r = JSON.parse(line); } catch { return; }
  if (r.type === "response") waiting.get(r.id)?.(r);
  if (r.type === "agent_settled") settled();
  if (r.type === "extension_ui_request" && r.method === "setStatus" && (r.statusKey ?? r.key) === "pitcrew.agents") {
    running = Number(/agents (\d+)/.exec(r.statusText ?? r.text ?? "")?.[1] ?? 0);
  }
  // Dialogs: confirm answers `spec.confirm` (default no); a choice takes the first option (ask_user
  // puts the recommended one first); free text is cancelled. Each question goes into the transcript.
  if (r.type === "extension_ui_request" && ["confirm", "select", "input", "editor"].includes(r.method)) {
    log.transcript.push(`asked (${r.method}): ${r.title ?? ""} ${r.message ?? ""} ${JSON.stringify(r.options ?? [])}`);
    const answer = r.method === "confirm" ? { confirmed: spec.confirm ?? false } : r.method === "select" ? { value: r.options?.[0] } : { cancelled: true };
    pi.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: r.id, ...answer })}\n`);
  }
  if (r.type === "tool_execution_end") {
    const out = JSON.stringify(r.result?.content ?? "");
    log.transcript.push(`result ${r.toolName}: ${out}`);
  }
  if (r.type === "message_end" && r.message?.role === "custom") {
    const text = String(r.message.content);
    log.transcript.push(`custom ${r.message.customType}: ${text}`);
  }
  if (r.type === "message_end" && r.message?.role === "assistant") {
    const m = r.message;
    const u = m.usage ?? {};
    usage.requests += 1;
    usage.sent += (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
    usage.output += u.output ?? 0;
    for (const part of m.content ?? []) {
      if (part.type === "toolCall") {
        log.calls.push({ name: part.name, args: JSON.stringify(part.arguments ?? {}) });
        if (loadOnly && spec.checks.some((c) => new RegExp(`^(${c.tool})$`).test(part.name) && new RegExp(c.args ?? "", "is").test(JSON.stringify(part.arguments ?? {})))) loaded();
        log.transcript.push(`call ${part.name} ${JSON.stringify(part.arguments ?? {})}`);
      }
    }
    const text = (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("").trim();
    if (text) {
      log.texts.push(text);
      log.last = text;
      log.transcript.push(`assistant: ${text}`);
    }
  }
});
const send = (command) => new Promise((resolve) => { waiting.set(command.id, resolve); pi.stdin.write(`${JSON.stringify(command)}\n`); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the turn to settle and for every subagent to end (their reports start a new turn). */
async function quiet(limitMs) {
  const end = Date.now() + limitMs;
  for (;;) {
    let calm = false;
    const done = new Promise((resolve) => (settled = () => { calm = true; resolve(); }));
    await Promise.race([done, sleep(Math.max(0, end - Date.now()))]);
    if (Date.now() >= end) return false;
    await sleep(5000); // a child's report may start one more turn
    if (calm && running === 0) {
      const again = new Promise((resolve) => (settled = resolve));
      const more = await Promise.race([again.then(() => true), sleep(10_000).then(() => false)]);
      if (!more && running === 0) return true;
    }
  }
}

let n = 0;
let timedOut = false;
for (const message of loadOnly ? spec.prompts.slice(0, 1) : spec.prompts) {
  if (loadOnly) {
    const end = new Promise((resolve) => { settled = resolve; loaded = resolve; });
    const response = await send({ id: `p${++n}`, type: "prompt", message });
    if (!response.success) console.log(`prompt failed: ${response.error}`);
    else timedOut = !(await Promise.race([end.then(() => true), sleep((spec.timeoutMin ?? 60) * 60_000).then(() => false)]));
    break;
  }
  const response = await send({ id: `p${++n}`, type: "prompt", message });
  if (!response.success) console.log(`prompt failed: ${response.error}`);
  else if (!(await quiet((spec.timeoutMin ?? 60) * 60_000))) { timedOut = true; break; }
}
pi.stdin.end();
pi.kill();

const results = spec.checks.map((c) => {
  let ok;
  if (c.tool) ok = log.calls.some((call) => new RegExp(`^(${c.tool})$`).test(call.name) && new RegExp(c.args ?? "", "is").test(call.args));
  else if (c.text) ok = new RegExp(c.text, "is").test(log.last);
  else if (c.transcript) ok = new RegExp(c.transcript, "is").test(log.transcript.join("\n"));
  else if (c.command) {
    let out = "";
    try { out = sh(c.command); } catch (error) { out = `${error.stdout ?? ""}${error.stderr ?? ""}`; }
    ok = new RegExp(c.expect ?? "", "s").test(out);
  }
  if (c.not) ok = !ok;
  return { name: c.name, ok };
});

// Subagent tokens: from each child's state.json in the run ledgers of the throwaway agent dir.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const file of walk(agentDir).filter((f) => f.endsWith("/state.json") && f.includes("/runs/"))) {
  try {
    const u = JSON.parse(readFileSync(file, "utf8")).usage ?? {};
    usage.children += (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0);
  } catch {}
}
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
console.log(`eval ${skill} on ${model ? `${model}:${flag("--thinking") ?? "low"}` : `profile ${profile}`}${timedOut ? " (timed out)" : ""}`);
for (const r of results) console.log(`  ${r.ok ? "pass" : "FAIL"}  ${r.name}`);
const passed = results.filter((r) => r.ok).length;
console.log(`result: ${passed}/${results.length} checks passed; ${minutes} min; lead ${usage.requests} requests, ${usage.sent} tokens sent, ${usage.output} output; subagents ${usage.children} tokens`);
console.log(`final message: ${log.last.replace(/\s+/g, " ").slice(0, 400)}`);
if (argv.includes("--keep")) console.log(`kept: repo ${repo}, agent dir ${agentDir}`);
else {
  rmSync(repo, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
}
process.exit(passed === results.length && !timedOut ? 0 : 1);
