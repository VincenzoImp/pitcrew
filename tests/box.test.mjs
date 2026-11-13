import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BOX_RUN, checkCloneShape, checkMount, dependencyDirs, dockerRunArgs, fetchBack, parseArgs, pitcrewSnapshot, prepareClone, prepareWorkdir, readToken } from "../lib/box.ts";
import { decide, DEFAULT_ALLOW, injectHeaders } from "../box/egress-proxy.mjs";

const base = { id: "t1", work: "/tmp/w", pitcrewDir: "/tmp/pe", image: "pitcrew-box:1.5.2", memory: "16g", cpus: "8", pidsLimit: 512, guardAllow: "write-outside", command: ["pi", "-p", "x"] };
const flag = (args, f) => args[args.indexOf(f) + 1];

test("docker args: hardening, a placeholder token behind the injecting proxy, the run folder, no socket", () => {
  const a = dockerRunArgs({ ...base, proxy: "http://egress:3128", network: "n1", inject: true, placeholder: "sk-ant-oat01-PH", runDir: "/tmp/run1", passEnv: { PITCREW_ROLES: "{}" } });
  for (const f of ["--read-only", "--rm", "--init"]) assert.ok(a.includes(f), f);
  assert.equal(flag(a, "--user"), "1000:1000");
  assert.equal(flag(a, "--cap-drop"), "ALL");
  assert.equal(flag(a, "--security-opt"), "no-new-privileges");
  assert.equal(flag(a, "--network"), "n1");
  assert.ok(!a.includes("--privileged") && !a.some((x) => x.includes("docker.sock")));
  assert.ok(a.includes("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-PH") && a.includes("ANTHROPIC_BASE_URL=http://egress:8080"));
  assert.ok(a.includes(`/tmp/run1:${BOX_RUN}`) && a.includes(`PITCREW_RUN=${BOX_RUN}`) && a.includes("PITCREW_ROLES={}"));
  assert.ok(a.includes("/tmp/w:/work") && a.includes("/tmp/pe:/opt/pitcrew:ro"));
  const e = dockerRunArgs({ ...base, setup: "npm ci", command: ["bash", "-c", "npm test"] });
  assert.ok(!e.some((x) => x.includes("CLAUDE_CODE_OAUTH_TOKEN")), "exec: no token at all");
  assert.deepEqual(e.slice(-8), ["pitcrew-box:1.5.2", "bash", "-c", 'eval "$PITCREW_BOX_SETUP" && exec "$@"', "box-setup", "bash", "-c", "npm test"]);
});

