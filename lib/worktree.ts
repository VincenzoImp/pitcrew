import { git } from "./git.ts";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { repoRoot } from "./paths.ts";
import { parseWorktrees, tidy } from "./tidy.ts";

// A worker that would run beside another worker in the same repo gets its own worktree,
// `<repo>.wt/agent-<key>` on branch `agent/<key>`, made from the parent's current commit. It goes
// (lib/tidy.ts) once the parent's branch holds its commits: merged, fast-forwarded or cherry-picked.

export interface WorkerTree { path: string; branch: string; root: string; into: string }


/** Make the worktree; the child's cwd keeps the parent's place inside the repo. Throws with the reason. */
export function workerTree(cwd: string, key: string, cap: number): { tree: WorkerTree; cwd: string } {
  const root = repoRoot(cwd);
  if (!root) throw new Error("not in a git repository");
  const count = parseWorktrees(git(root, "worktree", "list", "--porcelain").out).length;
  if (cap && count >= cap) throw new Error(`${count} worktrees exist (pitcrew.caps.worktrees ${cap}): wait for the other worker, or run "pitcrew tidy --all-merged"`);
  const head = git(cwd, "rev-parse", "HEAD").out;
  const into = git(cwd, "branch", "--show-current").out || head;
  const tree = { path: join(dirname(root), `${basename(root)}.wt`, `agent-${key}`), branch: `agent/${key}`, root, into };
  const r = git(root, "worktree", "add", "-q", "-b", tree.branch, tree.path, head);
  if (r.code !== 0) throw new Error(`git worktree add: ${r.out}`);
  return { tree, cwd: join(tree.path, relative(git(cwd, "rev-parse", "--show-toplevel").out, cwd)) };
}

/** Remove the worktree and its branch when `into` holds the work. True when they are gone. */
export function dropTaken(t: WorkerTree): boolean {
  if (!existsSync(t.path)) return true;
  return tidy({ cwd: t.root, targets: [t.branch], into: t.into }).ok;
}
