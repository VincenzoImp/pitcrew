import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Loadout, pidAlive, readJson, writeJson } from "./ledger.ts";
import { childLimit, GRACE_MS, isQuotaError, MAX_DEPTH, readSettings as agentSettings } from "./limits.ts";
import { extractJson, reportStatus } from "./report.ts";
import { type AgentDef, childTools, loadAgents, skillPaths } from "./agents.ts";
import { childArgs, piInvocation, type RpcChild, runChild } from "./rpc-child.ts";
import { DEFAULT_CAPS } from "./settings.ts";
import { deliveryFacts } from "./facts.ts";
import { piModels } from "./pi.ts";
import { chooseActive, ENV_ROLES, loadProfiles, snapshot } from "./profile.ts";
import { discoverVerify } from "./verify.ts";
import { branchChanges, DEFAULT_BOUNDS, leanReport, render as renderLean, settingsBounds } from "./lean.ts";
import { FIX_ROUNDS, type Mode, type ModeInput, resolveMode, reviews, trackingFor } from "./mode.ts";
import { ownSettings, settingsNotice } from "./settings.ts";
import { BOX_RUN, loadSettings as boxSettings } from "./box.ts";
import { agentDir, repoRoot, workPath } from "./paths.ts";
import * as P from "./run-plan.ts";
import { formatProgramStatus, type ProgramStatus } from "@earendil-works/pi-tui";
import { tidy } from "./tidy.ts";

// `pitcrew run`: a deterministic loop over the frontier of a target. Per issue: one worktree and
// branch, one fresh `worker` (a headless pi child, started like the agent tool's children), then
// verify, PR, CI, a fresh `reviewer`, fix rounds, and merge or stop by the `stop` dial; then tidy.
// State: GitHub plus a ledger file in the work folder, so a rerun continues where a run stopped.
// Every GitHub write has a stable request id (a hidden marker, or a lookup first), so a rerun never
// repeats a comment, a PR or a merge. `pitcrew status` prints the digest. Docs: docs/runner.md.

const PKG = fileURLToPath(new URL("../", import.meta.url));
export type Exec = (cmd: "git" | "gh", args: string[], cwd: string, timeoutMs?: number) => { code: number; out: string };
export const exec: Exec = (cmd, args, cwd, timeoutMs = 120_000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() || (r.stderr ?? "").trim() };
};

export interface RunOptions {
  cwd: string;
  target: string[];
  mode?: ModeInput;
  runner?: Record<string, unknown>;
  profile?: string;
  dryRun?: boolean;
  post?: boolean;
  exec?: Exec;
  log?: (line: string) => void;
}

interface Ctx {
  root: string; repo: string; base: string; foreign: boolean; mode: Mode; cfg: P.RunnerSettings; settings: Settings;
  target: P.Target; ledger: P.Ledger; ledgerFile: string; runs: string; runDir: string; exec: Exec; log: (line: string) => void;
  deadline: number; agentLimitMs: number; profileSetting?: string; roles: string; agents: Map<string, AgentDef>; verify?: string;
  child?: RpcChild; stopping?: string; box?: boolean;
}

const now = () => new Date().toISOString();
type Pitcrew = Record<string, any>;
const readSettings = (path: string): Pitcrew => ownSettings(readJson(path)) ?? {};

/**
 * The settings the run obeys: the global file, then the repo's `.pi/settings.json` only when the repo
 * is yours (the guard's test: admin permission). A foreign repo's file could turn protections off or
 * set `runner.setup`, a command that runs on this host; pi does not load it either (project trust "no").
 */
export interface Settings { global: Pitcrew; repo: Pitcrew; files: string[] }
export function trustedSettings(root: string, foreign: boolean): Settings {
  const files = [join(agentDir(), "settings.json"), ...(foreign ? [] : [join(root, ".pi", "settings.json")])];
  return { global: readSettings(files[0]), repo: files[1] ? readSettings(files[1]) : {}, files };
}

function context(o: RunOptions) {
  const root = repoRoot(o.cwd);
  if (!root) throw new Error("not in a git repository");
  const x = o.exec ?? exec;
  const log = o.log ?? ((l: string) => console.log(l));
  const view = x("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef,viewerPermission"], root);
  if (view.code !== 0) throw new Error(`gh repo view: ${view.out.split("\n")[0]}`);
  const info = JSON.parse(view.out);
  const foreign = info.viewerPermission !== "ADMIN";
  const settings = trustedSettings(root, foreign);
  const { global, repo: local } = settings;
  if (foreign && existsSync(join(root, ".pi", "settings.json"))) log(`${info.nameWithOwner} is not your repo: its .pi/settings.json is ignored`);
  for (const file of settings.files) { const notice = settingsNotice(readJson(file)); if (notice) log(notice); }
  const runs = join(workPath(root, "runs", local.workDir ?? global.workDir), "runner");
  mkdirSync(runs, { recursive: true });
  return {
    root, repo: info.nameWithOwner as string, base: (info.defaultBranchRef?.name ?? "main") as string, foreign, settings,
    mode: { ...resolveMode(global.mode, local.mode, o.mode), tracking: trackingFor(local.tracking ?? global.tracking, info.viewerPermission) }, cfg: P.runnerSettings(global.runner, local.runner, o.runner), runs, exec: x, log,
    profileSetting: (local.profile ?? global.profile) as string | undefined,
    // A reviewer has no own limit: pitcrew.agent.maxMinutes (default off), like every child.
    agentLimitMs: childLimit(agentSettings({ pitcrew: { agent: { ...global.agent, ...local.agent } } })),
  };
}

