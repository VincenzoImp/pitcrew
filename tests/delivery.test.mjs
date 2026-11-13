import assert from "node:assert/strict";
import { test } from "node:test";
import guard from "../extensions/guard/index.ts";
import { checkDelivery, skipsAsk } from "../extensions/guard/delivery.ts";
import { checkBash } from "../extensions/guard/rules.ts";
import { deliveryFacts, ranVerify } from "../lib/facts.ts";
import { treeId } from "../extensions/verify-gate/receipts.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_MODE, resolveMode } from "../lib/mode.ts";
import { fakeCtx, fakePi } from "./helpers.mjs";

// Delivery rules: each one on and off. Facts are fakes; `own` and `theirs` are the two kinds of repo.

const own = { name: "me/app", permission: "ADMIN", defaultBranch: "main" };
const theirs = { name: "org/lib", permission: "WRITE", defaultBranch: "main" };
const facts = (over = {}) => ({
  repo: () => own, remote: () => "me/app", branch: () => "feat", commits: () => "", readFile: () => undefined,
  verified: () => true, worktrees: () => ({ count: 2, gb: 1 }), ...over,
});
const mode = (input = {}) => resolveMode(input);
const rules = (command, m = mode(), f = facts(), caps) => {
  const r = checkDelivery(command, "/home/u/app", m, f, caps);
  return { said: r.verdicts.map((v) => `${v.level}:${v.rule}`).join(" ") || "pass", allowed: [...r.allowed] };
};

test("a PR must close an issue (issueRequired)", () => {
  assert.equal(rules('gh pr create -t "Fix login" -b "It works now"').said, "ask:issue-required");
  assert.deepEqual(rules('gh pr create -t "Fix login" -b "Closes #12"'), { said: "pass", allowed: [0] });
  assert.equal(rules("gh pr create -t x -b 'fixes: me/app#3'").said, "pass");
  assert.equal(rules("gh pr create -t x -F pr.md", mode(), facts({ readFile: () => "## What\n\nResolves #4\n" })).said, "pass");
  assert.equal(rules("gh pr create --fill", mode(), facts({ commits: () => "Add x\n\nCloses #5" })).said, "pass");
  assert.equal(rules("gh pr create --fill").said, "ask:issue-required");
  // A body file written by a here-document earlier in the same line (it does not exist yet when the guard looks).
  assert.equal(rules("cat > /tmp/b.md <<'EOF'\n## What\nCloses #12\nEOF\ngh pr create -t x -F /tmp/b.md").said, "pass");
  assert.equal(rules('gh pr create -B release -b "Closes #1"').said, "ask:issue-required"); // not the default branch
  // Off: the switch, the fast preset, or tracking without GitHub issues.
  assert.equal(rules("gh pr create -t x -b y", mode({ switches: { issueRequired: "off" } })).said, "pass");
  assert.equal(rules("gh pr create -t x -b y", mode({ rigor: "fast" })).said, "pass");
  assert.equal(rules("gh pr create -t x -b y", { ...mode(), tracking: "local" }).said, "pass");
});

test("merge only when the stop dial allows it, on a verified head; never --admin", () => {
  const sha = "--match-head-commit 3f2a1c0";
  assert.equal(rules(`gh pr merge 3 --squash ${sha}`).said, "ask:stop"); // default stop: pr
  const merge = mode({ stop: "merge" });
  assert.deepEqual(rules(`gh pr merge 3 --squash ${sha}`, merge), { said: "pass", allowed: [0] });
  assert.deepEqual(rules(`gh pr merge 3 --squash ${sha}`, mode({ stop: "milestone" })).said, "pass");
  assert.equal(rules("gh pr merge 3 --squash", merge).said, "ask:merge-head");
  assert.equal(rules('gh pr merge 3 --squash --match-head-commit "$sha"', merge).said, "ask:merge-head");
  assert.equal(rules(`gh pr merge 3 ${sha}`, merge, facts({ verified: () => false })).said, "ask:merge-head");
  assert.equal(rules(`gh pr merge 3 ${sha}`, merge, facts({ verified: () => undefined })).said, "pass"); // repo has no verify command
  assert.equal(rules(`gh pr merge 3 ${sha}`, mode({ stop: "merge", switches: { verify: "off" } }), facts({ verified: () => false })).said, "pass");
  assert.equal(rules(`gh pr merge 3 --admin ${sha}`, merge).said, "block:merge");
  assert.equal(rules("gh api -X PUT repos/me/app/pulls/3/merge", mode()).said, "ask:stop");
});

