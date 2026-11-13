import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { agentDir as defaultAgentDir } from "./paths.ts";
import { piModels } from "./pi.ts";
import { firstWorking, loadProfiles, type RoleMap } from "./profile.ts";

// `pitcrew init`: one command that sets pitcrew up for a new user, and checks an existing setup.
// It only adds: a settings key that is already there is never changed. Idempotent. Docs: docs/install.md.
// It imports nothing outside node and lib/, so it runs before the package's dependencies are installed.

const PKG = fileURLToPath(new URL("../", import.meta.url));
const REPO = "github.com/vincenzoimp/pitcrew";

export interface Tools {
  gh: boolean; ghAuth: boolean; docker: boolean; boxImage: boolean; exa: boolean; bridge: boolean; browser: boolean; claudeToken: boolean;
}

export interface Facts {
  node: string;
  nodeMin: string;
  pi?: string; // `pi --version`, undefined when pi is missing
  piTested: string;
  pkgDir: string;
  pkgName: string;
  agentDir: string;
  settings: Record<string, any>;
  base: Record<string, any>;
  models: string[];
  profiles: Record<string, RoleMap>;
  onPath?: string; // realpath of the `pitcrew` command found on PATH
  binDir: string;
  pathDirs: string[];
  tools: Tools;
  bridgeVersion: string;
}

export interface Answers {
  profile?: boolean; // take the proposed profile
  rules?: boolean; // turn the rules section on
}

export interface Plan {
  lines: string[];
  ok: boolean; // false: a required part is missing; nothing is changed
  settings?: Record<string, any>; // new settings.json content, when it changes
  install?: string; // a source for `pi install`
  link?: { from: string; to: string };
  questions: { profile?: string; rules?: boolean };
}

const newer = (a: string, b: string) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
};

const sourceOf = (entry: unknown): string | undefined =>
  typeof entry === "string" ? entry : typeof entry === "object" && entry ? (entry as { source?: string }).source : undefined;

/** The settings entry that already loads this package, and the folder pi loads it from. */
export function registered(f: Pick<Facts, "settings" | "agentDir" | "pkgDir" | "pkgName">): { source: string; dir: string } | undefined {
  for (const entry of f.settings.packages ?? []) {
    const source = sourceOf(entry);
    if (!source) continue;
    if (source === `npm:${f.pkgName}` || source.startsWith(`npm:${f.pkgName}@`)) return { source, dir: join(f.agentDir, "npm", "node_modules", f.pkgName) };
    const plain = source.replace(/^git:/, "").replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/@[^/]*$/, "");
    if (plain.toLowerCase() === REPO) return { source, dir: join(f.agentDir, "git", ...plain.split("/")) };
    if (source.startsWith("npm:") || source.startsWith("git:") || /^https?:/.test(source)) continue;
    const path = isAbsolute(source) ? source : resolve(f.agentDir, source.replace(/^~(?=\/)/, homedir()));
    try {
      if (realpathSync(path) === realpathSync(f.pkgDir)) return { source, dir: path };
    } catch { /* a path that does not exist is not this package */ }
  }
  return undefined;
}

/** Add what `base` has and `into` lacks, one level into `pitcrew`. Returns the keys added. */
export function mergeMissing(into: Record<string, any>, base: Record<string, any>): string[] {
  const added: string[] = [];
  for (const [key, value] of Object.entries(base)) {
    if (key === "pitcrew") {
      into.pitcrew ??= {};
      for (const [k, v] of Object.entries(value as object)) if (!(k in into.pitcrew)) { into.pitcrew[k] = v; added.push(`pitcrew.${k}`); }
      if (Object.keys(into.pitcrew).length === 0) delete into.pitcrew;
    } else if (!(key in into)) {
      into[key] = value;
      added.push(key);
    }
  }
  return added;
}