/** The target's ledger, from the run folder. */
function withTarget<T extends { runs: string; repo: string }>(base: T, args: string[]) {
  const target = P.parseTarget(args);
  const ledgerFile = join(base.runs, `${P.targetKey(target)}.json`);
  const ledger = readJson<P.Ledger>(ledgerFile) ?? { target: P.describeTarget(target), args, repo: base.repo, issues: {}, runs: [] };
  return Object.assign(base, { target, ledgerFile, ledger });
}

// ---------------------------------------------------------------- GitHub

function gh(c: Pick<Ctx, "exec" | "root">, args: string[], timeoutMs?: number): string {
  const r = c.exec("gh", args, c.root, timeoutMs);
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${r.out.split("\n").slice(-3).join(" ")}`);
  return r.out;
}
function git(c: Pick<Ctx, "exec">, cwd: string, ...args: string[]): string {
  const r = c.exec("git", args, cwd);
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.out.split("\n").slice(-2).join(" ")}`);
  return r.out;
}

const FIELDS = "number,title,state,labels,blockedBy,subIssuesSummary,url";
const toIssue = (j: any): P.Issue => ({
  number: j.number, title: j.title, open: j.state === "OPEN", labels: (j.labels ?? []).map((l: any) => l.name), url: j.url,
  blockers: (j.blockedBy?.nodes ?? []).filter((b: any) => b.state === "OPEN").map((b: any) => b.number),
  openSubs: (j.subIssuesSummary?.total ?? 0) - (j.subIssuesSummary?.completed ?? 0),
});

/** The target's issues in a stable order: by number; a parent's in sub-issue order; a list as given. */
export function loadIssues(c: Pick<Ctx, "exec" | "root" | "repo">, target: P.Target): P.Issue[] {
  if (target.kind !== "issues") {
    const filter = target.kind === "milestone" ? ["--milestone", target.title] : ["--label", target.name];
    const list = JSON.parse(gh(c, ["issue", "list", "-R", c.repo, ...filter, "--state", "all", "--limit", "500", "--json", FIELDS]));
    return list.map(toIssue).sort((a: P.Issue, b: P.Issue) => a.number - b.number);
  }
  const view = (n: number, extra = "") => JSON.parse(gh(c, ["issue", "view", String(n), "-R", c.repo, "--json", FIELDS + extra]));
  const first = view(target.numbers[0], ",subIssues");
  if (target.numbers.length === 1 && first.subIssues?.nodes?.length) return first.subIssues.nodes.map((s: any) => toIssue(view(s.number)));
  return [toIssue(first), ...target.numbers.slice(1).map((n) => toIssue(view(n)))];
}

/** Comment once per request id. */
function comment(c: Ctx, n: number, id: string, body: string) {
  const bodies: string[] = JSON.parse(gh(c, ["issue", "view", String(n), "-R", c.repo, "--json", "comments", "--jq", "[.comments[].body]"]));
  if (P.hasMarker(bodies, id)) return;
  gh(c, ["issue", "comment", String(n), "-R", c.repo, "--body", `${body}\n\n${P.marker(id)}`]);
}

interface Pr { number: number; state: string; headRefOid: string; isDraft: boolean; url: string }
const findPr = (c: Ctx, branch: string): Pr | undefined =>
  (JSON.parse(gh(c, ["pr", "list", "-R", c.repo, "--head", branch, "--state", "all", "--json", "number,state,headRefOid,isDraft,url"])) as Pr[])
    .sort((a, b) => (a.state === "OPEN" ? -1 : 0) - (b.state === "OPEN" ? -1 : 0))[0];

// ---------------------------------------------------------------- children

interface ChildResult { text: string; ok: boolean; why?: string; quota?: string; turns: number; tokens: number }

