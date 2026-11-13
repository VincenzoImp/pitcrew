import { git as gitRun, gitStrict } from "./git.ts";
import { ownSettings } from "./settings.ts";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { agentDir } from "./paths.ts";

// The sandbox (`pitcrew box`, docs/sandbox.md): the whole pi process in a hardened Docker container on
// a throwaway clone of a repo. The box never sees host git metadata: it gets
// a clone (`--no-hardlinks`, no remote) and its commits come back by a host-side `git fetch` from the
// clone, which runs `git upload-pack` there and so ignores the clone's hooks and config (git(1),
// SECURITY). Its only network is a per-run internal network whose one exit is the egress proxy:
// HTTPS to an allow list, and the model API through a port that swaps the box's placeholder token
// for the real one. The real token never enters the box.

const PKG = fileURLToPath(new URL("../", import.meta.url));
const home = (p: string) => p.replace(/^~(?=\/|$)/, homedir());
const PI_VERSION = JSON.parse(readFileSync(join(PKG, "box", "package.json"), "utf8")).dependencies["@earendil-works/pi-coding-agent"];

export const DEFAULTS = {
  image: `pitcrew-box:${PI_VERSION}`, net: "proxy", allow: [] as string[], memory: "16g", cpus: "8", pidsLimit: 512,
  tokenFile: "~/.config/pitcrew/claude-token", stateDir: "~/.local/state/pitcrew", cacheDir: "~/.cache/pitcrew",
  guardAllow: "write-outside,rm-outside,global-install", subnetPool: "10.250.77.0/24", timeoutSec: 0,
};
export type BoxSettings = typeof DEFAULTS;
/** Never mounted, whatever the options say (checked on the path and its realpath). */
// `.config/pi-env` and `.local/state/pi-env`: the paths before the rename to pitcrew, which may still hold a token.
export const FORBIDDEN = [".pi", ".claude", ".claude.json", ".ssh", ".config/gh", ".config/pitcrew", ".local/state/pitcrew", ".config/pi-env", ".local/state/pi-env",
  ".codex", ".aws", ".gnupg", ".docker", ".kube", ".git-credentials", ".netrc", ".npmrc", ".password-store"].map((p) => join(homedir(), p));
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Environment the box takes from the caller: the runner's role map, mode and limits; nothing else. */
const PASS_ENV = /^(PITCREW_(ROLES|MODE|SPAWNS|DEPTH|AGENT_LIMITS|RUNNER_ROLE|RUNNER_BASE)|PI_VERIFY)$/;
/** Where a run folder (`--run-dir`) appears in the box. */
export const BOX_RUN = "/home/agent/run";

/** `pitcrew.box` of the global settings: only `net`, `allow` and `tokenFile` are settings; the rest are constants. */
export function loadSettings(): BoxSettings {
  let raw: Record<string, unknown> = {};
  try { raw = ownSettings(JSON.parse(readFileSync(join(agentDir(), "settings.json"), "utf8")))?.box ?? {}; } catch { /* no settings */ }
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(raw).filter(([k]) => ["net", "allow", "tokenFile"].includes(k))) };
}

export interface BoxOptions {
  cmd: string; target?: string; workdir?: string; id?: string; base?: string; branch?: string; net?: string; allow: string[];
  timeoutSec?: string; stdin?: boolean; setup?: string; runDir?: string; summary?: string; args: string[];
}

export function parseArgs(argv: string[]): BoxOptions {
  const [cmd, ...rest] = argv;
  const dash = rest.indexOf("--");
  const own = dash < 0 ? rest : rest.slice(0, dash);
  const o: BoxOptions = { cmd, args: dash < 0 ? [] : rest.slice(dash + 1), allow: [] };
  const valued: Record<string, keyof BoxOptions> = { "--id": "id", "--base": "base", "--branch": "branch", "--net": "net", "--timeout": "timeoutSec",
    "--workdir": "workdir", "--setup": "setup", "--run-dir": "runDir", "--summary": "summary" };
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a === "--allow") o.allow.push(own[++i]);
    else if (a === "--stdin") o.stdin = true;
    else if (valued[a]) (o as any)[valued[a]] = own[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (!o.target) o.target = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (o.net && !["proxy", "open"].includes(o.net)) throw new Error("--net must be proxy or open");
  if (o.workdir && o.target) throw new Error("give <repo> or --workdir, not both");
  if (o.id !== undefined && !ID_RE.test(o.id)) throw new Error(`--id must match ${ID_RE}`);
  if (o.workdir && o.branch) throw new Error("--branch is for <repo>; --workdir keeps the worktree's branch");
  if (o.cmd === "exec" && !o.args.length) throw new Error("usage: pitcrew box exec (<repo>|--workdir DIR) -- CMD...");
  if (o.args[0] === "pi" && o.cmd !== "exec") o.args.shift();
  return o;
}

