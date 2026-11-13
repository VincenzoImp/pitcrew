import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { budgetStop, childLimitMs, digest, frontier, newState, nextRelease, parseTarget, renderDigest, runnerSettings, tokenLine, unbounded } from "../lib/run-plan.ts";
import { runTarget, status } from "../lib/run.ts";

// The runner against real git repos (a bare origin and a clone) with an in-memory fake `gh` and the
// fake pi child as worker.

const issue = (number, extra = {}) => ({ number, title: `issue ${number}`, open: true, labels: [], blockers: [], openSubs: 0, url: "", ...extra });
const ledger = (issues = {}) => ({ target: "t", args: [], repo: "o/r", issues, runs: [] });

test("target forms; frontier: open, unblocked, no open sub-issues, not handed over; work in progress first", () => {
  assert.deepEqual(parseTarget(["12", "#13"]), { kind: "issues", numbers: [12, 13] });
  assert.deepEqual(parseTarget(["label:agent"]), { kind: "label", name: "agent" });
  assert.deepEqual(parseTarget(["v0.3", "runner"]), { kind: "milestone", title: "v0.3 runner" });
  const issues = [issue(1), issue(2, { blockers: [1] }), issue(3, { openSubs: 1 }), issue(4, { labels: ["needs-owner"] }), issue(5), issue(6), issue(7, { open: false })];
  const l = ledger({ 5: { ...newState(), phase: "gates" }, 6: { ...newState(), phase: "ready", pr: 9 } });
  assert.deepEqual(frontier(issues, l).map((i) => i.number), [5, 1]);
  const text = renderDigest(digest(issues, l), "o/r").join("\n");
  assert.match(text, /^o\/r: 1\/7 done/);
  assert.match(text, /in review \(1\): #6 PR #9/);
  assert.match(text, /blocked \(1\): #4: label needs-owner/);
  assert.match(text, /waiting \(2\): #2 after #1; #3 after its sub-issues/);
  assert.match(text, /next: #5/);
  assert.equal(nextRelease(["v0.3.1", "v0.10.0", "v0.9.4"]), "v0.11.0");
  assert.equal(nextRelease(["2024-01"]), undefined);
});

// ---------------------------------------------------------------- loop

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function lab() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "run-")));
  dirs.push(base);
  git(base, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(base, "clone", "-q", join(base, "origin.git"), "repo");
  const repo = join(base, "repo");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  return { base, repo, origin: join(base, "origin.git") };
}

/** Fake gh: issues 1, 2 (blocked by 1), 3; PRs; merges move origin's main to the PR head. Records every write. */
function fakeGh(origin, permission = "ADMIN") {
  const issues = { 1: { blockedBy: [] }, 2: { blockedBy: [1] }, 3: { blockedBy: [] } };
  for (const [n, i] of Object.entries(issues)) Object.assign(i, { number: Number(n), title: `issue ${n}`, state: "OPEN", labels: [], comments: [], body: `Do ${n}.` });
  const prs = [];
  const writes = [];
  const json = (v) => ({ code: 0, out: JSON.stringify(v) });
  const view = (i) => ({ number: i.number, title: i.title, state: i.state, url: "", body: i.body, labels: i.labels.map((name) => ({ name })),
    blockedBy: { nodes: i.blockedBy.map((b) => ({ number: b, state: issues[b].state })) }, subIssuesSummary: { total: 0, completed: 0 }, comments: i.comments.map((body) => ({ body })) });
  const opt = (args, name) => args[args.indexOf(name) + 1];
  const exec = (cmd, args, cwd) => {
    if (cmd === "git") {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      return { code: r.status ?? 1, out: (r.stdout ?? "").trim() || (r.stderr ?? "").trim() };
    }
    const [a, b] = args;
    if (a === "repo") return json({ nameWithOwner: "o/r", defaultBranchRef: { name: "main" }, viewerPermission: permission });
    if (a === "issue" && b === "list") return json(Object.values(issues).map(view));
    if (a === "issue" && b === "view") {
      const v = view(issues[args[2]]);
      return args.includes("--jq") ? json(v.comments.map((c) => c.body)) : json(v);
    }
    if (a === "issue" || a === "label" || (a === "pr" && ["create", "ready", "merge"].includes(b))) writes.push(args.slice(0, 3).join(" "));
    if (a === "issue" && b === "comment") { issues[args[2]].comments.push(opt(args, "--body")); return json({}); }
    if (a === "issue" && b === "edit") { issues[args[2]].labels.push(opt(args, "--add-label")); return json({}); }
    if (a === "label") return json({});
    if (a === "pr" && b === "list") return json(prs.filter((p) => p.headRefName === opt(args, "--head") || args.includes("merged") && p.state === "MERGED"));
    if (a === "pr" && b === "create") {
      const head = opt(args, "--head");
      prs.push({ number: 100 + prs.length, state: "OPEN", isDraft: true, url: "", headRefName: head, isCrossRepository: false, closes: Number(/Closes #(\d+)/.exec(opt(args, "--body"))[1]),
        get headRefOid() { return git(origin, "rev-parse", `refs/heads/${head}`); } });
      return json({});
    }
    const pr = prs.find((p) => p.number === Number(args[2]));
    if (a === "pr" && b === "ready") { pr.isDraft = false; return json({}); }
    if (a === "pr" && b === "view") return json({ ...pr, headRefOid: pr.headRefOid, mergeStateStatus: "CLEAN" });
    if (a === "pr" && b === "merge") {
      git(origin, "update-ref", "refs/heads/main", opt(args, "--match-head-commit"));
      pr.mergedHead = pr.headRefOid;
      Object.defineProperty(pr, "headRefOid", { value: pr.mergedHead });
      pr.state = "MERGED";
      issues[pr.closes].state = "CLOSED";
      return json({});
    }
    if (a === "api" && /milestones\?/.test(b)) return json(milestones);
    if (a === "api" && args.includes("PATCH")) { milestones[0].state = "closed"; writes.push("milestone close"); return json({}); }
    if (a === "api" && /releases\?/.test(b)) return json(releases);
    if (a === "release" && b === "create") { releases.push({ tag_name: args[2], body: opt(args, "--notes") }); writes.push(`release ${args[2]}`); return json({}); }
    return { code: 1, out: `fake gh: ${args.join(" ")}` };
  };
  const milestones = [{ number: 1, title: "m1", state: "open" }];
  const releases = [{ tag_name: "v0.1.0", body: "" }];
  return { exec, issues, prs, writes, milestones, releases };
}

test("a run delivers the frontier, blocks a failing issue once, and a rerun repeats no GitHub write", async (t) => {
  const { base, repo, origin } = lab();
  const env = { PI_CODING_AGENT_DIR: join(base, "agent"), PITCREW_PROFILE: "local", PITCREW_AGENT_PI: fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url)), PI_VERIFY: "test ! -e bad.txt", FAKE_BREAK: "3" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const gh = fakeGh(origin);
  const lines = [];
  const opts = { cwd: repo, target: ["1", "2", "3"], mode: { stop: "pr", rigor: "fast" }, exec: gh.exec, log: (l) => lines.push(l) };

  // stop pr: #1 gets a ready PR; #3 fails verify after its fix round and is blocked; #2 waits for #1.
  assert.equal(await runTarget(opts), 0);
  assert.deepEqual(gh.prs.map((p) => [p.headRefName, p.state, p.isDraft]), [["1-issue-1", "OPEN", false]]);
  assert.deepEqual(gh.issues[3].labels, ["needs-owner"]);
  assert.equal(gh.issues[3].comments.length, 1);
  assert.match(gh.issues[3].comments[0], /Blocked: verify failed after 1 fix round/);
  assert.match(lines.join("\n"), /stop: only blocked or waiting work is left/);
  assert.match(lines.join("\n"), /budgets with no limit: maxHours, maxIssues, workerTurns, workerMinutes, agent\.maxMinutes/);
  assert.match(lines.join("\n"), /tokens: #1 \d+, #3 \d+; total \d+/);

  // As if the run was killed after the PR: #1 back in "gates". stop merge: the same PR is merged, then #2.
  const ledgerPath = lines.find((l) => l.includes("ledger ")).split("ledger ")[1];
  const l = JSON.parse(readFileSync(ledgerPath, "utf8"));
  l.issues[1].phase = "gates";
  writeFileSync(ledgerPath, JSON.stringify(l));
  const before = gh.writes.length;
  assert.equal(await runTarget({ ...opts, mode: { stop: "merge", rigor: "fast" } }), 0);
  assert.deepEqual(gh.prs.map((p) => [p.headRefName, p.state]), [["1-issue-1", "MERGED"], ["2-issue-2", "MERGED"]]);
  assert.equal(gh.writes.slice(before).filter((w) => w.startsWith("pr create")).length, 1, "only #2's PR is new");
  assert.equal(gh.issues[3].comments.length, 1);
  assert.equal(git(repo, "worktree", "list").split("\n").length, 1, "merged worktrees are gone");
  assert.deepEqual(git(repo, "branch", "--format=%(refname:short)").split("\n").sort(), ["3-issue-3", "main"], "the blocked issue keeps its commits on a local branch");

  // A third run finds nothing to do and writes nothing.
  const writes = gh.writes.length;
  assert.equal(await runTarget({ ...opts, mode: { stop: "merge", rigor: "fast" } }), 0);
  assert.equal(gh.writes.length, writes);
});

test("budgets: 0 means no limit, and it is the default; maxRestarts stays 2; foreign repos run in the sandbox", () => {
  const d = runnerSettings({ onFailure: "stop" }); // a removed key is skipped
  assert.deepEqual([d.maxHours, d.maxIssues, d.workerTurns, d.workerMinutes, d.maxRestarts, d.sandbox], [0, 0, 0, 0, 2, "foreign"]);
  const off = runnerSettings({ maxHours: 0, maxIssues: "0", workerTurns: 0, workerMinutes: 0 });
  assert.deepEqual([off.maxHours, off.maxIssues, off.workerTurns, off.workerMinutes], [0, 0, 0, 0]);
  assert.equal(budgetStop({ now: 10, deadline: Infinity, taken: 500, maxIssues: 0 }), undefined);
  assert.match(budgetStop({ now: 10, deadline: Infinity, taken: 2, maxIssues: 2 }), /maxIssues/);
  assert.equal(childLimitMs(0, Infinity), 0, "no limit at all");
  assert.equal(childLimitMs(0, 5 * 60_000), 5 * 60_000, "the run's wall clock still caps a child");
  assert.equal(childLimitMs(45 * 60_000, Infinity), 45 * 60_000);
  assert.equal(childLimitMs(10_000, Infinity), 60_000, "at least a minute");
  assert.deepEqual(unbounded(d, 0), ["maxHours", "maxIssues", "workerTurns", "workerMinutes", "agent.maxMinutes"]);
  assert.deepEqual(unbounded({ ...d, maxHours: 8, workerTurns: 50 }, 60_000), ["maxIssues", "workerMinutes"]);
  assert.equal(tokenLine(ledger({ 3: { ...newState(), tokens: 99_400 }, 5: { ...newState(), tokens: 1_250_000 }, 6: newState() })), "tokens: #3 99K, #5 1.3M; total 1.3M");
});

test("a quota refusal stops the run with the issue where it was; the same command resumes it", async (t) => {
  const { base, repo, origin } = lab();
  const env = { PI_CODING_AGENT_DIR: join(base, "agent"), PITCREW_PROFILE: "local", PITCREW_AGENT_PI: fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url)), PI_VERIFY: "true", FAKE_QUOTA: "1" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const gh = fakeGh(origin);
  const lines = [];
  const opts = { cwd: repo, target: ["1"], mode: { stop: "merge", rigor: "fast" }, exec: gh.exec, log: (l) => lines.push(l) };
  assert.equal(await runTarget(opts), 0);
  assert.match(lines.join("\n"), /stop: provider quota used up \(quota exceeded[^\n]*nothing is lost: run the same command again after the reset/);
  assert.deepEqual(gh.issues[1].labels, [], "not blocked");
  assert.equal(gh.issues[1].comments.length, 0);
  const ledgerPath = lines.find((l) => l.includes("ledger ")).split("ledger ")[1];
  const st = JSON.parse(readFileSync(ledgerPath, "utf8")).issues[1];
  assert.deepEqual([st.phase, st.attempts], ["work", 0], "the refused start is not counted");
  delete process.env.FAKE_QUOTA; // the window has reset
  assert.equal(await runTarget(opts), 0);
  assert.deepEqual(gh.prs.map((p) => [p.headRefName, p.state]), [["1-issue-1", "MERGED"]]);
  assert.equal(JSON.parse(readFileSync(ledgerPath, "utf8")).issues[1].attempts, 1);
});

test("a foreign repo's .pi/settings.json is ignored (no setup on the host); in your own repo it applies and its workDir wins", async (t) => {
  const { base, repo, origin } = lab();
  const env = { PI_CODING_AGENT_DIR: join(base, "agent"), PITCREW_PROFILE: "local", PITCREW_AGENT_PI: fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url)), PI_VERIFY: "true",
    PITCREW_ROLES: JSON.stringify({ profile: "session", map: { lead: { model: "a/b", thinking: "low" }, worker: { model: "a/b", thinking: "low" }, scout: { model: "a/b", thinking: "low" }, reviewer: { model: "a/b", thinking: "low" } } }) };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  mkdirSync(join(base, "agent"), { recursive: true });
  writeFileSync(join(base, "agent", "settings.json"), JSON.stringify({ pitcrew: { workDir: join(base, "global-wd") } }));
  mkdirSync(join(repo, ".pi"));
  writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ pitcrew: { workDir: join(base, "repo-wd"), runner: { setup: `touch ${join(base, "setup-ran")}` } } }));
  const lines = [];
  const opts = (permission, target) => ({ cwd: repo, target, mode: { stop: "local", rigor: "fast" }, exec: fakeGh(origin, permission).exec, log: (l) => lines.push(l) });

  assert.equal(await runTarget({ ...opts("WRITE", ["1"]), profile: "local", runner: { sandbox: "off" } }), 0);
  assert.equal(existsSync(join(base, "setup-ran")), false, "a foreign repo's setup never runs");
  assert.match(lines.join("\n"), /o\/r is not your repo: its \.pi\/settings\.json is ignored/);
  assert.match(lines.join("\n"), /profile local,/, "--profile wins over the session's role map");
  assert.ok(readdirSync(join(base, "global-wd", "runs", "runner")).length);

  lines.length = 0;
  assert.equal(await runTarget(opts("ADMIN", ["3"])), 0);
  assert.equal(existsSync(join(base, "setup-ran")), true, "your own repo's setup runs");
  assert.match(lines.join("\n"), /profile session,/);
  assert.ok(existsSync(join(base, "repo-wd", "runs", "runner", "issues-3.json")), "the repo's workDir wins over the global one");
  lines.length = 0;
  assert.equal(status(opts("ADMIN", [])), 0);
  assert.match(lines.join("\n"), /^o\/r #3: 0\/1 done/, "status finds the last run in the repo's workDir");
});

test("the end of a milestone closes it and cuts one release; a rerun cuts no second one", async (t) => {
  const { base, repo, origin } = lab();
  const env = { PI_CODING_AGENT_DIR: join(base, "agent"), PITCREW_PROFILE: "local", PITCREW_AGENT_PI: fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url)), PI_VERIFY: "true" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const gh = fakeGh(origin);
  for (const i of Object.values(gh.issues)) i.state = "CLOSED";
  const lines = [];
  const opts = { cwd: repo, target: ["m1"], mode: { stop: "milestone", rigor: "fast" }, exec: gh.exec, log: (l) => lines.push(l) };
  assert.equal(await runTarget(opts), 0);
  assert.deepEqual(gh.writes, ["milestone close", "release v0.2.0"]);
  assert.equal(await runTarget(opts), 0);
  assert.deepEqual(gh.writes, ["milestone close", "release v0.2.0"], "the second run writes nothing (ledger)");
  rmSync(lines.find((l) => l.includes("ledger ")).split("ledger ")[1]);
  assert.equal(await runTarget(opts), 0);
  assert.deepEqual(gh.writes, ["milestone close", "release v0.2.0"], "nor a run from another checkout (the marker in the release notes)");
});
