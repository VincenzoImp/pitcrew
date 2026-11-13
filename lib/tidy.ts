import { spawnSync } from "node:child_process";
import { dirname, resolve, sep } from "node:path";

// `pitcrew tidy`: after a merge, remove the remote branch, the local branch and the worktree, and
// prove it. Safe by default: a branch goes only with evidence that its work is merged (a merged PR
// whose head is the branch tip, or the tip inside the default branch); never the default branch;
// never a worktree with uncommitted work. `force` drops the evidence and the clean-worktree checks.
// Docs: docs/delivery.md.

export interface Run {
  (cmd: "git" | "gh", args: string[], cwd: string): { code: number; out: string };
}

export const run: Run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() || (r.stderr ?? "").trim() };
};

interface Pr { number: number; state?: string; headRefName: string; headRefOid: string; isCrossRepository?: boolean; headRepository?: { name: string }; headRepositoryOwner?: { login: string } }
interface Worktree { path: string; head: string; branch?: string; locked: boolean }
interface Plan { branch: string; pr?: Pr; tip?: string; worktree?: Worktree; remote?: { name: string; sha: string }; evidence?: string; left: string[] }

export interface TidyOptions {
  cwd: string; targets?: string[]; allMerged?: boolean; dryRun?: boolean; force?: boolean; run?: Run;
  /** A local branch that counts as the target of the work (an agent worktree): no remote, no PR. */
  into?: string;
}
export interface TidyResult { lines: string[]; ok: boolean }

const PR_FIELDS = "number,state,headRefName,headRefOid,isCrossRepository,headRepository,headRepositoryOwner";