/** One fresh headless child (worker or reviewer) in `cwd`, with the run's limits. */
async function child(c: Ctx, name: string, role: string, cwd: string, prompt: string, tag: string): Promise<ChildResult> {
  const def = c.agents.get(name);
  if (!def) return { text: "", ok: false, why: `no agent "${name}"`, turns: 0, tokens: 0 };
  // In the sandbox the worker's run folder is mounted into the box, so it lives outside ~/.pi.
  const boxed = c.box && name === "worker";
  const dir = boxed ? join(boxSettings().cacheDir.replace(/^~(?=\/|$)/, process.env.HOME ?? ""), "runs", `${basename(c.runDir)}-${tag}`) : join(c.runDir, tag);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "role.md"), def.prompt);
  writeFileSync(join(dir, "task.md"), prompt);
  // In the box pitcrew is at /opt/pitcrew; skills of the agent dir are not there.
  const skills = skillPaths(def, [join(PKG, "skills"), join(agentDir(), "skills")])
    ?.flatMap((d) => (!boxed ? [d] : d.startsWith(PKG) ? [join("/opt/pitcrew", d.slice(PKG.length))] : []));
  const lo = { model: `role/${role}`, tools: childTools(def, 1, MAX_DEPTH), skills } as Loadout;
  const workerMode = { ...c.mode, stop: "local", switches: { ...c.mode.switches, review: "off" } };
  const env: NodeJS.ProcessEnv = {
    ...process.env, PITCREW_DEPTH: "1", PITCREW_RUN: dir, PITCREW_TREE: dir, PITCREW_SPAWNS: def.spawns.join(","),
    [ENV_ROLES]: c.roles, PITCREW_MODE: JSON.stringify(workerMode), PI_GUARD_STRICT: "1",
    PITCREW_RUNNER_ROLE: name, PITCREW_RUNNER_BASE: c.base, ...(c.verify ? { PI_VERIFY: c.verify } : {}),
  };
  delete env.PI_GUARD_ALLOW;
  delete env.PITCREW_HUMAN;
  const maxMs = P.childLimitMs(name === "worker" ? c.cfg.workerMinutes * 60_000 : c.agentLimitMs, c.deadline - Date.now());
  const inv = boxed
    ? { command: process.execPath, args: [join(PKG, "bin", "pitcrew"), "box", "run", "--workdir", cwd, "--stdin", "--run-dir", dir, ...(maxMs ? ["--timeout", String(Math.ceil((maxMs + GRACE_MS) / 1000) + 30)] : []),
      ...(c.cfg.setup ? ["--setup", c.cfg.setup] : []), "--"] }
    : piInvocation(false);
  const started = Date.now();
  const { child: p, outcome, limit } = await runChild({
    inv, args: childArgs(lo, boxed ? BOX_RUN : dir), cwd, env, prompt, timeoutMs: maxMs, maxTurns: c.cfg.workerTurns,
    onUi: (req, ch) => ch.respondUi(req.id, { cancelled: true }), // nobody to ask: the child goes on on stated assumptions
    onStart: (ch) => { c.child = ch; },
  });
  c.child = undefined;
  writeFileSync(join(dir, "report.md"), p.finalText);
  writeFileSync(join(dir, "transcript.log"), p.transcript.map((l) => `${l.kind}: ${l.text}`).join("\n"));
  let why = limit;
  const u = p.usage;
  const tokens = u.input + u.output + u.cacheRead + u.cacheWrite;
  c.log(`  ${tag}: ${u.turns} turns, ${tokens} tokens, ${Math.round((Date.now() - started) / 1000)} s`);
  if (c.stopping) why ??= c.stopping;
  if (!why && outcome.kind === "exit") why = outcome.error ?? `exited (code ${outcome.code}): ${p.stderrTail.slice(-300)}`;
  if (!why && p.stopReason === "error") why = p.errorMessage ?? "model error";
  const quota = why && (isQuotaError(why) || isQuotaError(p.errorMessage)) ? why : undefined;
  return { text: p.finalText, ok: !why, why, quota, turns: u.turns, tokens };
}

// ---------------------------------------------------------------- one issue

class Blocked extends Error {}
const block = (why: string, detail = ""): never => { throw Object.assign(new Blocked(why), { detail }); };

function spend(st: P.IssueState, r: ChildResult) { st.tokens += r.tokens; st.turns += r.turns; }

/** Run the worker (first build or a fix round). Blocks the issue on a failed child or a `blocked` report. */
async function work(c: Ctx, issue: P.Issue, st: P.IssueState, body: string, failure?: { gate: string; detail: string }) {
  const tag = failure ? `${issue.number}-fix-${st.rounds}` : `${issue.number}-work-${st.attempts}`;
  const rules = `Work in this worktree on branch \`${st.branch}\` (base \`origin/${c.base}\`). Stop dial \`local\`: build, verify and commit on this branch. ` +
    "Do not push, open a PR, comment on GitHub or merge: the runner does that after you. No human is present: ask nothing, state assumptions in your report." +
    (c.verify ? ` The runner judges the branch with \`${c.verify}\`; do not change that check.` : "");
  const prompt = failure
    ? `/skill:github Fix round ${st.rounds} of ${FIX_ROUNDS[c.mode.rigor]} for issue #${issue.number} of ${c.repo}. The ${failure.gate} check failed:\n\n\`\`\`\n${P.tail(failure.detail, 60)}\n\`\`\`\n\nFix the cause with new commits. ${rules}`
    : `/skill:github Unattended worker of \`pitcrew run\` for issue #${issue.number} of ${c.repo}: ${issue.title}\n\n${body.slice(0, 20_000)}\n\n${rules}` +
      (st.attempts > 1 ? "\n\nAn earlier attempt was cut off: the branch may hold its commits (`git log origin/" + c.base + "..HEAD`). Continue from there." : "");
  const r = await child(c, "worker", "worker", st.worktree!, prompt, tag);
  spend(st, r);
  if (r.quota) {
    // A quota refusal is not the issue's fault: it does not use a worker start or a fix round.
    if (failure) st.rounds--; else st.attempts--;
    throw Object.assign(new Error(P.quotaRefusalText(r.quota)), { stopRun: true });
  }
  if (c.stopping) throw Object.assign(new Error(c.stopping), { stopRun: true });
  if (!r.ok) block(`worker: ${r.why}`, r.text);
  if (reportStatus(r.text) === "blocked") block("the worker reported blocked", r.text);
  return r.text;
}