export const newId = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15) + "-" + randomBytes(2).toString("hex");
const realOr = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const under = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");

/** Throws when a host path must not go into the box (credential dirs, home, /). */
export function checkMount(p: string) {
  for (const x of new Set([resolve(p), realOr(p)])) {
    if (x === "/" || x === homedir() || x === realOr(homedir())) throw new Error(`refusing to mount ${p}`);
    for (const f of FORBIDDEN) if (under(x, f) || under(x, realOr(f)) || under(f, x)) throw new Error(`refusing to mount ${p}`);
  }
}

export interface DockerConfig {
  id: string; work: string; pitcrewDir: string; pitcrewModules?: string; image: string; memory: string; cpus: string | number; pidsLimit: number; guardAllow: string;
  runDir?: string; network?: string; proxy?: string; inject?: boolean; placeholder?: string; passEnv?: Record<string, string>;
  setup?: string; tty?: boolean; stdin?: boolean; command: string[];
}

/** Full `docker run` argument list. Pure, so tests can check the hardening. */
export function dockerRunArgs(c: DockerConfig): string[] {
  for (const p of [c.work, c.pitcrewDir, ...(c.pitcrewModules ? [c.pitcrewModules] : []), ...(c.runDir ? [c.runDir] : [])]) checkMount(p);
  const env: Record<string, string> = { ...c.passEnv, PI_GUARD_STRICT: "1", PI_GUARD_ALLOW: c.guardAllow, PITCREW_BOX_ID: c.id, ...(c.setup ? { PITCREW_BOX_SETUP: c.setup } : {}) };
  if (c.runDir) Object.assign(env, { PITCREW_RUN: BOX_RUN, PITCREW_TREE: BOX_RUN });
  if (c.proxy) Object.assign(env, { HTTPS_PROXY: c.proxy, HTTP_PROXY: c.proxy, https_proxy: c.proxy, http_proxy: c.proxy, NO_PROXY: "egress", no_proxy: "egress" });
  if (c.inject) Object.assign(env, { CLAUDE_CODE_OAUTH_TOKEN: c.placeholder!, ANTHROPIC_BASE_URL: "http://egress:8080" });
  const command = c.setup ? ["bash", "-c", 'eval "$PITCREW_BOX_SETUP" && exec "$@"', "box-setup", ...c.command] : c.command;
  return [
    "run", "--rm", "--init", "--name", `pitcrew-box-${c.id}`, ...(c.tty ? ["-it"] : c.stdin ? ["-i"] : []),
    "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", String(c.pidsLimit), "--memory", c.memory, "--cpus", String(c.cpus),
    "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=4g", "--tmpfs", "/home/agent:rw,exec,nosuid,nodev,uid=1000,gid=1000,size=2g",
    "--network", c.network ?? "bridge",
    "-v", `${c.work}:/work`, "-v", `${c.pitcrewDir}:/opt/pitcrew:ro`, ...(c.pitcrewModules ? ["-v", `${c.pitcrewModules}:/opt/pitcrew/node_modules:ro`] : []), ...(c.runDir ? ["-v", `${c.runDir}:${BOX_RUN}`] : []),
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-w", "/work", c.image, ...command,
  ];
}

/** The Claude token, from a file the owner keeps with mode 600. Never printed. */
export function readToken(file: string): string {
  if (statSync(file).mode & 0o077) throw new Error(`${file} must be mode 600`);
  const t = readFileSync(file, "utf8").trim();
  if (!t) throw new Error(`${file} is empty`);
  return t;
}