export function tidy(options: TidyOptions): TidyResult {
  const exec = options.run ?? run;
  const lines: string[] = [];
  const say = (line: string) => lines.push(line);
  const top = exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], options.cwd);
  if (top.code !== 0) return { lines: ["pitcrew tidy: not in a git repository"], ok: false };
  const root = top.out.endsWith(`${sep}.git`) ? dirname(top.out) : top.out;
  const git = (...args: string[]) => exec("git", args, root);
  const gh = (...args: string[]): unknown => {
    const r = exec("gh", args, root);
    try { return r.code === 0 ? JSON.parse(r.out) : undefined; } catch { return undefined; }
  };
  const isAncestor = (a: string, b: string) => git("merge-base", "--is-ancestor", a, b).code === 0;

  // Facts: remotes, default branch, worktrees, branches. One fetch so origin/<default> is current.
  const remotes = remoteRepos(git("remote", "-v").out);
  const origin = remotes.has("origin") ? "origin" : [...remotes.keys()][0];
  if (origin && !options.into) git("fetch", "-q", "--prune", origin);
  const head = origin ? git("symbolic-ref", "--short", `refs/remotes/${origin}/HEAD`) : { code: 1, out: "" };
  const base = head.code === 0 ? head.out.slice(origin!.length + 1) : ((gh("repo", "view", "--json", "defaultBranchRef") as { defaultBranchRef?: { name: string } } | undefined)?.defaultBranchRef?.name ?? "main");
  const baseRef = options.into ?? (origin && git("rev-parse", "-q", "--verify", `refs/remotes/${origin}/${base}`).code === 0 ? `${origin}/${base}` : base);
  const worktrees = parseWorktrees(git("worktree", "list", "--porcelain").out);
  const tips = new Map(git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads").out.split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]));
  const remoteHeads = new Map<string, Map<string, string>>();
  const heads = (name: string) => {
    if (!remoteHeads.has(name)) {
      const r = git("ls-remote", "--heads", name);
      remoteHeads.set(name, new Map(r.code === 0 ? r.out.split("\n").filter(Boolean).map((l) => { const [sha, ref] = l.split("\t"); return [ref.replace("refs/heads/", ""), sha] as [string, string]; }) : []));
    }
    return remoteHeads.get(name)!;
  };
  say(`pitcrew tidy: ${remotes.get(origin ?? "") ?? root} (default branch ${base})${options.dryRun ? ", dry run" : ""}`);

  // What to look at: named PRs or branches, every branch (--all-merged), or the current branch.
  const merged = !options.into && (options.allMerged || options.targets?.some((t) => !/^#?\d+$/.test(t))) ? ((gh("pr", "list", "--state", "merged", "--limit", "500", "--json", PR_FIELDS) as Pr[] | undefined) ?? []) : [];
  const plans: Plan[] = [];
  const named = new Set<string>();
  for (const target of options.targets ?? []) {
    if (/^#?\d+$/.test(target)) {
      const pr = gh("pr", "view", target.replace("#", ""), "--json", PR_FIELDS) as Pr | undefined;
      if (!pr) { plans.push({ branch: target, left: ["no such PR, or gh cannot read it"] }); continue; }
      if (pr.state !== "MERGED" && !options.force) { plans.push({ branch: pr.headRefName, pr, left: [`PR #${pr.number} is ${pr.state?.toLowerCase()}, not merged (use --force to remove anyway)`] }); named.add(pr.headRefName); continue; }
      plans.push({ branch: pr.headRefName, pr, left: [] });
      named.add(pr.headRefName);
    } else {
      plans.push({ branch: target, pr: merged.find((p) => p.headRefName === target && (tips.get(target) ?? p.headRefOid) === p.headRefOid) ?? merged.find((p) => p.headRefName === target), left: [] });
      named.add(target);
    }
  }
  if (!options.targets?.length && !options.allMerged) {
    const current = exec("git", ["branch", "--show-current"], options.cwd).out;
    if (!current) return { lines: [...lines, "no target: name a PR or a branch, or use --all-merged"], ok: false };
    plans.push({ branch: current, pr: (gh("pr", "view", current, "--json", PR_FIELDS) as Pr | undefined) ?? undefined, left: [] });
    named.add(current);
  }
  if (options.allMerged) {
    const candidates = new Set([...tips.keys(), ...(origin ? heads(origin).keys() : [])]);
    for (const branch of candidates) {
      if (named.has(branch) || branch === base) continue;
      const tip = tips.get(branch) ?? heads(origin!).get(branch);
      plans.push({ branch, pr: merged.find((p) => p.headRefName === branch && p.headRefOid === tip), left: [] });
    }
  }

  // Decide per branch, then act.
  const removed: string[] = [];
  for (const plan of plans) {
    if (plan.left.length) continue;
    const { branch, pr } = plan;
    if (branch === base) { plan.left.push("the default branch is never removed"); continue; }
    plan.tip = tips.get(branch);
    plan.worktree = worktrees.find((w) => w.branch === branch);
    const remoteName = options.into ? undefined : pr?.isCrossRepository ? [...remotes].find(([, repo]) => repo === `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}`)?.[0] : origin;
    const remoteSha = remoteName ? heads(remoteName).get(branch) : undefined;
    if (remoteName && remoteSha) plan.remote = { name: remoteName, sha: remoteSha };
    if (pr?.isCrossRepository && !remoteName) plan.left.push(`its head is in the fork ${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}, which no remote points to`);

    // Evidence that the work is merged. A squash merge leaves no ancestry, so a merged PR counts
    // only when the branch tip is its head (or behind it). Ancestry counts only for a branch named
    // on the command line: a new branch with no commits is also "inside" the default branch.
    const covered = (sha: string) => pr?.state === "MERGED" && (sha === pr.headRefOid || isAncestor(sha, pr.headRefOid));
    // Into a local branch, a cherry-pick counts too: every commit has an equal one there.
    const inBase = (sha: string) => isAncestor(sha, baseRef) || (options.into !== undefined && !git("cherry", baseRef, sha).out.split("\n").some((l) => l.startsWith("+")));
    const shas = [plan.tip, plan.remote?.sha].filter(Boolean) as string[];
    if (!shas.length && !plan.worktree) plan.evidence = "already gone";
    else if (options.force) plan.evidence = "--force";
    else if (pr && shas.every(covered)) plan.evidence = `PR #${pr.number} merged at ${pr.headRefOid.slice(0, 7)}`;
    else if (named.has(branch) && shas.every(inBase)) plan.evidence = `its commits are in ${baseRef}`;
    else {
      plan.left.push(pr && shas.some((s) => !covered(s)) ? `has commits that are not in the merged head of PR #${pr.number}`
        : shas.every(inBase) ? `no merged PR; its commits are in ${baseRef} (merged, or a new branch?); name it to remove it`
        : `not merged: no merged PR with this head, and commits not in ${baseRef}`);
      continue;
    }
    if (plan.worktree) {
      const wt = plan.worktree;
      if (wt.path === worktrees[0]?.path) plan.left.push(`checked out in the main worktree ${wt.path}; switch it to another branch first`);
      else if (wt.locked) plan.left.push(`worktree ${wt.path} is locked`);
      else if (!options.force && exec("git", ["status", "--porcelain"], wt.path).out) plan.left.push(`worktree ${wt.path} has uncommitted or untracked files`);
    }
  }

  for (const plan of plans) {
    const tag = plan.pr ? `${plan.branch} (PR #${plan.pr.number})` : plan.branch;
    if (plan.left.length) continue;
    say(`${tag}: ${plan.evidence}`);
    const step = (what: string, args: string[], cwd = root) => {
      if (options.dryRun) return say(`  would remove  ${what}`);
      const r = exec("git", args, cwd);
      if (r.code === 0) { say(`  removed  ${what}`); removed.push(what); }
      else { say(`  failed   ${what}: ${r.out.split("\n")[0]}`); plan.left.push(`could not remove ${what}`); }
    };
    if (plan.worktree) step(`worktree ${plan.worktree.path}`, ["worktree", "remove", ...(options.force ? ["--force"] : []), plan.worktree.path]);
    else say("  gone     worktree (none)");
    if (plan.tip) step(`local branch ${plan.branch} (was ${plan.tip.slice(0, 7)})`, ["branch", "-D", plan.branch]);
    else say("  gone     local branch");
    if (plan.remote) step(`remote branch ${plan.remote.name}/${plan.branch}`, ["push", "-q", plan.remote.name, "--delete", plan.branch]);
    else say("  gone     remote branch");
  }

  if (!options.dryRun && removed.length) {
    git("worktree", "prune");
    for (const name of remotes.keys()) git("fetch", "-q", "--prune", name);
  }
  const left = plans.filter((p) => p.left.length);
  if (left.length) {
    say("left:");
    for (const p of left) say(`  ${p.branch}${p.pr ? ` (PR #${p.pr.number})` : ""}: ${p.left.join("; ")}`);
  }

  // Proof, read again after the changes: what is still there for every branch looked at.
  remoteHeads.clear();
  const after = parseWorktrees(git("worktree", "list", "--porcelain").out);
  const localAfter = new Set(git("for-each-ref", "--format=%(refname:short)", "refs/heads").out.split("\n").filter(Boolean));
  const stillThere = plans.filter((p) => !p.left.length).flatMap((p) => [
    ...(after.some((w) => w.branch === p.branch) ? [`worktree of ${p.branch}`] : []),
    ...(localAfter.has(p.branch) ? [`local ${p.branch}`] : []),
    ...(p.remote && heads(p.remote.name).has(p.branch) ? [`${p.remote.name}/${p.branch}`] : []),
  ]);
  say(`check: ${after.length} worktree(s): ${after.map((w) => `${w.path} [${w.branch ?? "detached"}]`).join(", ")}`);
  say(`check: local branches: ${[...localAfter].join(", ") || "none"}`);
  if (origin) say(`check: ${origin} branches: ${[...heads(origin).keys()].join(", ") || "none"}`);
  if (!options.dryRun && stillThere.length) say(`check FAILED, still present: ${stillThere.join(", ")}`);
  const namedLeft = left.some((p) => named.has(p.branch) || /^#?\d+$/.test(p.branch));
  return { lines, ok: (options.dryRun || !stillThere.length) && !namedLeft };
}

/** `git remote -v` → remote name → `owner/repo` (GitHub URLs), or the URL itself. */
export function remoteRepos(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (!name || !url || map.has(name)) continue;
    const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?\/?$/.exec(url);
    map.set(name, m ? m[1] : url);
  }
  return map;
}

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain.split("\n\n").filter((b) => b.trim()).map((block) => {
    const get = (key: string) => block.split("\n").find((l) => l === key || l.startsWith(`${key} `))?.slice(key.length + 1);
    return { path: resolve(get("worktree") ?? ""), head: get("HEAD") ?? "", branch: get("branch")?.replace("refs/heads/", ""), locked: block.split("\n").some((l) => l.startsWith("locked")) };
  });
}
