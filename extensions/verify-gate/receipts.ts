import { execFile } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

// Verify receipts shared by every pi process of one session tree: the top session and its agent
// children. File: <tree dir>/verify-receipts.jsonl. The tree dir is PITCREW_TREE (the agent extension
// sets it for children), else the top session's run folder. A receipt for (tree id, command, root)
// satisfies every process in the tree, so one change is verified once, not once per process.
// A worker can forge a line here (it can write files); like the gate itself, this is not a security control.

const run = promisify(execFile);

export interface Receipt {
  tree: string;
  command: string;
  exit: number;
  ms: number;
  /** Directory the command ran in. */
  root?: string;
  /** Who ran it: "session", an agent run id, or "gate <id>". */
  by?: string;
}

/** Tree id of the working tree as `git add -A` would stage it; undefined outside git. */
export async function treeId(root: string): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "verify-gate-"));
  try {
    const git = (args: string[], env?: NodeJS.ProcessEnv) => run("git", args, { cwd: root, env: { ...process.env, ...env }, maxBuffer: 1 << 20 });
    const index = join(dir, "index");
    // Start from the real index so unchanged files keep their cached stat data (fast on big repos).
    const real = resolve(root, (await git(["rev-parse", "--git-path", "index"])).stdout.trim());
    try {
      copyFileSync(real, index);
      // Keep the real index time: git rehashes files changed in the same tick as the index ("racy"
      // entries) by comparing with this time. A fresh copy is newer than every file, so a same-size
      // edit made right after the last index write could be taken as unchanged.
      const { atime, mtime } = statSync(real);
      utimesSync(index, atime, mtime);
    } catch {}
    await git(["add", "-A"], { GIT_INDEX_FILE: index });
    return (await git(["write-tree"], { GIT_INDEX_FILE: index })).stdout.trim();
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const receiptsFile = (treeDir: string) => join(treeDir, "verify-receipts.jsonl");

/** Latest shared receipt for this tree, command and root. */
export function findShared(file: string | undefined, tree: string, command: string, root: string): Receipt | undefined {
  if (!file) return undefined;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  let found: Receipt | undefined;
  for (const line of text.split("\n")) {
    try {
      const r = JSON.parse(line) as Receipt;
      if (r.tree === tree && r.command === command && (r.root ?? root) === root && typeof r.exit === "number") found = r;
    } catch { /* partial or empty line */ }
  }
  return found;
}

export function addShared(file: string | undefined, receipt: Receipt) {
  if (!file) return;
  try {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify(receipt) + "\n", { mode: 0o600 });
  } catch { /* sharing is an optimisation */ }
}
