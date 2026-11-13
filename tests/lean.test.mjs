import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { branchChanges, DEFAULT_BOUNDS, kindOf, leanReport, render } from "../lib/lean.ts";

const change = (path, added, deleted = 0, texts = []) => ({ path, added, deleted, addedLines: texts.map((text, i) => ({ line: i + 1, text })) });

test("what counts as test code, code, and neither", () => {
  for (const p of ["tests/a.test.mjs", "src/__tests__/x.ts", "pkg/foo_test.go", "test_api.py", "app/models.spec.ts", "spec/user_spec.rb", "tests/fixtures/big.json", "conftest.py"]) assert.equal(kindOf(p), "test", p);
  for (const p of ["src/index.ts", "lib/tidy.ts", "bin/pitcrew", "Makefile", "app/main.py", "contest.py"]) assert.equal(kindOf(p), "code", p);
  for (const p of ["README.md", "docs/guide.ts", "package-lock.json", "config.yaml", "dist/app.js", "LICENSE", ".gitignore", "src/__snapshots__/a.snap"]) assert.equal(kindOf(p), "other", p);
});

test("size and test-to-code ratio, with bounds", () => {
  const ok = leanReport([change("src/a.ts", 100, 20), change("tests/a.test.ts", 120), change("README.md", 900)]);
  assert.deepEqual(ok.findings, []);
  assert.deepEqual(ok.other, { added: 900, deleted: 0 });
  const big = leanReport([change("src/a.ts", 300, 50), change("tests/a.test.ts", 100)]);
  assert.match(big.findings[0], /change size 450 lines .*bound 400/);
  const heavy = leanReport([change("src/a.ts", 40), change("tests/a.test.ts", 100)]);
  assert.match(heavy.findings[0], /tests are 2\.5× the code added \(100 \/ 40, bound 1\.5×\)/);
  // A tiny code change is not judged by ratio; a bound of 0 turns a check off.
  assert.deepEqual(leanReport([change("src/a.ts", 5), change("tests/a.test.ts", 60)]).findings, []);
  assert.deepEqual(leanReport([change("src/a.ts", 300, 200)], { ...DEFAULT_BOUNDS, maxLines: 0 }).findings, []);
});

test("shortcut markers must name their upgrade trigger", () => {
  const r = leanReport([change("src/a.ts", 4, 0, [
    "// shortcut: in-memory cache, move to redis when there is a second instance",
    "# shortcut: no retries",
    "/* shortcut: linear scan */",
    "const keyboardShortcut = 'ctrl+s'; // not a marker",
    'const text = "# shortcut: in a string, not a comment";',
  ])]);
  assert.equal(r.findings.length, 2);
  assert.match(r.findings[0], /src\/a\.ts:2 shortcut marker names no upgrade trigger/);
  assert.match(r.findings[1], /src\/a\.ts:3 /);
});

test("levels: off says nothing, warn exits 0, block exits 1", () => {
  const report = leanReport([change("src/a.ts", 500)]);
  assert.deepEqual(render(report, "off", "origin/main"), { lines: ["pitcrew check: lean-code checks are off (leanCode off)"], exit: 0 });
  const warn = render(report, "warn", "origin/main");
  assert.equal(warn.exit, 0);
  assert.match(warn.lines[1], /^warn: change size 500/);
  const block = render(report, "block", "origin/main");
  assert.equal(block.exit, 1);
  assert.match(block.lines[1], /^block: /);
  assert.deepEqual(render(leanReport([change("src/a.ts", 5)]), "block", "main").exit, 0);
});

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("branch changes: commits, uncommitted edits, new and deleted files", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lean-")));
  dirs.push(dir);
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "old.ts"), "a\nb\nc\n");
  writeFileSync(join(dir, "keep.ts"), "x\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-q", "-c", "work");
  writeFileSync(join(dir, "keep.ts"), "x\ny\n");
  git("commit", "-qam", "edit");
  unlinkSync(join(dir, "old.ts"));
  writeFileSync(join(dir, "new.test.ts"), "t1\nt2\n");
  const found = branchChanges(dir, "main");
  const by = Object.fromEntries(found.changes.map((c) => [c.path, [c.added, c.deleted]]));
  assert.deepEqual(by, { "keep.ts": [1, 0], "old.ts": [0, 3], "new.test.ts": [2, 0] });
  assert.equal(found.root, dir);
});