/** A placeholder of the token's shape: what the box holds instead of the token. */
export const placeholder = () => `sk-ant-oat01-${randomBytes(60).toString("base64url").slice(0, 80)}AA`;

/**
 * pitcrew as committed, without its .git: `git archive <commit>` unpacked read-only to
 * <cacheDir>/pitcrew/<sha>. An npm install has no .git: its files are copied, keyed by version.
 * node_modules come from the install (mounted read-only): the package's own, or the folder an npm
 * install put the package and its dependencies in.
 */
export function pitcrewSnapshot(cacheDir: string, repo = PKG) {
  const isGit = existsSync(join(repo, ".git"));
  const sha = isGit ? git(repo, "rev-parse", "HEAD^{commit}") : `npm-${JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version}`;
  const dir = join(cacheDir, "pitcrew", sha);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const copy = isGit ? 'git -C "$1" archive "$2" | tar -x -C "$3"' : 'tar -C "$1" --exclude=./node_modules -cf - . | tar -x -C "$3"';
    execFileSync("sh", ["-c", `${copy} && mkdir -p "$3/node_modules" && chmod -R a-w "$3"`, "_", repo, sha, dir]);
  }
  const own = join(repo, "node_modules");
  return { sha, dir, modules: existsSync(own) ? own : dirname(dirname(repo)).endsWith("node_modules") ? dirname(dirname(repo)) : dirname(repo) };
}

const git = gitStrict;
const gitOk = (cwd: string, ...a: string[]) => gitRun(cwd, ...a).code === 0;
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8" });