/** The checks that need no model: a clean worktree, the repo's verify command, the lean-code checks. */
function localChecks(c: Ctx, wt: string): { gate: string; detail: string } | { lean: string[] } {
  const dirty = git(c, wt, "status", "--porcelain");
  if (dirty) return { gate: "clean worktree", detail: `uncommitted files (commit or remove them):\n${dirty}` };
  if (git(c, wt, "rev-list", "--count", `origin/${c.base}..HEAD`) === "0") return { gate: "commits", detail: "the branch has no commit" };
  if (c.verify) {
    // In the sandbox the check runs in a box too: worker-written code never runs on the host.
    const [cmd, args] = c.box
      ? [process.execPath, [join(PKG, "bin", "pitcrew"), "box", "exec", "--workdir", wt, ...(c.cfg.setup ? ["--setup", c.cfg.setup] : []), "--", "bash", "-c", `${c.verify} 2>&1`]]
      : ["bash", ["-c", `${c.verify} 2>&1`]];
    const r = spawnSync(cmd, args, { cwd: wt, encoding: "utf8", timeout: Math.max(60_000, Math.min(30 * 60_000, c.deadline - Date.now())), maxBuffer: 64 << 20 });
    if (r.status !== 0) return { gate: "verify", detail: `\`${c.verify}\` exit ${r.status ?? r.signal}:\n${P.tail(r.stdout ?? "", 60)}` };
  }
  const level = c.mode.switches.leanCode;
  if (level === "off") return { lean: [] };
  const found = branchChanges(wt, `origin/${c.base}`);
  const bounds = { ...DEFAULT_BOUNDS, ...settingsBounds(c.settings.files) };
  const out = renderLean(leanReport(found?.changes ?? [], bounds), level, `origin/${c.base}`);
  return out.exit ? { gate: "lean code", detail: out.lines.join("\n") } : { lean: out.lines.filter((l) => l.startsWith("warn:")) };
}

/** CI on the PR's head, when the repo has workflows. */
function ci(c: Ctx, wt: string, pr: number): { gate: string; detail: string } | undefined {
  if (!existsSync(join(wt, ".github", "workflows"))) return undefined;
  for (let tries = 0; ; tries++) {
    const r = c.exec("gh", ["pr", "checks", String(pr), "-R", c.repo, "--watch", "--fail-fast", "--interval", "15"], c.root, Math.max(60_000, Math.min(45 * 60_000, c.deadline - Date.now())));
    if (/no checks reported/i.test(r.out) && tries < 8) { spawnSync("sleep", ["15"]); continue; }
    if (/no checks reported/i.test(r.out)) return undefined;
    return r.code === 0 ? undefined : { gate: "CI", detail: P.tail(r.out, 40) };
  }
}

const VERDICT = 'End your report with a ```json block: {"verdict": "pass" or "fail", "findings": [{"severity": "blocker|major|minor", "place": "path:line", "problem": "..."}]}. "fail" only for a blocker or major finding with a concrete trigger.';

/** Fresh reviewer(s) when the mode reviews (the `review` switch and the stop dial); at strict also one on the `second` role. */
async function review(c: Ctx, issue: P.Issue, st: P.IssueState, body: string): Promise<{ gate: string; detail: string } | undefined> {
  const roles = !reviews(c.mode) ? [] : c.mode.rigor === "strict" && JSON.parse(c.roles).map?.second ? ["reviewer", "second"] : ["reviewer"];
  const sha = git(c, st.worktree!, "rev-parse", "HEAD");
  const diff = git(c, st.worktree!, "diff", `origin/${c.base}...HEAD`).slice(0, 120_000);
  for (const role of roles) {
    const prompt = `Review the change for issue #${issue.number} of ${c.repo}: ${issue.title}\n\n${body.slice(0, 10_000)}\n\nThe diff of branch \`${st.branch}\` (${sha.slice(0, 12)}) against origin/${c.base}; the files are in this worktree:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n${VERDICT}`;
    for (let k = 1; k <= 2; k++) {
      const r = await child(c, "reviewer", role, st.worktree!, prompt, `${issue.number}-review-${role}-${sha.slice(0, 8)}-${k}`);
      spend(st, r);
      if (r.quota) throw Object.assign(new Error(P.quotaRefusalText(r.quota)), { stopRun: true });
      if (c.stopping) throw Object.assign(new Error(c.stopping), { stopRun: true });
      if (!r.ok) block(`${role} reviewer: ${r.why}`, r.text);
      const v = extractJson(r.text);
      const data = "data" in v ? (v.data as { verdict?: string; findings?: { severity: string; place: string; problem: string }[] }) : undefined;
      if (!data?.verdict) { if (k === 2) block(`the ${role} reviewer gave no verdict twice`, r.text); continue; }
      if (data.verdict === "fail") return { gate: `review (${role})`, detail: (data.findings ?? []).map((f) => `- [${f.severity}] ${f.place}: ${f.problem}`).join("\n") || r.text };
      break;
    }
  }
  return undefined;
}

