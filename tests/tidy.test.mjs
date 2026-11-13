import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { run, tidy } from "../lib/tidy.ts";

// tidy against real local git repos (a bare "origin" and a clone with worktrees); gh is faked.

const ID = ["-c", "user.name=t", "-c", "user.email=t@t"];
const git = (cwd, ...args) => execFileSync("git", [...ID, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const bases = [];
after(() => { for (const base of bases) rmSync(base, { recursive: true, force: true }); });

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "tidy-")));
  bases.push(base);
  const seed = join(base, "seed");
  git(base, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(base, "init", "-q", "-b", "main", "seed");
  writeFileSync(join(seed, "a.txt"), "a\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "init");
  git(seed, "push", "-q", join(base, "origin.git"), "main");
  git(base, "clone", "-q", join(base, "origin.git"), "repo");
  const repo = join(base, "repo");
  /** A branch with one commit in its own worktree, pushed. Returns the worktree path and tip. */
  const feature = (name, { push = true, commit = true } = {}) => {
    const wt = join(base, `wt-${name}`);
    git(repo, "worktree", "add", "-q", "-b", name, wt, "origin/main");
    if (commit) {
      writeFileSync(join(wt, `${name}.txt`), `${name}\n`);
      git(wt, "add", ".");
      git(wt, "commit", "-qm", name);
    }
    if (push) git(wt, "push", "-q", "-u", "origin", name);
    return { wt, tip: git(wt, "rev-parse", "HEAD") };
  };
  const squashMerge = (name) => {
    git(repo, "merge", "-q", "--squash", `origin/${name}`);
    git(repo, "commit", "-qm", `${name} (#1)`);
    git(repo, "push", "-q", "origin", "main");
  };
  const remoteHas = (name) => git(repo, "ls-remote", "--heads", "origin", name) !== "";
  const localHas = (name) => git(repo, "branch", "--list", name) !== "";
  return { base, repo, feature, squashMerge, remoteHas, localHas };
}

/** Real git; gh answers from `prs` (a list of merged or open PRs), or fails when `prs` is undefined. */
const fake = (prs) => (cmd, args, cwd) => {
  if (cmd === "git") return run(cmd, args, cwd);
  if (!prs) return { code: 1, out: "gh: not found" };
  if (args[0] === "pr" && args[1] === "view") {
    const pr = prs.find((p) => String(p.number) === args[2] || p.headRefName === args[2]);
    return pr ? { code: 0, out: JSON.stringify(pr) } : { code: 1, out: "no pull requests found" };
  }
  if (args[0] === "pr" && args[1] === "list") return { code: 0, out: JSON.stringify(prs.filter((p) => p.state === "MERGED")) };
  return { code: 1, out: "unexpected gh call" };
};
const merged = (number, headRefName, headRefOid) => ({ number, state: "MERGED", headRefName, headRefOid, isCrossRepository: false });

test("a squash-merged PR: worktree, local branch and remote branch are removed, with proof", () => {
  const r = setup();
  const { wt, tip } = r.feature("feat-a");
  r.squashMerge("feat-a");
  const result = tidy({ cwd: r.repo, targets: ["#7"], run: fake([merged(7, "feat-a", tip)]) });
  assert.ok(result.ok, result.lines.join("\n"));
  assert.ok(!existsSync(wt));
  assert.ok(!r.localHas("feat-a"));
  assert.ok(!r.remoteHas("feat-a"));
  const text = result.lines.join("\n");
  assert.match(text, /PR #7 merged at/);
  assert.match(text, /removed {2}remote branch origin\/feat-a/);
  assert.match(text, /check: 1 worktree\(s\)/);
  // Run again: everything is already gone, nothing fails.
  const again = tidy({ cwd: r.repo, targets: ["#7"], run: fake([merged(7, "feat-a", tip)]) });
  assert.ok(again.ok);
  assert.match(again.lines.join("\n"), /already gone/);
});

test("safe by default: unmerged work, a dirty worktree and the default branch are kept and explained", () => {
  const r = setup();
  const open = r.feature("open-work");
  const dirty = r.feature("dirty");
  r.squashMerge("dirty");
  writeFileSync(join(dirty.wt, "notes.txt"), "unsaved\n");
  const prs = [merged(9, "dirty", dirty.tip), { ...merged(10, "open-work", open.tip), state: "OPEN" }];

  const result = tidy({ cwd: r.repo, targets: ["open-work", "#10", "#9", "main"], run: fake(prs) });
  assert.equal(result.ok, false);
  const text = result.lines.join("\n");
  assert.match(text, /open-work: not merged/);
  assert.match(text, /PR #10 is open, not merged/);
  assert.match(text, /has uncommitted or untracked files/);
  assert.match(text, /main: the default branch is never removed/);
  assert.ok(existsSync(open.wt) && existsSync(dirty.wt) && r.localHas("open-work") && r.remoteHas("open-work"));

  // A branch with commits after the merged head is kept too.
  writeFileSync(join(dirty.wt, "notes.txt"), "later\n");
  git(dirty.wt, "add", ".");
  git(dirty.wt, "commit", "-qm", "after merge");
  assert.match(tidy({ cwd: r.repo, targets: ["#9"], run: fake(prs) }).lines.join("\n"), /commits that are not in the merged head of PR #9/);

  // --force removes unmerged work when told.
  const forced = tidy({ cwd: r.repo, targets: ["open-work"], force: true, run: fake(prs) });
  assert.ok(forced.ok, forced.lines.join("\n"));
  assert.ok(!existsSync(open.wt) && !r.localHas("open-work") && !r.remoteHas("open-work"));
});

test("--all-merged removes merged leftovers, local and remote-only, and lists the rest; --dry-run changes nothing", () => {
  const r = setup();
  const done = r.feature("done");
  r.squashMerge("done");
  const remoteOnly = r.feature("remote-only");
  r.squashMerge("remote-only");
  git(r.repo, "worktree", "remove", remoteOnly.wt);
  git(r.repo, "branch", "-D", "remote-only");
  const fresh = r.feature("fresh", { push: false, commit: false });
  const gh = fake([merged(1, "done", done.tip), merged(2, "remote-only", remoteOnly.tip)]);

  const dry = tidy({ cwd: r.repo, allMerged: true, dryRun: true, run: gh });
  assert.match(dry.lines.join("\n"), /would remove {2}worktree/);
  assert.ok(existsSync(done.wt) && r.remoteHas("remote-only"));

  const result = tidy({ cwd: r.repo, allMerged: true, run: gh });
  assert.ok(result.ok, result.lines.join("\n"));
  assert.ok(!existsSync(done.wt) && !r.localHas("done") && !r.remoteHas("done") && !r.remoteHas("remote-only"));
  assert.ok(existsSync(fresh.wt) && r.localHas("fresh"));
  assert.match(result.lines.join("\n"), /fresh: no merged PR; its commits are in origin\/main/);
});

test("without gh, a named branch merged by a merge commit is removed on ancestry", () => {
  const r = setup();
  const { wt } = r.feature("plain");
  git(r.repo, "merge", "-q", "--no-ff", "-m", "merge plain", "origin/plain");
  git(r.repo, "push", "-q", "origin", "main");
  const result = tidy({ cwd: r.repo, targets: ["plain"], run: fake(undefined) });
  assert.ok(result.ok, result.lines.join("\n"));
  assert.match(result.lines.join("\n"), /its commits are in origin\/main/);
  assert.ok(!existsSync(wt) && !r.localHas("plain") && !r.remoteHas("plain"));
});