/** The box's repo: a clone of `src` at `sha` on `branch`, no remote, no hardlinks; origin/* refs copied. */
export function cloneForBox(src: string, work: string, { branch, sha }: { branch: string; sha: string }) {
  mkdirSync(dirname(work), { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", src, work], { stdio: ["ignore", "ignore", "pipe"] });
  git(work, "remote", "remove", "origin");
  git(work, "fetch", "--quiet", "--no-tags", src, "+refs/remotes/origin/*:refs/remotes/origin/*");
  git(work, "checkout", "--quiet", "-B", branch, sha);
  for (const k of ["user.name", "user.email"]) { try { git(work, "config", k, git(src, "config", k)); } catch { /* unset */ } }
}

export interface Summary {
  id: string; mode: "clone" | "workdir" | "exec"; repo: string; work: string; branch: string; baseSha: string; headBefore?: string;
  headAfter?: string; commits?: number | null; fetched?: string; diverged?: boolean; kept?: string; fetchError?: string; removed?: boolean;
  image?: string; net?: string; allow?: string[] | string; egressLog?: string | null; injected?: boolean; exitCode?: number; timedOut?: boolean; startMs?: number;
}

/** `run <repo>`: a sibling clone on a new branch that must not exist in the source yet. */
export function prepareClone(target: string, { id, cacheDir, base = "HEAD", branch = `box/${id}` }: { id: string; cacheDir: string; base?: string; branch?: string }) {
  const repo = git(resolve(target), "rev-parse", "--show-toplevel");
  if (!gitOk(repo, "check-ref-format", "--branch", branch)) throw new Error(`--branch ${branch}: not a valid branch name`);
  if (gitOk(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)) throw new Error(`branch ${branch} already exists in ${repo}: pick another --branch`);
  const baseSha = git(repo, "rev-parse", `${base}^{commit}`);
  const work = join(cacheDir, "work", id);
  cloneForBox(repo, work, { branch, sha: baseSha });
  return { mode: "clone" as const, repo, work, branch, baseSha };
}

/**
 * `--workdir`: a clean linked worktree on a branch (a plain checkout is refused for `run`: landing
 * the result would move the branch checked out in the owner's main tree). The box works on a clone.
 */
export function prepareWorkdir(dir: string, { id, cacheDir, needWorktree = true }: { id: string; cacheDir: string; needWorktree?: boolean }) {
  const top = git(resolve(dir), "rev-parse", "--show-toplevel");
  if (needWorktree && realOr(git(top, "rev-parse", "--absolute-git-dir")) === realOr(join(top, ".git"))) {
    throw new Error(`--workdir ${top} is a plain checkout, not a linked worktree: refused (the result would move its checked-out branch). Use \`pitcrew box run ${top}\``);
  }
  let branch: string;
  try { branch = git(top, "symbolic-ref", "--quiet", "--short", "HEAD"); } catch { throw new Error(`--workdir ${top}: HEAD is detached; check out a branch`); }
  if (git(top, "status", "--porcelain")) throw new Error(`--workdir ${top} has uncommitted changes: commit or stash them (the box gets the commits only)`);
  const headBefore = git(top, "rev-parse", "HEAD");
  const work = join(cacheDir, "work", id);
  cloneForBox(top, work, { branch, sha: headBefore });
  return { mode: "workdir" as const, repo: top, work, branch, baseSha: headBefore, headBefore };
}

/** The clone must still be a plain repo: no symlinked .git, no gitfile, no commondir redirect. */
export function checkCloneShape(work: string) {
  const g = join(work, ".git");
  let st;
  try { st = lstatSync(g); } catch { throw new Error(`${g} is missing`); }
  if (!st.isDirectory()) throw new Error(`${g} is not a directory (the box replaced it)`);
  for (const f of ["commondir", "gitdir"]) if (existsSync(join(g, f))) throw new Error(`${g}/${f} exists (the box redirected the repo)`);
}

/**
 * Host side: fetch the box branch into refs/pitcrew-box/<id> of the source repo, count new commits, then
 * land them: clone mode creates the new branch; workdir mode fast-forwards the worktree, or reports
 * `diverged` and keeps the result in that ref.
 */
export function fetchBack(s: Summary) {
  checkCloneShape(s.work);
  const tmp = `refs/pitcrew-box/${s.id}`;
  try {
    git(s.repo, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", join(s.work, ".git"), `+refs/heads/${s.branch}:${tmp}`);
  } catch (e) { s.fetchError = String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().split("\n").at(-1); return s; }
  const head = git(s.repo, "rev-parse", tmp);
  s.headAfter = head;
  const ff = gitOk(s.repo, "merge-base", "--is-ancestor", s.baseSha, head);
  s.commits = ff ? Number(git(s.repo, "rev-list", "--count", `${s.baseSha}..${head}`)) : null;
  if (!ff) { s.diverged = true; s.kept = tmp; s.headAfter = s.headBefore ?? s.baseSha; return s; }
  if (s.commits! > 0) {
    if (s.mode === "workdir") git(s.repo, "merge", "--ff-only", "--quiet", head);
    else git(s.repo, "update-ref", `refs/heads/${s.branch}`, head, "");
    s.fetched = s.branch;
  }
  if (s.mode === "workdir") s.headAfter = git(s.repo, "rev-parse", "HEAD");
  git(s.repo, "update-ref", "-d", tmp);
  return s;
}

export function removeTree(dir: string) {
  spawnSync("chmod", ["-R", "u+rwx", dir], { stdio: "ignore" });
  rmSync(dir, { recursive: true, force: true });
}

/** /28 slots of an IPv4 pool such as 10.250.77.0/24. */
export function subnetSlots(pool: string): string[] {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(pool ?? "");
  if (!m || Number(m[5]) > 28) throw new Error(`subnetPool ${pool}: need an IPv4 /28 or larger`);
  const base = m.slice(1, 5).reduce((a, x) => a * 256 + Number(x), 0) >>> 0;
  const ip = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
  return Array.from({ length: 2 ** (28 - Number(m[5])) }, (_, k) => `${ip(base + k * 16)}/28`);
}

/** A private internal network per run and its egress proxy (with the token, when it injects). */
function startEgress(c: { id: string; image: string; subnetPool: string }, allow: string[], logFile: string, token?: string, ph?: string) {
  docker("network", "prune", "-f", "--filter", "label=pitcrew-box", "--filter", "until=10m");
  const net = `pitcrew-box-net-${c.id}`;
  let made: string | undefined, last = "";
  for (const subnet of subnetSlots(c.subnetPool)) {
    const r = docker("network", "create", "--internal", "--label", "pitcrew-box", "--subnet", subnet, net);
    if (r.status === 0) { made = subnet; break; }
    last = r.stderr.trim();
    if (!/overlap|pool/i.test(last)) break;
  }
  if (!made) throw new Error(`docker network create ${net}: ${last} (the subnet pool is fixed in lib/box.ts)`);
  const name = `pitcrew-box-egress-${c.id}`;
  const r = spawnSync("docker", ["run", "-d", "--rm", "--init", "--name", name, "--user", "1000:1000", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--read-only", "--pids-limit", "64", "--memory", "256m",
    "-e", `PITCREW_BOX_ALLOW=${allow.join(",")}`, ...(token ? ["-e", "PITCREW_BOX_TOKEN", "-e", `PITCREW_BOX_PLACEHOLDER=${ph}`] : []),
    "--entrypoint", "node", c.image, "/opt/pitcrew-box/egress-proxy.mjs"], { encoding: "utf8", env: { ...process.env, ...(token ? { PITCREW_BOX_TOKEN: token } : {}) } });
  if (r.status !== 0) { docker("network", "rm", net); throw new Error(`egress proxy: ${r.stderr}`); }
  docker("network", "connect", "--alias", "egress", net, name);
  return { network: net, subnet: made, proxy: "http://egress:3128", stop: () => {
    writeFileSync(logFile, docker("logs", name).stdout ?? ""); docker("rm", "-f", name); docker("network", "rm", net);
  } };
}

/**
 * Run a box. `run` runs pi (or bash for `shell`) with the injecting proxy; `exec` runs a command
 * with no token at all and brings nothing back. Resolves to the summary (also in <stateDir>/<id>/run.json).
 */
export async function run(o: BoxOptions, { interactive = false } = {}): Promise<Summary> {
  const exec = o.cmd === "exec";
  const s = loadSettings();
  if (o.net) s.net = o.net;
  if (o.timeoutSec) s.timeoutSec = Number(o.timeoutSec);
  const id = o.id ?? newId();
  const token = exec ? undefined : readToken(home(s.tokenFile));
  const state = join(home(s.stateDir), id);
  if (existsSync(join(state, "run.json"))) throw new Error(`run id ${id} already used (${state})`);
  mkdirSync(state, { recursive: true });
  const t0 = Date.now();
  const summary: Summary = { id, ...(o.workdir || exec
    ? prepareWorkdir(o.workdir ?? o.target!, { id, cacheDir: home(s.cacheDir), needWorktree: !exec })
    : prepareClone(o.target!, { id, cacheDir: home(s.cacheDir), base: o.base, branch: o.branch })) };
  if (exec) summary.mode = "exec";
  const allow = [...new Set([...(await import("../box/egress-proxy.mjs")).DEFAULT_ALLOW, ...s.allow, ...o.allow])];
  const inject = Boolean(token) && s.net === "proxy";
  const ph = placeholder();
  const passEnv = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => PASS_ENV.test(k) && v !== undefined)) as Record<string, string>;
  const pe = pitcrewSnapshot(home(s.cacheDir));
  const c: DockerConfig = { ...s, id, work: summary.work, pitcrewDir: pe.dir, pitcrewModules: pe.modules, runDir: o.runDir && resolve(o.runDir), passEnv, setup: o.setup, inject, placeholder: ph,
    tty: Boolean(process.stdin.isTTY && (interactive || (!exec && !o.args.length))), stdin: interactive || Boolean(o.stdin),
    command: interactive ? ["bash", "-l"] : exec ? o.args : ["pi", ...o.args] };
  if (c.runDir) mkdirSync(c.runDir, { recursive: true });
  let egress: ReturnType<typeof startEgress> | undefined;
  let code = 1;
  try {
    dockerRunArgs(c); // mount checks before any container starts
    egress = s.net === "proxy" ? startEgress({ id, image: s.image, subnetPool: s.subnetPool }, allow, join(state, "egress.log"), inject ? token : undefined, ph) : undefined;
    if (egress) Object.assign(c, { network: egress.network, proxy: egress.proxy });
    // With net open there is no proxy: the box gets the token itself (stated on stderr).
    const env = { ...process.env, ...(token && !inject ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) };
    const args = dockerRunArgs(c);
    if (token && !inject) args.splice(args.indexOf("-w"), 0, "-e", "CLAUDE_CODE_OAUTH_TOKEN");
    Object.assign(summary, { image: s.image, net: s.net, allow: egress ? allow : "all (no egress filter)", egressLog: egress ? join(state, "egress.log") : null, injected: inject });
    writeFileSync(join(state, "run.json"), JSON.stringify(summary, null, 2) + "\n");
    process.stderr.write(`pitcrew box ${id}: ${summary.mode} ${summary.repo} → ${summary.work} branch ${summary.branch}; pitcrew ${pe.sha.slice(0, 12)}; net ${s.net}` +
      `${egress ? ` (allow ${allow.join(" ")}${inject ? "; model API through the token proxy" : ""})` : " WARNING: unfiltered network, real token in the box"}; logs ${state}\n`);
    summary.startMs = Date.now() - t0;
    const stop = () => docker("kill", `pitcrew-box-${id}`);
    const child = spawn("docker", args, { stdio: "inherit", env });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, stop);
    const timer = Number(s.timeoutSec) > 0 ? setTimeout(() => { summary.timedOut = true; stop(); }, Number(s.timeoutSec) * 1000) : undefined;
    try { code = await new Promise<number>((ok) => child.on("exit", (n, sig) => ok(n ?? (sig ? 128 : 1)))); }
    finally { if (timer) clearTimeout(timer); for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(sig, stop); }
  } finally {
    egress?.stop();
  }
  if (!exec) { try { fetchBack(summary); } catch (e) { summary.fetchError = (e as Error).message; } }
  if (!summary.fetchError && !summary.diverged && summary.mode !== "clone") { removeTree(summary.work); summary.removed = true; }
  if (summary.mode === "clone" && !summary.fetchError) { removeTree(summary.work); summary.removed = true; }
  summary.exitCode = code;
  writeFileSync(join(state, "run.json"), JSON.stringify(summary, null, 2) + "\n");
  if (o.summary) writeFileSync(o.summary, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export const USAGE = `  pitcrew box build                                      build the sandbox image from box/
  pitcrew box run [opts] <repo> -- [pi args]             pi on a clone; new commits come back as branch box/<id>
  pitcrew box run [opts] --workdir <worktree> -- [pi args]  pi on a clone of a clean linked worktree; commits fast-forward it
  pitcrew box exec [opts] (<repo>|--workdir <dir>) -- CMD...  a command (no model, no token) on a clone; nothing comes back
  pitcrew box shell <repo>                               bash in the same box
      Options: --id ID --base REF --branch NAME --net proxy|open --allow HOST --timeout SEC --stdin
               --setup CMD --run-dir DIR --summary FILE. Defaults: pitcrew.box in settings.json.`;

/** `pitcrew box …`; returns the exit code. */
export async function boxCommand(argv: string[]): Promise<number> {
  const o = parseArgs(argv);
  if (o.cmd === "build") {
    return spawnSync("docker", ["build", "-t", loadSettings().image, join(PKG, "box")], { stdio: "inherit" }).status ?? 1;
  }
  if (["run", "shell", "exec"].includes(o.cmd) && (o.target || o.workdir)) {
    const r = await run(o, { interactive: o.cmd === "shell" });
    const what = r.mode === "exec" ? "nothing fetched (exec)"
      : r.fetchError ? `NOT fetched: ${r.fetchError}; clone kept at ${r.work}`
      : r.diverged ? `history rewritten in the box: NOT applied; kept as ${r.kept}`
      : `${r.commits} commit(s)${r.fetched ? `, ${r.mode === "workdir" ? "fast-forwarded" : "fetched as"} ${r.fetched}` : ""}`;
    process.stderr.write(`pitcrew box ${r.id}: exit ${r.exitCode}, set-up ${r.startMs} ms, ${what}\n`);
    return r.exitCode || (r.fetchError || r.diverged ? 1 : 0);
  }
  process.stderr.write(`usage:\n${USAGE}\n`);
  return 2;
}