/** Deliver one issue as far as the stop dial allows. Throws Blocked (the issue waits for the owner) or a stop-run error. */
async function deliver(c: Ctx, issue: P.Issue, st: P.IssueState) {
  const n = issue.number;
  const body = JSON.parse(gh(c, ["issue", "view", String(n), "-R", c.repo, "--json", "body"])).body ?? "";
  st.branch ??= P.branchName(issue);
  st.worktree ??= join(dirname(c.root), `${basename(c.root)}.wt`, st.branch);
  const save = () => writeJson(c.ledgerFile, c.ledger);
  let pr = findPr(c, st.branch);
  if (pr?.state === "MERGED") { st.pr = pr.number; st.phase = "done"; return finish(c, st); }
  if (pr?.state === "CLOSED") block(`PR #${pr.number} was closed without a merge`);
  git(c, c.root, "fetch", "-q", "origin");
  if (!existsSync(st.worktree)) {
    const facts = deliveryFacts({ cwd: c.root, sessionManager: { getBranch: () => [] } }).worktrees(c.root);
    const caps = { ...DEFAULT_CAPS, ...c.settings.global.caps, ...c.settings.repo.caps };
    if (caps.worktrees && facts.count >= caps.worktrees) throw Object.assign(new Error(`worktree cap: ${facts.count} worktrees (pitcrew.caps.worktrees ${caps.worktrees})`), { stopRun: true });
    if (caps.diskGB && facts.gb >= caps.diskGB) throw Object.assign(new Error(`disk cap: ${facts.gb.toFixed(1)} GB (pitcrew.caps.diskGB ${caps.diskGB})`), { stopRun: true });
    const local = c.exec("git", ["rev-parse", "-q", "--verify", `refs/heads/${st.branch}`], c.root).code === 0;
    const from = pr ? [`origin/${st.branch}`] : [`origin/${c.base}`];
    git(c, c.root, "worktree", "add", "-q", ...(local ? [st.worktree, st.branch] : ["-b", st.branch, st.worktree, ...from]));
    if (c.cfg.setup && !c.box) {
      const r = spawnSync("bash", ["-c", `${c.cfg.setup} 2>&1`], { cwd: st.worktree, encoding: "utf8", timeout: 20 * 60_000 });
      if (r.status !== 0) block(`setup \`${c.cfg.setup}\` failed`, r.stdout ?? "");
    }
  }
  if (pr) st.pr = pr.number;
  if (st.phase === "new" || st.phase === "work") {
    st.attempts++;
    if (st.attempts > c.cfg.maxRestarts + 1) block(`restart limit: ${st.attempts - 1} worker starts did not finish (maxRestarts ${c.cfg.maxRestarts})`);
    st.phase = "work";
    save();
    await work(c, issue, st, body);
    st.phase = "gates";
    save();
  }
  let fix: { gate: string; detail: string } | undefined;
  for (;;) {
    if (fix) {
      st.rounds++;
      if (st.rounds > FIX_ROUNDS[c.mode.rigor]) block(`${fix.gate} failed after ${st.rounds - 1} fix round(s)`, fix.detail);
      save();
      c.log(`  fix round ${st.rounds}: ${fix.gate} failed`);
      await work(c, issue, st, body, fix);
      fix = undefined;
    }
    const local = localChecks(c, st.worktree);
    if ("gate" in local) { fix = local; continue; }
    if (c.mode.stop === "local") { st.phase = "local"; return; }
    git(c, st.worktree, "push", "-q", "-u", "origin", `HEAD:refs/heads/${st.branch}`);
    const sha = git(c, st.worktree, "rev-parse", "HEAD");
    pr = findPr(c, st.branch);
    if (!pr || pr.state !== "OPEN") {
      const subject = git(c, st.worktree, "log", "--format=- %s", `origin/${c.base}..HEAD`);
      const text = [`Delivered by \`pitcrew run\` (${P.describeTarget(c.target)}).`, "", "Commits:", subject, "",
        ...(local.lean.length ? ["Lean-code checks:", ...local.lean.map((l) => `- ${l}`), ""] : []), `Closes #${n}`, "", P.marker(`pr:${n}`)].join("\n");
      gh(c, ["pr", "create", "-R", c.repo, "--head", st.branch, "--base", c.base, "--draft", "--title", issue.title, "--body", text]);
      pr = findPr(c, st.branch)!;
    }
    st.pr = pr.number;
    save();
    fix = ci(c, st.worktree, pr.number) ?? (await review(c, issue, st, body));
    if (fix) continue;
    if (pr.isDraft) gh(c, ["pr", "ready", String(pr.number), "-R", c.repo]);
    if (c.mode.stop === "pr" || c.foreign) { st.phase = "ready"; return; }
    merge(c, n, pr.number, sha);
    st.phase = "done";
    return finish(c, st);
  }
}