test("mounts: home, credential dirs and their symlinks are refused; the token file needs mode 600", (t) => {
  const d = mkdtempSync(join(tmpdir(), "box-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const p of [homedir(), "/", join(homedir(), ".ssh"), join(homedir(), ".pi", "agent"), join(homedir(), ".config", "pitcrew")]) {
    assert.throws(() => checkMount(p), /refusing/, p);
    assert.throws(() => dockerRunArgs({ ...base, runDir: p }), /refusing/, p);
  }
  if (existsSync(join(homedir(), ".ssh"))) { symlinkSync(join(homedir(), ".ssh"), join(d, "innocent")); assert.throws(() => checkMount(join(d, "innocent")), /refusing/); }
  const f = join(d, "t");
  writeFileSync(f, "tok\n");
  chmodSync(f, 0o644);
  assert.throws(() => readToken(f), /mode 600/);
  chmodSync(f, 0o600);
  assert.equal(readToken(f), "tok");
  assert.throws(() => parseArgs(["run", "--id", "../x", "r"]), /--id must match/);
  assert.throws(() => parseArgs(["run", "--workdir", "/wt", "r"]), /not both/);
});

test("egress: allow list, 443 only, no suffix tricks; the model API host is not reachable directly; only the placeholder is swapped", () => {
  assert.ok(decide("github.com:443", DEFAULT_ALLOW).ok);
  assert.equal(decide("api.anthropic.com:443", DEFAULT_ALLOW).ok, false);
  assert.equal(decide("github.com:22", DEFAULT_ALLOW).why, "port");
  assert.equal(decide("github.com.evil.net:443", DEFAULT_ALLOW).ok, false);
  const opts = { token: "REAL", placeholder: "PH", host: "api.anthropic.com" };
  assert.deepEqual(injectHeaders({ authorization: "Bearer PH", connection: "keep-alive", "x-a": "1" }, opts), { headers: { authorization: "Bearer REAL", host: "api.anthropic.com", "x-a": "1" }, injected: true });
  assert.equal(injectHeaders({ authorization: "Bearer other" }, opts).headers.authorization, "Bearer other");
});

// A repo with one commit and a linked worktree on branch `issue-1`, as the runner makes.
function lab() {
  const d = mkdtempSync(join(tmpdir(), "box-"));
  const repo = join(d, "r"), wt = join(d, "wt"), cache = join(d, "cache");
  const g = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-qm", "init");
  g(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  g(repo, "worktree", "add", "-q", wt, "-b", "issue-1");
  return { d, repo, wt, cache, g, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

test("--workdir: refuses a plain checkout, a dirty tree, a detached HEAD; commits come back fast-forward and no box hook or config runs on the host", (t) => {
  const L = lab();
  t.after(L.cleanup);
  assert.throws(() => prepareWorkdir(L.repo, { id: "p1", cacheDir: L.cache }), /plain checkout/);
  writeFileSync(join(L.wt, "dirty.txt"), "x");
  assert.throws(() => prepareWorkdir(L.wt, { id: "p2", cacheDir: L.cache }), /uncommitted/);
  rmSync(join(L.wt, "dirty.txt"));
  const s = { id: "w1", ...prepareWorkdir(L.wt, { id: "w1", cacheDir: L.cache }) };
  assert.equal(L.g(s.work, "remote"), "");
  writeFileSync(join(s.work, "b.txt"), "b\n");
  L.g(s.work, "add", "-A");
  L.g(s.work, "commit", "-qm", "box work");
  const marker = join(L.d, "PWNED");
  L.g(s.work, "config", "core.fsmonitor", `touch ${marker}; false`);
  L.g(s.work, "config", "uploadpack.packObjectsHook", `touch ${marker}; git pack-objects`);
  mkdirSync(join(s.work, ".git", "hooks"), { recursive: true });
  writeFileSync(join(s.work, ".git", "hooks", "post-merge"), `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(join(s.work, ".git", "hooks", "post-merge"), 0o755);
  fetchBack(s);
  assert.equal(s.commits, 1);
  assert.equal(L.g(L.wt, "log", "-1", "--format=%s"), "box work");
  assert.ok(!existsSync(marker), "no box config or hook ran on the host");
  // Rewritten history is not applied; a redirected .git is refused.
  const s2 = { id: "w2", ...prepareWorkdir(L.wt, { id: "w2", cacheDir: L.cache }) };
  L.g(s2.work, "commit", "-q", "--amend", "-m", "rewritten");
  fetchBack(s2);
  assert.equal(s2.diverged, true);
  assert.equal(L.g(L.wt, "log", "-1", "--format=%s"), "box work");
  rmSync(join(s2.work, ".git"), { recursive: true });
  symlinkSync(join(L.repo, ".git"), join(s2.work, ".git"));
  assert.throws(() => checkCloneShape(s2.work), /not a directory/);
  // Clone mode: the new branch must not exist; the box's own main does not move the host's.
  assert.throws(() => prepareClone(L.repo, { id: "c0", cacheDir: L.cache, branch: "main" }), /already exists/);
  const c = { id: "c1", ...prepareClone(L.repo, { id: "c1", cacheDir: L.cache }) };
  writeFileSync(join(c.work, "c.txt"), "c\n");
  L.g(c.work, "add", "-A");
  L.g(c.work, "commit", "-qm", "clone work");
  L.g(c.work, "branch", "-f", "main", "HEAD");
  fetchBack(c);
  assert.equal(L.g(L.repo, "log", "-1", "--format=%s", "box/c1"), "clone work");
  assert.equal(L.g(L.repo, "log", "-1", "--format=%s", "main"), "init");
});

test("npm install: the snapshot carries the package's runtime dependencies and mounts no install folder", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "box-npm-"));
  t.after(() => { execFileSync("chmod", ["-R", "u+w", tmp]); rmSync(tmp, { recursive: true, force: true }); });
  const root = join(tmp, "npm", "node_modules");
  const pkg = (dir, meta) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "package.json"), JSON.stringify(meta)); };
  pkg(join(root, "@me", "tool"), { name: "@me/tool", version: "9.9.9", dependencies: { a: "1", "@s/b": "1" }, optionalDependencies: { gone: "1" } });
  writeFileSync(join(root, "@me", "tool", "index.js"), "");
  pkg(join(root, "a"), { name: "a", dependencies: { c: "1", d: "2" } });
  pkg(join(root, "a", "node_modules", "d"), { name: "d", version: "2", dependencies: { e: "1" } });
  pkg(join(root, "@s", "b"), { name: "@s/b" });
  pkg(join(root, "c"), { name: "c" });
  pkg(join(root, "d"), { name: "d", version: "1" });
  pkg(join(root, "e"), { name: "e" });
  pkg(join(root, "unrelated"), { name: "unrelated" });
  assert.deepEqual(dependencyDirs(root, join(root, "@me", "tool")), ["@s/b", "a", "c", "e"]);
  const snap = pitcrewSnapshot(join(tmp, "cache"), join(root, "@me", "tool"));
  assert.equal(snap.sha, "npm-9.9.9");
  assert.equal(snap.modules, undefined);
  for (const p of ["index.js", "node_modules/a/node_modules/d/package.json", "node_modules/@s/b/package.json", "node_modules/c/package.json", "node_modules/e/package.json"])
    assert.ok(existsSync(join(snap.dir, p)), p);
  assert.ok(!existsSync(join(snap.dir, "node_modules", "unrelated")));
  assert.ok(!existsSync(join(snap.dir, "node_modules", "d")));
});

test("snapshot: a build that fails leaves no cached folder behind", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "box-fail-"));
  t.after(() => { execFileSync("chmod", ["-R", "u+w", tmp]); rmSync(tmp, { recursive: true, force: true }); });
  const root = join(tmp, "npm", "node_modules"), tool = join(root, "tool");
  mkdirSync(tool, { recursive: true });
  writeFileSync(join(tool, "package.json"), JSON.stringify({ name: "tool", version: "1.0.0", dependencies: { a: "1" } }));
  mkdirSync(join(root, "a"));
  writeFileSync(join(root, "a", "package.json"), "{ not json");
  assert.throws(() => pitcrewSnapshot(join(tmp, "cache"), tool));
  assert.deepEqual(execFileSync("ls", ["-A", join(tmp, "cache", "pitcrew")], { encoding: "utf8" }), "");
});
