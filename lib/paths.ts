import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

// Where the harness keeps its own working files. They live outside the repo by default, in one
// folder per repo that every worktree of the repo shares. Docs: docs/footprint.md.

export const WORK_KINDS = ["plans", "handoffs", "reports", "runs"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** pi's agent dir: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** Root of the main checkout when `cwd` is in a git repo or one of its worktrees; else undefined. */
export function repoRoot(cwd: string): string | undefined {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return basename(common) === ".git" ? dirname(common) : common;
  } catch {
    return undefined;
  }
}

/** Stable folder name for a project: readable name plus a short hash of its path. */
export function projectId(root: string): string {
  const name = basename(root).replace(/[^A-Za-z0-9._-]/g, "_") || "root";
  return `${name}-${createHash("sha256").update(resolve(root)).digest("hex").slice(0, 8)}`;
}

/**
 * The work folder for `cwd`. `override` is the setting `pitcrew.workDir`: an absolute path, or a
 * path relative to the repo root (for owners who want plans under version control).
 */
export function workDir(cwd: string, override?: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = repoRoot(cwd) ?? resolve(cwd);
  if (override) return isAbsolute(override) ? override : join(root, override);
  return join(agentDir(env), "pitcrew", "projects", projectId(root));
}

/** Path of one kind of working file; creates the folder. */
export function workPath(cwd: string, kind: WorkKind, override?: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = join(workDir(cwd, override, env), kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run folder of one session: its subagent ledgers and the files its process tree shares. */
export function sessionRunDir(cwd: string, session: string, override?: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(workPath(cwd, "runs", override, env), session);
}