/** What init would do, from the facts and the owner's answers. Pure: the caller applies it. */
export function plan(f: Facts, a: Answers = {}): Plan {
  const lines: string[] = [];
  const out: Plan = { lines, ok: true, questions: {} };
  const say = (state: string, text: string) => lines.push(`${state.padEnd(7)} ${text}`);

  // Required parts.
  if (newer(f.node, f.nodeMin)) say("ok", `node ${f.node}`);
  else { say("missing", `node ${f.node}: pitcrew needs ${f.nodeMin} or later`); out.ok = false; }
  if (!f.pi) { say("missing", "pi: install it first (https://pi.dev), then run pitcrew init again"); out.ok = false; }
  else if (f.pi === f.piTested) say("ok", `pi ${f.pi}`);
  else say("note", `pi ${f.pi}: pitcrew is tested with ${f.piTested}`);
  if (!out.ok) return out;

  // The package in pi's settings.
  const settings = structuredClone(f.settings);
  let changed = false;
  const found = registered(f);
  let pkgDir = found?.dir ?? f.pkgDir;
  if (found) say("ok", `package registered with pi: ${found.source}`);
  else {
    const npx = /[/\\]_npx[/\\]/.test(f.pkgDir);
    out.install = npx ? `npm:${f.pkgName}` : f.pkgDir;
    if (npx) pkgDir = join(f.agentDir, "npm", "node_modules", f.pkgName);
    say("add", `package: pi install ${out.install}`);
  }

  // Baseline settings: only missing keys.
  const added = mergeMissing(settings, f.base);
  if (added.length) { changed = true; say("add", `settings: ${added.join(", ")}`); }
  else say("ok", "baseline settings present");
  for (const key of ["defaultProvider", "defaultModel"] as const) {
    if (key in f.settings && f.settings[key] !== f.base[key]) say("note", `settings: ${key} is "${f.settings[key]}"; pitcrew starts sessions on roles with "${f.base[key]}"`);
  }

  // Profile.
  const own = settings.pitcrew ?? {};
  if (own.profile) {
    if (f.profiles[own.profile]) say("ok", `profile: ${own.profile}`);
    else say("note", `profile: "${own.profile}" is set but no profile file has that name (~/.pi/agent/profiles/${own.profile}.json)`);
  } else {
    const first = firstWorking(f.profiles, f.models);
    const providers = [...new Set(f.models.map((m) => m.split("/")[0]))];
    if (first) {
      out.questions.profile = first;
      if (a.profile !== false) {
        settings.pitcrew = { ...settings.pitcrew, profile: first };
        changed = true;
        say("add", `profile: ${first} (the first example profile whose models are all available)`);
      } else say("skip", `profile: ${first} proposed, not written. Sessions take the first working profile until one is set; to keep this one, run pitcrew init in a terminal or with --yes`);
      say("note", "model calls are billed by the provider: your plan, its credits, or API prices. The footer shows the cost and the plan windows");
    } else {
      say("missing", `profile: no example profile fits the models pi has now (providers: ${providers.join(", ") || "none"}). Log in with /login in pi, or write ~/.pi/agent/profiles/<name>.json (docs/roles.md) and set pitcrew.profile`);
    }
  }

  // Rules section: opt-in.
  if (own.rules !== undefined) say("ok", `rules section: ${own.rules === "on" || own.rules === true ? "on" : "off"}`);
  else {
    out.questions.rules = true;
    if (a.rules) {
      settings.pitcrew = { ...settings.pitcrew, rules: "on" };
      changed = true;
      say("add", "rules section: on (AGENTS.global.md as a prompt section of every session)");
    } else say("skip", "rules section: off. These are pitcrew's working rules for the model (keep its bookkeeping out of your repo, the smallest complete change, done means checked); turn on with pitcrew init --rules on");
  }

  // The pitcrew command.
  const bin = join(pkgDir, "bin", "pitcrew");
  const target = join(f.binDir, "pitcrew");
  if (f.onPath && f.onPath === safeReal(bin)) say("ok", "command: pitcrew on PATH");
  else if (isLink(target) && safeReal(target) === safeReal(bin)) {
    say("ok", `command: ${target}`);
    if (!f.pathDirs.includes(f.binDir)) say("note", `${f.binDir} is not on PATH; add it to your shell profile`);
  }
  else if (existsAny(target) && !isLink(target)) say("note", `command: ${target} exists and is not a link; left as it is`);
  else {
    out.link = { from: target, to: bin };
    say("add", `command: ${target} -> ${bin}`);
    if (!f.pathDirs.includes(f.binDir)) say("note", `${f.binDir} is not on PATH; add it to your shell profile`);
  }

  if (changed) out.settings = settings;

  // Optional parts.
  const t = f.tools;
  const opt = (have: boolean, what: string, how: string) => say(have ? "ok" : "option", have ? what : `${what}: ${how}`);
  opt(t.gh && t.ghAuth, "gh, logged in", t.gh ? "gh auth login (GitHub tracking, PRs, pitcrew run)" : "install the GitHub CLI and gh auth login (GitHub tracking, PRs, pitcrew run)");
  opt(t.exa, "Exa search key", "a free key from exa.ai in ~/.config/pitcrew/exa-key (mode 600) or EXA_API_KEY; without it web_search uses Codex if you are logged in (docs/web.md)");
  opt(t.bridge, "Claude bridge", `pi install npm:pi-claude-bridge@${f.bridgeVersion}, only for Claude on a subscription (docs/claude-access.md)`);
  opt(t.docker && t.boxImage, "sandbox image", t.docker ? "pitcrew box build (pitcrew run puts workers for repos that are not yours in it; docs/sandbox.md)" : "Docker, then pitcrew box build (sandbox for pitcrew run; docs/sandbox.md)");
  if (t.docker && t.boxImage) opt(t.claudeToken, "sandbox Claude token", "claude setup-token, saved in ~/.config/pitcrew/claude-token (mode 600)");
  opt(t.browser, "browser for browser-check", `${join(pkgDir, "skills/browser-check/scripts/browser")} install-browser chromium (about 700 MB)`);
  return out;
}