test("foreign repos: no objects, settings, pushes or merges without the owner (always on)", () => {
  const f = facts({ repo: () => theirs, remote: () => "org/lib" });
  for (const command of ['gh pr create -b "Closes #1"', "gh issue create -t x -b y", "gh label create bug", "gh repo edit --delete-branch-on-merge",
    "gh issue edit 4 --add-assignee @me", "gh api -X POST repos/org/lib/milestones -f title=x", "git push -u origin feat"]) {
    assert.equal(rules(command, mode({ stop: "merge" }), f).said, "ask:foreign-repo", command);
  }
  assert.equal(rules("gh pr merge 3 --match-head-commit abc", mode({ stop: "merge" }), f).said, "ask:foreign-repo");
  // Reading and commenting stay as they were (the guard's usual asks), but nothing is skipped.
  assert.deepEqual(rules("gh issue comment 4 -b ok", mode(), f), { said: "pass", allowed: [] });
  for (const permission of ["ADMIN"]) assert.equal(rules("gh label create bug", mode(), facts({ repo: () => ({ ...own, permission }) })).said, "pass");
});

test("caps on worktrees and disk use", () => {
  const full = facts({ worktrees: () => ({ count: 20, gb: 3 }) });
  assert.equal(rules("git worktree add ../wt -b x", mode(), full).said, "ask:cap");
  assert.equal(rules("gh issue develop 4 --worktree ../wt", mode(), full).said, "ask:cap");
  assert.equal(rules("git worktree add ../wt -b x", mode(), facts({ worktrees: () => ({ count: 3, gb: 25 }) })).said, "ask:cap");
  assert.equal(rules("git worktree add ../wt -b x", mode(), full, { worktrees: 0, diskGB: 0 }).said, "pass");
  assert.equal(rules("git worktree add ../wt -b x", mode(), facts()).said, "pass");
});

test("inside the stop dial the usual push and publish asks are skipped, only for that command", () => {
  const place = { cwd: "/home/u/app", root: "/home/u/app", home: "/home/u", scratch: ["/tmp"] };
  const verdict = (command, m = mode()) => {
    const v = checkBash(command, place, 0, skipsAsk(checkDelivery(command, place.cwd, m, facts())));
    return v ? `${v.level}:${v.rule}` : "pass";
  };
  assert.equal(verdict("git push -u origin feat"), "pass");
  assert.equal(verdict("git push origin main"), "ask:git-push"); // the default branch
  assert.equal(verdict("git push origin --delete feat"), "ask:git-push");
  assert.equal(verdict("git push -u origin feat", mode({ stop: "local" })), "ask:git-push");
  assert.equal(verdict("git push -u origin feat && cat ~/.ssh/id_rsa"), "ask:secret");
  assert.equal(verdict('gh pr create -t x -b "Closes #1"'), "pass");
  assert.equal(verdict('gh pr create -t x -b "Closes #1"', mode({ stop: "plan" })), "ask:publish");
  assert.equal(verdict("gh pr merge 3 --squash --match-head-commit abc", mode({ stop: "merge" })), "pass");
});

test("everyday commands ask for no facts and get no verdict", () => {
  const none = new Proxy({}, { get: (_, name) => () => assert.fail(`asked for ${String(name)}`) });
  for (const command of ["git status", "git commit -m x", "npm test", "gh pr view 3", "gh issue list", "gh pr checks 3 --watch",
    "git log --oneline", "ls -la", "gh api repos/me/app/milestones", "git worktree list"]) {
    assert.deepEqual(checkDelivery(command, "/home/u/app", mode(), none).verdicts, [], command);
  }
});

