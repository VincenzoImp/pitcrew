import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Run ledger: one folder per child under the session's run folder
//   <work dir>/runs/<parent session id>/<id>/
// holding task.md, role.md, loadout.json, state.json and the child's pi session in session/.
// Plain files the owner can read. Nothing reruns automatically: a child whose process is gone is
// marked `interrupted` on session_start and can be resumed by id.

export type Status = "queued" | "running" | "asking" | "done" | "failed" | "timeout" | "stopped" | "interrupted";
export const LIVE: ReadonlySet<Status> = new Set(["queued", "running", "asking"]);

export interface Loadout {
  id: string;
  /** The agent definition's name (worker, scout, ...). */
  agent: string;
  /** The pi model, always a role: `role/<name>`. */
  model: string;
  tools: string[];
  /** Its own worktree, when it ran beside another worker (worktree.ts). */
  tree?: { path: string; branch: string; root: string; into: string };
  /** Skill folders the child loads (`--no-skills --skill <dir>`); undefined: every skill. */
  skills?: string[];
  cwd: string;
  depth: number;
  timeoutMs: number;
  /** Session id of the parent session that started the child. */
  session: string;
  createdAt: string;
  /** The repo's check, passed as PI_VERIFY: the child's own verify gate runs it (index.ts launch). */
  verify?: string;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number }

export interface ChildState {
  status: Status;
  /** The child pi process; must be alive while the status is live. */
  pid?: number;
  /** The parent pi process. A live child whose parent is gone is an orphan. */
  parentPid?: number;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** It failed on a provider's quota refusal: `/agents resume` takes it up again. */
  quota?: boolean;
  usage?: Usage;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite, cost: a.cost + b.cost, turns: a.turns + b.turns,
  };
}

export function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return undefined; }
}

/** Atomic write: a reader never sees half a file. */
export function writeJson(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Create `<sessionDir>/<base>-<n>/` with the lowest free n. */
export function createRunDir(sessionDir: string, base: string): { id: string; dir: string } {
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const safe = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
  for (let n = 1; ; n++) {
    const id = `${safe}-${n}`;
    const dir = join(sessionDir, id);
    try {
      mkdirSync(dir, { mode: 0o700 });
      return { id, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export interface Entry { id: string; dir: string; loadout: Loadout; state: ChildState }

export function listEntries(sessionDir: string): Entry[] {
  if (!existsSync(sessionDir)) return [];
  const out: Entry[] = [];
  for (const id of readdirSync(sessionDir).sort()) {
    const dir = join(sessionDir, id);
    const loadout = readJson<Loadout>(join(dir, "loadout.json"));
    const state = readJson<ChildState>(join(dir, "state.json"));
    if (loadout && state) out.push({ id, dir, loadout: { ...loadout, agent: loadout.agent ?? (loadout as { role?: string }).role ?? id }, state });
  }
  return out;
}

export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Mark live entries that nobody drives any more as interrupted (an orphan child gets SIGTERM).
 * `own(dir)` is true for runs this process still drives (they survive /reload). Returns the ids.
 */
export function reconcile(sessionDir: string, own: (dir: string) => boolean, alive: (pid: number | undefined) => boolean = pidAlive): string[] {
  const marked: string[] = [];
  for (const entry of listEntries(sessionDir)) {
    const { pid, parentPid } = entry.state;
    if (!LIVE.has(entry.state.status) || own(entry.dir)) continue;
    if (parentPid !== process.pid && alive(parentPid)) continue; // another live pi drives it
    if (alive(pid)) { try { process.kill(pid!, "SIGTERM"); } catch { /* gone */ } }
    writeJson(join(entry.dir, "state.json"), { ...entry.state, status: "interrupted", endedAt: new Date().toISOString(), error: "process gone (parent restart or crash)" });
    marked.push(entry.id);
  }
  return marked;
}

/** The child's pi session file inside `<dir>/session/`, newest first. */
export function findSessionFile(dir: string): string | undefined {
  const sessionDir = join(dir, "session");
  if (!existsSync(sessionDir)) return undefined;
  const files = readdirSync(sessionDir, { recursive: true }).map(String).filter((f) => f.endsWith(".jsonl")).sort();
  return files.length ? join(sessionDir, files[files.length - 1]) : undefined;
}