const safeReal = (p: string) => { try { return realpathSync(p); } catch { return undefined; } };
const existsAny = (p: string) => { try { lstatSync(p); return true; } catch { return false; } };
const isLink = (p: string) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const runs = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore", timeout: 20_000 }).status === 0;
const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});

/** Look at this machine. Reads no credential: only whether a file exists and its mode. */
export function gather(env: NodeJS.ProcessEnv = process.env): Facts {
  const pkg = readJson(join(PKG, "package.json"));
  const pins = readJson(join(PKG, "box", "package.json")).dependencies ?? {};
  const agentDir = defaultAgentDir(env);
  const pv = spawnSync("pi", ["--version"], { encoding: "utf8", env, timeout: 20_000 });
  const pi = pv.status === 0 ? pv.stdout.trim().split(/\s+/).pop() : undefined;
  const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const onPath = pathDirs.map((d) => join(d, "pitcrew")).find((p) => existsSync(p));
  const settings = readJson(join(agentDir, "settings.json"));
  const boxImage = `pitcrew-box:${pins["@earendil-works/pi-coding-agent"]}`;
  const docker = runs("docker", ["version"]);
  const exaFile = join(homedir(), ".config", "pitcrew", "exa-key");
  const tokenFile = join(homedir(), ".config", "pitcrew", "claude-token");
  const pwCache = join(homedir(), ".cache", "ms-playwright");
  return {
    node: process.versions.node,
    nodeMin: String(pkg.engines?.node ?? "0").replace(/[^0-9.]/g, ""),
    pi,
    piTested: pins["@earendil-works/pi-coding-agent"],
    bridgeVersion: pins["pi-claude-bridge"],
    pkgDir: realpathSync(PKG),
    pkgName: pkg.name,
    agentDir,
    settings,
    base: readJson(join(PKG, "config", "settings.base.json")),
    models: pi ? piModels(env) : [],
    profiles: loadProfiles([join(PKG, "profiles"), join(agentDir, "profiles")]),
    onPath: onPath && safeReal(onPath),
    binDir: join(homedir(), ".local", "bin"),
    pathDirs,
    tools: {
      gh: runs("gh", ["--version"]),
      ghAuth: runs("gh", ["auth", "status"]),
      docker,
      boxImage: docker && runs("docker", ["image", "inspect", boxImage]),
      exa: Boolean(env.EXA_API_KEY) || (existsSync(exaFile) && (statSync(exaFile).mode & 0o077) === 0),
      bridge: (settings.packages ?? []).some((e: unknown) => /pi-claude-bridge/.test(sourceOf(e) ?? "")),
      browser: existsSync(pwCache) && spawnSync("sh", ["-c", `ls -d "${pwCache}"/chromium-* >/dev/null 2>&1`]).status === 0,
      claudeToken: existsSync(tokenFile),
    },
  };
}