test("inside stop milestone, closing the milestone and cutting its release do not ask (own repo only)", () => {
  const close = "gh api -X PATCH repos/me/app/milestones/3 -f state=closed";
  const release = "gh release create v0.3.0 --generate-notes";
  const asks = (command, m, f = facts()) => checkBash(command, { cwd: "/home/u/app", root: "/home/u/app", home: "/home/u", scratch: ["/tmp"], real: (p) => p }, 0,
    skipsAsk(checkDelivery(command, "/home/u/app", m, f)))?.rule ?? "pass";
  for (const command of [close, release]) {
    assert.equal(asks(command, mode({ stop: "milestone" })), "pass", command);
    assert.equal(asks(command, mode({ stop: "merge" })), "github-write", command);
    assert.equal(rules(command, mode({ stop: "milestone" }), facts({ repo: () => theirs })).said, "ask:foreign-repo", command);
  }
  assert.equal(asks("gh api -X PATCH repos/me/app/milestones/3 -f title=x", mode({ stop: "milestone" })), "github-write", "only closing");
});

test("wiring: the guard asks with the rule's reason, and answers project trust 'no' for a foreign repo", async () => {
  const { pi, emit } = fakePi();
  let repo = own;
  guard(pi, () => facts({ repo: () => repo }));
  const ctx = fakeCtx({ cwd: "/tmp", confirm: false });
  await emit("session_start", { reason: "startup" }, ctx);
  process.env[ENV_MODE] = JSON.stringify(mode({ stop: "merge" }));
  try {
    const r = await emit("tool_call", { toolName: "bash", input: { command: "gh pr merge 3 --squash" } }, ctx);
    assert.equal(r.block, true);
    assert.match(ctx.dialogs[0].title, /--match-head-commit/);
    assert.equal(await emit("tool_call", { toolName: "bash", input: { command: "gh pr merge 3 --match-head-commit abc" } }, ctx), undefined);
  } finally {
    delete process.env[ENV_MODE];
  }
  const trust = fakeCtx({ cwd: "/tmp" });
  assert.deepEqual(await emit("project_trust", { cwd: "/x" }, trust), { trusted: "undecided" });
  repo = theirs;
  assert.deepEqual(await emit("project_trust", { cwd: "/x" }, trust), { trusted: "no" });
  assert.match(trust.notices[0].text, /org\/lib is not your repo/);
});

test("project trust works before pi's action methods do (getSettings throws then)", async () => {
  const { pi, emit } = fakePi();
  pi.getSettings = () => { throw new Error("Extension runtime not initialized"); };
  guard(pi);
  assert.deepEqual(await emit("project_trust", { cwd: "/" }, fakeCtx({ cwd: "/" })), { trusted: "undecided" });
});

test("a verify run in the same turn counts for the merge rule (the gate's receipt comes at the end of the turn)", async () => {
  assert.equal(ranVerify("npm run check", "npm run check"), true);
  assert.equal(ranVerify("cd ../wt && npm run check 2>&1", "npm run check"), true);
  assert.equal(ranVerify("npm run check | tail -5", "npm run check"), false);
  assert.equal(ranVerify("npm run check || true", "npm run check"), false);
  assert.equal(ranVerify("git status && npm run check && node greet.js --name A", "npm run check"), true);
  assert.equal(ranVerify("npm run check; echo done", "npm run check"), false);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "verified-")));
  try {
    const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    writeFileSync(join(dir, "package.json"), '{"scripts":{"check":"true"}}');
    git("add", ".");
    git("commit", "-qm", "x");
    const ctx = { cwd: dir, sessionManager: { getBranch: () => [] } };
    const checked = new Set();
    assert.equal(deliveryFacts(ctx, () => join(dir, ".work"), checked).verified(dir, "HEAD"), false);
    checked.add(await treeId(dir));
    assert.equal(deliveryFacts(ctx, () => join(dir, ".work"), checked).verified(dir, "HEAD"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
