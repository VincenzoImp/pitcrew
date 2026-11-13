import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { parseWorktrees } from "./tidy.ts";
import { agentDir, sessionRunDir, workDir } from "./paths.ts";
import { discoverVerify } from "./verify.ts";

// The facts the delivery rules ask for, read from git, gh and the session. Each is asked only for
// the commands that need it. `gh repo view` runs once per repo and process (about half a second).

// The facts the delivery rules ask for.
export interface RepoFacts {
  /** owner/name */
  name: string;
  /** viewerPermission: ADMIN, MAINTAIN, WRITE, TRIAGE, READ */
  permission: string;
  defaultBranch: string;
}

export interface DeliveryFacts {
  /** The repo `gh` acts on from `cwd` (or `target`, owner/name). Undefined when unknown. */
  repo(cwd: string, target?: string): RepoFacts | undefined;
  /** owner/name of a git remote. */
  remote(cwd: string, name: string): string | undefined;
  branch(cwd: string): string | undefined;
  /** Commit messages of the current branch since its base (for `gh pr create --fill`). */
  commits(cwd: string, base?: string): string;
  readFile(path: string): string | undefined;
  /** Did the repo's verify command pass on this commit's tree? Undefined: the repo has no verify command. */
  verified(cwd: string, sha: string): boolean | undefined;
  /** Worktrees of the repo (main checkout included) and disk use of the extra ones plus the work folder. */
  worktrees(cwd: string): { count: number; gb: number };
}


const sh = (cmd: string, args: string[], cwd: string, timeout = 15_000): string | undefined => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout }).trim();
  } catch {
    return undefined;
  }
};

const repos = new Map<string, RepoFacts | undefined>();

/** The repo `gh` acts on from `cwd`, or `target` (owner/name); cached for the process. */
export function repoFacts(cwd: string, target?: string): RepoFacts | undefined {
  const key = target ?? `dir:${cwd}`;
  if (!repos.has(key)) {
    const out = sh("gh", ["repo", "view", ...(target ? [target] : []), "--json", "nameWithOwner,viewerPermission,defaultBranchRef"], cwd);
    let facts: RepoFacts | undefined;
    try {
      const j = JSON.parse(out ?? "");
      facts = { name: j.nameWithOwner, permission: j.viewerPermission, defaultBranch: j.defaultBranchRef?.name ?? "main" };
    } catch { /* not a GitHub repo, offline, or gh missing */ }
    repos.set(key, facts);
  }
  return repos.get(key);
}

/**
 * May the repo's own commands and files act on this host (its verify command, its `.pi/profiles`)?
 * Yes for your own repo (admin permission, the guard's test) or a folder you said yes to in pi's
 * `trust.json` (`/trust`). pi itself trusts any folder without `.pi/` files, so its answer is not enough.
 */
export function ownOrTrusted(cwd: string, permission = repoFacts(cwd)?.permission): boolean {
  if (permission === "ADMIN") return true;
  try { return new ProjectTrustStore(agentDir()).get(cwd) === true; } catch { return false; }
}

interface SessionView {
  cwd: string;
  sessionManager: { getBranch(): { type: string; customType?: string; data?: unknown }[]; getSessionId?(): string };
}

/** `workDirSetting` is read only when needed: pi's settings are not readable during project trust. */
export function deliveryFacts(ctx: SessionView, workDirSetting: () => string | undefined = () => undefined, checked: Set<string> = new Set()): DeliveryFacts {
  return {
    repo: repoFacts,
    remote: (cwd, name) => /github\.com[:/]([^/]+\/[^/]+?)(\.git)?\/?$/.exec(sh("git", ["remote", "get-url", name], cwd) ?? "")?.[1],
    branch: (cwd) => sh("git", ["branch", "--show-current"], cwd) || undefined,
    commits: (cwd, base) => {
      const ref = base ? `origin/${base}` : sh("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd) ?? "origin/main";
      return sh("git", ["log", "--format=%B", `${ref}..HEAD`], cwd) ?? "";
    },
    readFile: (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } },
    verified: (cwd, sha) => {
      if (!discoverVerify(cwd)) return undefined;
      const tree = sh("git", ["rev-parse", "--verify", "-q", `${sha}^{tree}`], cwd);
      if (!tree) return false;
      if (checked.has(tree)) return true;
      const receipts = ctx.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "verify-receipt").map((e) => e.data as { tree?: string; exit?: number });
      const session = ctx.sessionManager.getSessionId?.();
      const dir = process.env.PITCREW_TREE || (session ? sessionRunDir(ctx.cwd, session, workDirSetting()) : undefined);
      try {
        for (const line of readFileSync(`${dir}/verify-receipts.jsonl`, "utf8").split("\n")) {
          try { receipts.push(JSON.parse(line)); } catch { /* partial line */ }
        }
      } catch { /* no shared receipts */ }
      return receipts.some((r) => r?.tree === tree && r.exit === 0);
    },
    worktrees: (cwd) => {
      const trees = parseWorktrees(sh("git", ["worktree", "list", "--porcelain"], cwd) ?? "");
      const paths = [...trees.slice(1).map((t) => t.path), workDir(cwd, workDirSetting())];
      const du = spawnSync("du", ["-sk", ...paths], { encoding: "utf8", timeout: 60_000 });
      const kb = (du.stdout ?? "").split("\n").reduce((sum, line) => sum + (Number.parseInt(line, 10) || 0), 0);
      return { count: trees.length, gb: kb / 1024 / 1024 };
    },
  };
}

/**
 * Did this bash command run the verify command so that a success of the whole command means the
 * verify command passed? Allowed: the command alone, or one link of an `&&` chain; no pipe, `;` or `||`.
 */
export function ranVerify(command: string, verify: string): boolean {
  if (/\|\||;|(^|[^|])\|([^|]|$)|\n/.test(command)) return false;
  return command.split("&&").some((part) => part.trim().replace(/\s+2>&1$/, "") === verify.trim());
}