export interface InitOptions { dryRun?: boolean; yes?: boolean; rules?: "on" | "off" }

/** Run init: gather, ask (on a terminal), apply. Returns the exit code. */
export async function init(o: InitOptions = {}, log: (line: string) => void = console.log): Promise<number> {
  const facts = gather();
  const first = plan(facts, { rules: o.rules === "on" });
  // No terminal to ask: take the profile only with --yes (a dry run shows what --yes would do).
  const answers: Answers = { rules: o.rules === "on", profile: Boolean(o.yes || o.dryRun || (process.stdin.isTTY && process.stdout.isTTY)) };
  const tty = process.stdin.isTTY && process.stdout.isTTY && !o.yes && !o.dryRun;
  if (tty && (first.questions.profile || (first.questions.rules && !o.rules))) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const yes = async (q: string, def: boolean) => {
      const a = (await rl.question(`${q} ${def ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
      return a ? a.startsWith("y") : def;
    };
    if (first.questions.profile) answers.profile = await yes(`Use the profile "${first.questions.profile}" (its models are all available)?`, true);
    if (first.questions.rules && !o.rules) answers.rules = await yes("Add pitcrew's working rules for the model (AGENTS.global.md: keep bookkeeping out of your repo, the smallest complete change, done means checked) to every session?", false);
    rl.close();
  }
  const p = plan(facts, answers);
  log(`pitcrew init${o.dryRun ? " (dry run: nothing is changed)" : ""}`);
  for (const line of p.lines) log(`  ${line}`);
  if (!p.ok) return 1;
  if (o.dryRun) return 0;
  if (p.install) {
    log(`pi install ${p.install}`);
    const r = spawnSync("pi", ["install", p.install], { stdio: "inherit" });
    if (r.status !== 0) { log("pi install failed; nothing else was changed"); return 1; }
  }
  if (p.settings) {
    // pi install may have just written settings.json: merge our keys into what is there now.
    const file = join(facts.agentDir, "settings.json");
    const now = readJson(file);
    mergeMissing(now, p.settings);
    if (existsSync(file)) copyFileSync(file, `${file}.bak-pitcrew-init`);
    mkdirSync(facts.agentDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    log(`wrote ${file}${existsSync(`${file}.bak-pitcrew-init`) ? ` (previous copy: ${file}.bak-pitcrew-init)` : ""}`);
  }
  if (p.link) {
    mkdirSync(facts.binDir, { recursive: true });
    if (isLink(p.link.from)) unlinkSync(p.link.from);
    symlinkSync(p.link.to, p.link.from);
    log(`linked ${p.link.from}`);
  }
  log(p.lines.some((l) => l.startsWith("missing")) ? "Fix the missing part above, then run pitcrew init again." : "Ready. Start a session: pi");
  return 0;
}
