import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addShared, findShared, receiptsFile } from "../extensions/verify-gate/receipts.ts";
import verifyGate, { discoverVerify, isCheckCommand, REMINDER, treeId, writesFiles } from "../extensions/verify-gate/index.ts";
import { fakeCtx, fakePi } from "./helpers.mjs";
import { ENV_MODE } from "../lib/mode.ts";
import { describeVerify } from "../lib/verify.ts";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-gate-test-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init", "--allow-empty");
  return dir;
}
const pkg = (scripts) => JSON.stringify({ name: "x", scripts });

test("discovery order", () => {
  const dirs = [];
  const check = (files, want, env = {}) => {
    const dir = repo(files);
    dirs.push(dir);
    if (files["scripts/verify"]) chmodSync(join(dir, "scripts/verify"), 0o755);
    assert.equal(discoverVerify(join(dir), env)?.command, want, JSON.stringify(Object.keys(files)));
  };
  try {
    check({ "package.json": pkg({ verify: "x", check: "y" }) }, "npm run verify");
    check({ "package.json": pkg({ check: "y", test: "z" }) }, "npm run check");
    check({ "package.json": pkg({ check: "y" }), "pnpm-lock.yaml": "" }, "pnpm run check");
    check({ "package.json": pkg({ verify: "y" }), "yarn.lock": "" }, "yarn run verify");
    check({ "package.json": pkg({ test: "z" }), Makefile: "verify: lint\n\tmake test\n" }, "make verify");
    check({ Makefile: "VERIFY := 1\nbuild:\n" }, undefined);
    check({ justfile: "verify:\n  cargo test\n" }, "just verify");
    check({ "scripts/verify": "#!/bin/sh\nexit 0\n" }, "./scripts/verify");
    check({ "package.json": pkg({ verify: "x" }) }, "make ci", { PI_VERIFY: "make ci" });
    // The test entry points only after every explicit verify command.
    check({ "package.json": pkg({ test: "node --test" }) }, "npm run test");
    check({ "package.json": pkg({ test: "z" }), "pnpm-lock.yaml": "" }, "pnpm run test");
    check({ "package.json": pkg({ test: "z" }), "scripts/verify": "#!/bin/sh\nexit 0\n" }, "./scripts/verify");
    check({ "package.json": pkg({ test: "echo \"Error: no test specified\" && exit 1" }) }, undefined);
    check({ Makefile: "build:\n\tcc a.c\ntest: build\n\t./a.out\n" }, "make test");
    check({ justfile: "test:\n  cargo test\n" }, "just test");
    check({ "package.json": pkg({ test: "z" }), Makefile: "test:\n\tmake x\n" }, "npm run test");
    check({ Makefile: "TEST := 1\nbuild:\n" }, undefined);
    check({ "package.json": pkg({ lint: "x" }) }, undefined);
    const sub = repo({ "package.json": pkg({ verify: "x" }), "src/a.ts": "" });
    dirs.push(sub);
    assert.equal(discoverVerify(join(sub, "src"), {})?.root, execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: sub, encoding: "utf8" }).trim());
    // The output says which command was chosen and why.
    const only = repo({ "package.json": pkg({ test: "node --test" }) });
    dirs.push(only);
    assert.equal(describeVerify(discoverVerify(only, {})),
      "npm run test (the `test` script in package.json; no verify or check script, verify target or scripts/verify)");
    assert.equal(describeVerify(discoverVerify(sub, {})), "npm run verify (the `verify` script in package.json)");
    assert.equal(describeVerify(discoverVerify(sub, { PI_VERIFY: "make ci" })), "make ci (PI_VERIFY is set)");
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test("tree id sees bash edits, untracked files and lockfile changes, not ignored files", async () => {
  const dir = repo({ "a.txt": "1", ".gitignore": "node_modules/\n" });
  try {
    const t0 = await treeId(dir);
    assert.match(t0, /^[0-9a-f]{40}$/);
    assert.equal(await treeId(dir), t0);
    writeFileSync(join(dir, "a.txt"), "2");
    const t1 = await treeId(dir);
    assert.notEqual(t1, t0);
    writeFileSync(join(dir, "new.txt"), "x");
    const t2 = await treeId(dir);
    assert.notEqual(t2, t1);
    writeFileSync(join(dir, "package-lock.json"), "{}");
    assert.notEqual(await treeId(dir), t2);
    const t3 = await treeId(dir);
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/x.js"), "x");
    assert.equal(await treeId(dir), t3);
    // The real index is untouched.
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).includes("?? new.txt"), true);
    assert.equal(await treeId(tmpdir()), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fallback heuristics, per segment and pipe-aware.
test("check commands", () => {
  for (const c of ["npm test", "npm run check", "python3 test_calc.py", "pytest -q", "cargo clippy", "make", "npx tsc --noEmit", "go test ./...",
    "cd app && npm test", "set -o pipefail; pytest -q | tail -5"]) assert.ok(isCheckCommand(c), c);
  for (const c of ["ls tests/", "cat test.py", "git status", "grep -rn check .", "echo done", "pytest -q | tail -5", "npm test || true",
    "true # test", "python3 -c \"print('check')\"", "make -n"]) assert.ok(!isCheckCommand(c), c);
});

test("file-writing bash commands", () => {
  for (const c of ["sed -i 's/a/b/' x.py", "echo hi > notes.txt", "cat <<EOF >> a.md", "git apply fix.patch", "printf x | tee out"]) assert.ok(writesFiles(c), c);
  for (const c of ["npm test 2>&1", "ls > /dev/null", "grep x a.txt", "cmd 2>&1 | tail", "git diff HEAD > /tmp/review-1.diff"]) assert.ok(!writesFiles(c), c);
});

const settle = { outcome: "completed", entries: [], continue: false };

async function session(dir, { trusted = true, settings = {} } = {}) {
  const fake = fakePi(settings);
  verifyGate(fake.pi, () => trusted);
  const ctx = fakeCtx({ cwd: dir, trusted });
  await fake.emit("session_start", { reason: "startup" }, ctx);
  await fake.emit("input", { text: "go", source: "interactive" }, ctx);
  return { ...fake, ctx, settle: () => fake.emit("agent_before_settle", settle, ctx) };
}

test("unchanged tree: nothing runs", async () => {
  const dir = repo({ "package.json": pkg({ verify: "touch ran" }) });
  try {
    const s = await session(dir);
    assert.equal(await s.settle(), undefined);
    assert.equal(s.ctx.status["pitcrew.gate"], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("passing verify leaves a receipt bound to the tree", async () => {
  const dir = repo({ "package.json": pkg({ verify: "test -f ok.txt" }) });
  try {
    const s = await session(dir);
    writeFileSync(join(dir, "ok.txt"), "x");
    const r = await s.settle();
    assert.equal(r.continue, undefined);
    assert.equal(r.entries.length, 2);
    assert.equal(r.entries[0].customType, "verify-receipt");
    assert.equal(r.entries[0].data.tree, await treeId(dir));
    assert.equal(r.entries[0].data.exit, 0);
    // A visible line, so the reply cannot contradict the gate (m4).
    assert.equal(r.entries[1].display, true);
    assert.match(r.entries[1].content, /^verify ✓ npm run verify \(\d+s\) @tree [0-9a-f]{7}$/);
    assert.equal(s.ctx.status["pitcrew.gate"], "verify ✓");
    // Same tree again: the receipt is reused, verify does not run twice.
    assert.equal(await s.settle(), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failing verify continues at most twice per user message, then shows the failure", async () => {
  const dir = repo({ "package.json": pkg({ verify: "echo boom; exit 3" }) });
  try {
    const s = await session(dir);
    const results = [];
    for (let round = 0; round < 4; round++) {
      writeFileSync(join(dir, "f.txt"), String(round)); // the model "fixes" something each round
      results.push(await s.settle());
    }
    assert.deepEqual(results.map((r) => r.continue ?? false), [true, true, false, false]);
    assert.match(results[0].entries[1].content, /exit 3[\s\S]*boom/);
    assert.equal(s.ctx.status["pitcrew.gate"], "verify ●");
    // Explaining without changing the tree: no rerun, no continuation.
    assert.equal(await s.settle(), undefined);
    // A new user message resets the round count.
    await s.emit("input", { text: "again", source: "interactive" }, s.ctx);
    writeFileSync(join(dir, "f.txt"), "new");
    assert.equal((await s.settle()).continue, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fix that restores the start tree is still verified", async () => {
  const dir = repo({ "package.json": pkg({ verify: "test ! -f bad.txt" }) });
  try {
    const s = await session(dir);
    writeFileSync(join(dir, "bad.txt"), "x");
    assert.equal((await s.settle()).continue, true);
    rmSync(join(dir, "bad.txt"));
    const r = await s.settle();
    assert.equal(r.entries[0].data.exit, 0);
    assert.equal(s.ctx.status["pitcrew.gate"], "verify ✓");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("untrusted project or no verify command: one reminder", async () => {
  for (const [files, opts] of [[{ "package.json": pkg({ verify: "touch ran" }) }, { trusted: false }], [{ "a.txt": "" }, {}]]) {
    const dir = repo(files);
    try {
      const s = await session(dir, opts);
      writeFileSync(join(dir, "a.txt"), "changed");
      const r = await s.settle();
      assert.equal(r.continue, true);
      assert.equal(r.entries[0].content, REMINDER);
      assert.equal(s.ctx.status["pitcrew.gate"], "verify ↻");
      assert.equal(await s.settle(), undefined);
      assert.equal(execFileSync("ls", [dir], { encoding: "utf8" }).includes("ran"), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("the verify switch off and remind", async () => {
  const dir = repo({ "package.json": pkg({ verify: "touch ran" }) });
  const verify = (value) => { process.env[ENV_MODE] = JSON.stringify({ switches: { verify: value } }); };
  try {
    verify("off");
    const off = await session(dir);
    writeFileSync(join(dir, "a.txt"), "x");
    assert.equal(await off.settle(), undefined);
    verify("remind");
    const remind = await session(dir);
    writeFileSync(join(dir, "a.txt"), "y");
    assert.equal((await remind.settle()).entries[0].content, REMINDER);
  } finally { delete process.env[ENV_MODE]; rmSync(dir, { recursive: true, force: true }); }
});

test("once per tree: a receipt from another process of the session tree is reused, not run again (M1)", async () => {
  const dir = repo({ "package.json": pkg({ verify: "touch ran" }) });
  const tree = mkdtempSync(join(tmpdir(), "verify-tree-"));
  const saved = process.env.PITCREW_TREE;
  process.env.PITCREW_TREE = tree;
  try {
    const s = await session(dir);
    writeFileSync(join(dir, "a.txt"), "x");
    const id = await treeId(dir);
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim();
    addShared(receiptsFile(tree), { tree: id, command: "npm run verify", exit: 0, ms: 5, root, by: "worker-1" });
    const r = await s.settle();
    assert.equal(execFileSync("ls", [dir], { encoding: "utf8" }).includes("ran"), false);
    assert.equal(r.entries[0].data.by, "worker-1");
    assert.match(r.entries[1].content, /receipt from worker-1; not run again/);
    assert.equal(s.ctx.status["pitcrew.gate"], "verify ✓");
    // A new tree runs, and its receipt is shared for the others.
    writeFileSync(join(dir, "a.txt"), "y");
    await s.settle();
    assert.equal(execFileSync("ls", [dir], { encoding: "utf8" }).includes("ran"), true);
    rmSync(join(dir, "ran"));
    assert.equal(findShared(receiptsFile(tree), await treeId(dir), "npm run verify", root)?.by, "session");
    // Another command or root does not match.
    assert.equal(findShared(receiptsFile(tree), id, "make verify", root), undefined);
    assert.equal(findShared(receiptsFile(tree), id, "npm run verify", "/elsewhere"), undefined);
  } finally {
    if (saved === undefined) delete process.env.PITCREW_TREE; else process.env.PITCREW_TREE = saved;
    rmSync(dir, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
  }
});

test("a repo's check runs by itself only in your own repo or one you trusted in pi's trust.json", async () => {
  const { ownOrTrusted } = await import("../lib/facts.ts");
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  const agent = mkdtempSync(join(tmpdir(), "trust-agent-"));
  const repo = mkdtempSync(join(tmpdir(), "trust-repo-"));
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    assert.equal(ownOrTrusted(repo, "ADMIN"), true);
    assert.equal(ownOrTrusted(repo, "WRITE"), false, "pi's auto-trust of a folder without .pi is not enough");
    new ProjectTrustStore(agent).set(repo, true);
    assert.equal(ownOrTrusted(repo, "WRITE"), true);
    assert.equal(ownOrTrusted(join(repo, "sub"), undefined), true, "the nearest saved decision counts");
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved;
    rmSync(agent, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
