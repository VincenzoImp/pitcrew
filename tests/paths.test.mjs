import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentDir, projectId, repoRoot, workDir, workPath } from "../lib/paths.ts";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
const base = realpathSync(mkdtempSync(join(tmpdir(), "paths-")));
const env = { PI_CODING_AGENT_DIR: join(base, "agent") };

const repo = join(base, "my repo");
mkdirSync(repo);
git(repo, "init", "-q");
writeFileSync(join(repo, "a.txt"), "a");
git(repo, "add", "a.txt");
git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
const worktree = join(base, "wt");
git(repo, "worktree", "add", "-q", worktree);

test("agentDir follows PI_CODING_AGENT_DIR", () => {
  assert.equal(agentDir(env), join(base, "agent"));
  assert.match(agentDir({}), /\.pi\/agent$/);
});

test("a repo, a subfolder and a worktree of it share one work folder", () => {
  mkdirSync(join(repo, "src"));
  assert.equal(repoRoot(repo), repo);
  assert.equal(repoRoot(join(repo, "src")), repo);
  assert.equal(repoRoot(worktree), repo);
  assert.equal(workDir(worktree, undefined, env), workDir(join(repo, "src"), undefined, env));
  assert.ok(workDir(repo, undefined, env).startsWith(join(base, "agent", "pitcrew", "projects", "my_repo-")));
});

test("a folder that is not a repo gets its own work folder", () => {
  const plain = join(base, "plain");
  mkdirSync(plain);
  assert.equal(repoRoot(plain), undefined);
  assert.notEqual(workDir(plain, undefined, env), workDir(repo, undefined, env));
  assert.match(projectId(plain), /^plain-[0-9a-f]{8}$/);
});

test("the override moves the work folder: relative to the repo root, or absolute", () => {
  assert.equal(workDir(worktree, ".pi/work", env), join(repo, ".pi/work"));
  assert.equal(workDir(repo, "/somewhere/else", env), "/somewhere/else");
});

test("workPath creates the folder outside the repo and leaves the repo clean", () => {
  const dir = workPath(repo, "handoffs", undefined, env);
  assert.ok(existsSync(dir));
  assert.ok(!dir.startsWith(repo));
  assert.deepEqual(readdirSync(repo).sort(), [".git", "a.txt", "src"]);
  assert.equal(git(repo, "status", "--porcelain").toString(), "");
});