/** Merge on the checked head, once: a PR that is already merged is left as it is. */
function merge(c: Ctx, n: number, pr: number, sha: string) {
  for (let k = 0; ; k++) {
    const view = JSON.parse(gh(c, ["pr", "view", String(pr), "-R", c.repo, "--json", "state,headRefOid,mergeStateStatus"]));
    if (view.state === "MERGED") return;
    if (view.headRefOid !== sha) block(`PR #${pr} head moved to ${String(view.headRefOid).slice(0, 7)} after the checks`);
    if (view.mergeStateStatus === "CLEAN" || view.mergeStateStatus === "UNSTABLE" || k >= 12) break;
    spawnSync("sleep", ["5"]);
  }
  const r = c.exec("gh", ["pr", "merge", String(pr), "-R", c.repo, "--squash", "--match-head-commit", sha], c.root);
  const state = JSON.parse(gh(c, ["pr", "view", String(pr), "-R", c.repo, "--json", "state"])).state;
  if (state !== "MERGED") block(`merge of PR #${pr} refused`, r.out);
  // The issue closes from the PR's closing keyword a moment later; its dependents wait for that.
  for (let k = 0; k < 10 && JSON.parse(gh(c, ["issue", "view", String(n), "-R", c.repo, "--json", "state"])).state !== "CLOSED"; k++) spawnSync("sleep", ["3"]);
}

function finish(c: Ctx, st: P.IssueState) {
  const r = tidy({ cwd: c.root, targets: [String(st.pr)], run: c.exec });
  if (!r.ok) c.log(r.lines.map((l) => `  ${l}`).join("\n"));
  st.worktree = undefined;
}

/** The issue waits for the owner: label, one comment, worktree removed (the branch stays when it has commits). */
function blockIssue(c: Ctx, issue: P.Issue, st: P.IssueState, why: string, detail: string) {
  st.phase = "blocked";
  st.reason = why;
  c.log(`  blocked: ${why}`);
  if (st.worktree && existsSync(st.worktree)) {
    c.exec("git", ["worktree", "remove", "--force", st.worktree], c.root);
    if (st.branch && c.exec("git", ["rev-list", "--count", `origin/${c.base}..${st.branch}`], c.root).out === "0") c.exec("git", ["branch", "-D", st.branch], c.root);
  }
  st.worktree = undefined;
  if (c.foreign) return;
  c.exec("gh", ["label", "create", P.BLOCKED_LABEL, "-R", c.repo, "--color", "B60205", "--description", "Waits for the owner"], c.root);
  gh(c, ["issue", "edit", String(issue.number), "-R", c.repo, "--add-label", P.BLOCKED_LABEL]);
  const where = st.pr ? `PR #${st.pr} stays open.` : st.branch && c.exec("git", ["rev-parse", "-q", "--verify", `refs/heads/${st.branch}`], c.root).code === 0 ? `The commits are on the local branch \`${st.branch}\`.` : "No commits were kept.";
  comment(c, issue.number, `blocked:${issue.number}:${st.attempts}.${st.rounds}`,
    `Blocked: ${why}.\nTried: \`pitcrew run\`, ${st.attempts} worker start(s), ${st.rounds} fix round(s). ${where}` +
    (detail ? `\nLast output:\n\`\`\`\n${P.tail(detail, 30).replace(/```/g, "ˋˋˋ")}\n\`\`\`` : "") +
    `\nNext: the owner fixes the cause or the issue, then removes the \`${P.BLOCKED_LABEL}\` label; the next \`pitcrew run\` takes it again.`);
}

// ---------------------------------------------------------------- the loop

