import { spawnSync } from "node:child_process";

// The one way the harness runs git. `git` never throws; `gitOut` gives stdout or undefined;
// `gitStrict` throws with git's message.

export function git(cwd: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 64 << 20 });
  const code = r.status ?? 1;
  return { code, out: code === 0 ? (r.stdout ?? "").trim() : ((r.stderr ?? "").trim() || (r.stdout ?? "").trim() || String(r.error ?? "")) };
}

export const gitOut = (cwd: string, ...args: string[]): string | undefined => {
  const r = git(cwd, ...args);
  return r.code === 0 ? r.out : undefined;
};

export function gitStrict(cwd: string, ...args: string[]): string {
  const r = git(cwd, ...args);
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.out}`);
  return r.out;
}

/** The top level of the worktree that holds `cwd`; undefined outside git. */
export const toplevel = (cwd: string) => gitOut(cwd, "rev-parse", "--show-toplevel");