function takeLock(path: string) {
  for (let k = 0; k < 2; k++) {
    try { const fd = openSync(path, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const pid = Number(readFileSync(path, "utf8"));
    if (pidAlive(pid)) throw new Error(`another pitcrew run works on this repo (pid ${pid})`);
    rmSync(path, { force: true });
  }
  throw new Error(`cannot take the lock ${path}`);
}

export async function runTarget(o: RunOptions): Promise<number> {
  const c = withTarget(context(o), o.target) as unknown as Ctx;
  const issues0 = loadIssues(c, c.target);
  const title = `${c.repo} ${P.describeTarget(c.target)}`;
  if (c.mode.stop === "plan") { c.log("stop plan: nothing to run"); return 2; }
  if (c.foreign && c.mode.stop !== "pr" && c.mode.stop !== "local") {
    c.log(`${c.repo} is not your repo: the run stops at a ready PR (stop pr), and posts no labels or comments`);
    c.mode = { ...c.mode, stop: "pr" };
  }
  if (o.dryRun) {
    c.log(P.renderDigest(P.digest(issues0, c.ledger), title).join("\n"));
    c.log(`frontier: ${P.frontier(issues0, c.ledger).map((i) => `#${i.number}`).join(" ") || "empty"}`);
    return 0;
  }
  c.box = c.cfg.sandbox === "always" || (c.cfg.sandbox === "foreign" && c.foreign);
  if (c.box && spawnSync("docker", ["image", "inspect", boxSettings().image], { stdio: "ignore" }).status !== 0) {
    c.log(`sandbox: image ${boxSettings().image} missing; run \`pitcrew box build\` (or --sandbox off)`);
    return 2;
  }
  const lock = join(c.runs, "runner.lock");
  takeLock(lock);
  const id = now().replace(/[-:.Z]/g, "").replace("T", "-");
  c.runDir = join(c.runs, id);
  mkdirSync(c.runDir, { recursive: true });
  c.deadline = c.cfg.maxHours ? Date.now() + c.cfg.maxHours * 3_600_000 : Infinity; // 0: no wall clock
  c.verify = discoverVerify(c.root)?.command;
  const profiles = loadProfiles([join(PKG, "profiles"), join(agentDir(), "profiles"), ...(c.foreign ? [] : [join(c.root, ".pi", "profiles")])]);
  // --profile wins over the role map of the session this run was started from.
  const named = o.profile || process.env[ENV_ROLES] || process.env.PITCREW_PROFILE || c.profileSetting;
  c.roles = JSON.stringify(snapshot(chooseActive({ profiles, flag: o.profile, envRoles: process.env[ENV_ROLES], envProfile: process.env.PITCREW_PROFILE,
    setting: c.profileSetting, available: named ? undefined : piModels() })));
  c.agents = loadAgents([join(PKG, "agents"), join(agentDir(), "agents")]).agents;
  const entry: P.RunEntry = { id, startedAt: now(), issues: [] };
  c.ledger.runs.push(entry);
  const onSignal = (sig: string) => { c.stopping = `stopped by ${sig}`; void c.child?.stop(); };
  const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((s) => [s, () => onSignal(s)] as const);
  for (const [s, h] of handlers) process.on(s, h);
  const open = P.unbounded(c.cfg, c.agentLimitMs);
  if (open.length) c.log(`budgets with no limit: ${open.join(", ")} (pitcrew.runner, pitcrew.agent; --max-hours, --max-issues)`);
  report(c, "working", title);
  c.log(`pitcrew run ${id}: ${title}; profile ${JSON.parse(c.roles).profile}, stop ${c.mode.stop}, rigor ${c.mode.rigor}${c.box ? ", workers in the sandbox" : ""}; verify ${c.verify ?? "none"}; ledger ${c.ledgerFile}`);
  let stop = "";
  try {
    for (let issues = issues0; ; issues = loadIssues(c, c.target)) {
      const next = P.frontier(issues, c.ledger).find((i) => !entry.issues.includes(i.number));
      if (!next) { stop = issues.some((i) => i.open) ? "only blocked or waiting work is left" : "all issues are closed"; break; }
      stop = c.stopping ?? P.budgetStop({ now: Date.now(), deadline: c.deadline, taken: entry.issues.length, maxIssues: c.cfg.maxIssues }) ?? "";
      if (stop) break;
      const st = (c.ledger.issues[next.number] ??= P.newState());
      if (st.phase === "blocked") Object.assign(st, P.newState(), { branch: st.branch }); // the owner removed the label: try again
      entry.issues.push(next.number);
      c.log(`#${next.number} ${next.title}`);
      const started = Date.now();
      try {
        await deliver(c, next, st);
        c.log(`  ${st.phase}${st.pr ? ` PR #${st.pr}` : ""}`);
      } catch (error) {
        if ((error as { stopRun?: boolean }).stopRun) { stop = (error as Error).message; break; }
        blockIssue(c, next, st, (error as Error).message, (error as { detail?: string }).detail ?? "");
      } finally {
        st.ms += Date.now() - started;
        writeJson(c.ledgerFile, c.ledger);
      }
    }
    const left = loadIssues(c, c.target);
    if (c.mode.stop === "milestone" && c.target.kind === "milestone" && !left.some((i) => i.open)) closeMilestone(c, c.target.title);
    const d = P.digest(left, c.ledger);
    c.log(["", ...P.renderDigest(d, title), ...[P.tokenLine(c.ledger) ?? []].flat(), `stop: ${stop}`].join("\n"));
    report(c, d.blocked.length ? "blocked" : "done", `${title}: ${d.done.length}/${d.total} done; ${stop}`);
    if (c.mode.tracking === "github") postStatus(c, d, title, true);
  } catch (error) {
    stop = `driver error: ${(error as Error).message}`;
    c.log(`pitcrew run: ${stop}`);
    report(c, "error", stop);
  } finally {
    for (const [s, h] of handlers) process.off(s, h);
    entry.endedAt = now();
    entry.stop = stop;
    writeJson(c.ledgerFile, c.ledger);
    rmSync(lock, { force: true });
  }
  return stop.startsWith("driver error") ? 1 : 0;
}

/**
 * Tell the terminal how the run stands (OSC 7501, pi's own status protocol, read by terminals and
 * agent dashboards): working, then done, blocked (issues wait for the owner) or error. Only on a
 * terminal; `pitcrew.notify: false` or PI_PROGRAM_STATUS=0 turns it off.
 */
function report(c: Ctx, state: ProgramStatus["state"], message: string) {
  if (c.settings.global.notify === false || process.env.PI_PROGRAM_STATUS === "0" || !process.stdout.isTTY) return;
  process.stdout.write(formatProgramStatus({ state, app: "pitcrew", message, ...(state === "blocked" ? { kind: "question" as const } : {}) }));
}

/** End of a milestone: close it, and cut the next 0.x release when the repo has releases. */
function closeMilestone(c: Ctx, titleText: string) {
  const ms = (JSON.parse(gh(c, ["api", `repos/${c.repo}/milestones?state=all&per_page=100`])) as { number: number; title: string; state: string }[]).find((m) => m.title === titleText);
  if (ms?.state === "open") { gh(c, ["api", "-X", "PATCH", `repos/${c.repo}/milestones/${ms.number}`, "-f", "state=closed"]); c.log(`milestone "${titleText}" closed`); }
  // One release per milestone: the ledger records it, and its notes carry a hidden request id (for a
  // rerun from another checkout; GitHub's list can lag a few seconds behind a new release).
  if (c.ledger.release) return;
  const releases = JSON.parse(gh(c, ["api", `repos/${c.repo}/releases?per_page=100`])) as { tag_name: string; body?: string | null }[];
  const id = `release:${titleText}`;
  const found = releases.find((r) => P.hasMarker([r.body ?? ""], id));
  if (found) { c.ledger.release = found.tag_name; return; }
  const next = P.nextRelease(releases.map((r) => r.tag_name));
  if (!next) return;
  gh(c, ["release", "create", next, "-R", c.repo, "--target", c.base, "--title", next, "--generate-notes", "--notes", `Milestone "${titleText}".\n\n${P.marker(id)}`]);
  c.ledger.release = next;
  c.log(`release ${next}`);
}

/** The digest as a status update of the repo's one linked Project, unless the last update says the same. */
function postStatus(c: Ctx, d: P.Digest, title: string, quiet = false) {
  const projects = JSON.parse(gh(c, ["repo", "view", c.repo, "--json", "projectsV2"])).projectsV2?.Nodes ?? [];
  const project = projects.length === 1 ? projects[0] : undefined;
  if (!project) { if (!quiet) c.log(`status update: needs exactly one Project linked to the repo; ${projects.length} linked`); return; }
  const body = P.renderDigest(d, title).join("\n");
  const last = JSON.parse(gh(c, ["api", "graphql", "-f", `p=${project.id}`, "-f", "query=query($p:ID!){node(id:$p){... on ProjectV2{statusUpdates(last:1){nodes{body}}}}}"]));
  if (last.data?.node?.statusUpdates?.nodes?.[0]?.body === body) return;
  gh(c, ["api", "graphql", "-f", `p=${project.id}`, "-f", `b=${body}`, "-f", `s=${P.projectStatus(d)}`, "-f",
    "query=mutation($p:ID!,$b:String!,$s:ProjectV2StatusUpdateStatus!){createProjectV2StatusUpdate(input:{projectId:$p,body:$b,status:$s}){statusUpdate{id}}}"]);
  c.log(`status update posted to Project #${project.number}`);
}

/** `pitcrew status [target] [--post]`: the digest from GitHub and the ledger. No target: the last run's. */
export function status(o: RunOptions): number {
  const base = context(o);
  let target = o.target;
  if (!target.length) {
    const last = readdirSync(base.runs).filter((f) => f.endsWith(".json")).sort((a, b) => statSync(join(base.runs, b)).mtimeMs - statSync(join(base.runs, a)).mtimeMs)[0];
    if (!last) { base.log("pitcrew status: no run yet; name a target"); return 2; }
    target = readJson<P.Ledger>(join(base.runs, last))!.args;
  }
  const c = withTarget(base, target) as unknown as Ctx;
  const d = P.digest(loadIssues(c, c.target), c.ledger);
  const title = `${c.repo} ${P.describeTarget(c.target)}`;
  c.log([...P.renderDigest(d, title), ...[P.tokenLine(c.ledger) ?? []].flat()].join("\n"));
  const last = c.ledger.runs.at(-1);
  if (last) c.log(`last run ${last.id}: ${last.endedAt ? `stopped: ${last.stop}` : "running or killed"}`);
  if (o.post) postStatus(c, d, title);
  return 0;
}
