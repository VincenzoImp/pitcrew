import assert from "node:assert/strict";
import test from "node:test";
import guard, { statusText } from "../extensions/guard/index.ts";
import { checkBash } from "../extensions/guard/rules.ts";
import { fakeCtx, fakePi } from "./helpers.mjs";

const place = { cwd: "/home/u/code/app", root: "/home/u/code/app", home: "/home/u", scratch: ["/tmp"] };
const verdict = (command) => { const v = checkBash(command, place); return v ? `${v.level}:${v.rule}` : "pass"; };

test("busy-wait loops are blocked", () => {
  for (const c of ["while :; do :; done", "until curl -s localhost:8080; do true; done", "while true\ndo\n  :\ndone",
    "bash -c 'while :; do :; done'", "for i in 1 2; do :; done & wait"]) assert.equal(verdict(c), "block:busy-wait", c);
  for (const c of ["while :; do sleep 5; done", "until curl -s x; do sleep 1; done", "while read l; do echo $l; done < f",
    "echo 'while :; do :; done' > notes.md", "cat <<'EOF' > a.sh\nwhile :; do :; done\nEOF"]) assert.equal(verdict(c), "pass", c);
});

test("status text", () => {
  assert.equal(statusText(false, 0, 0), "guard");
  assert.equal(statusText(true, 0, 0), "guard off");
  assert.equal(statusText(false, 1, 2), "guard 1✗ 2?");
  assert.equal(statusText(true, 0, 3), "guard off 3?");
});

const call = (command) => ({ toolName: "bash", input: { command } });

test("/guard off skips asks, keeps blocks and guard-bypass asks, persists per session", async () => {
  const { pi, commands, appended, emit } = fakePi();
  guard(pi);
  const ctx = fakeCtx({ cwd: "/tmp" });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.equal(ctx.status["pitcrew.guard"], "guard");
  await commands.guard.handler("off", ctx);
  assert.deepEqual(appended, [{ type: "custom", customType: "guard-state", data: { off: true } }]);
  assert.equal(ctx.status["pitcrew.guard"], "guard off");
  assert.equal(await emit("tool_call", call("git push origin main"), ctx), undefined);
  assert.equal(ctx.dialogs.length, 0);
  assert.equal((await emit("tool_call", call("rm -rf ~"), ctx)).block, true);
  await emit("tool_call", call("PI_GUARD_ALLOW=git-push pi -p x"), ctx);
  assert.equal(ctx.dialogs.length, 1);
  assert.equal(ctx.status["pitcrew.guard"], "guard off 1✗ 1?");
  // A resumed session restores the state from its entries.
  const again = fakePi();
  guard(again.pi);
  const resumed = fakeCtx({ cwd: "/tmp", branch: appended });
  await again.emit("session_start", { reason: "resume" }, resumed);
  assert.equal(resumed.status["pitcrew.guard"], "guard off");
});

test("strict runs: no asks, /guard off ignored, third block terminates", async () => {
  for (const ctx of [fakeCtx({ cwd: "/tmp", hasUI: false })]) {
    const { pi, commands, appended, emit } = fakePi();
    guard(pi);
    await emit("session_start", { reason: "startup" }, ctx);
    await commands.guard.handler("off", ctx);
    assert.equal(appended.length, 0);
    await emit("input", { text: "go", source: "interactive" }, ctx);
    const results = [];
    for (const c of ["git push", "sudo ls", "cat ~/.ssh/id_rsa"]) results.push(await emit("tool_call", call(c), ctx));
    assert.deepEqual(results.map((r) => [r.block, r.terminate]), [[true, false], [true, false], [true, true]]);
    assert.equal(ctx.dialogs.length, 0);
  }
  // RPC children have a UI channel; PI_GUARD_STRICT=1 makes them strict too.
  process.env.PI_GUARD_STRICT = "1";
  try {
    const { pi, emit } = fakePi();
    guard(pi);
    const ctx = fakeCtx({ cwd: "/tmp" });
    const r = await emit("tool_call", call("git push"), ctx);
    assert.equal(r.block, true);
    assert.equal(ctx.dialogs.length, 0);
  } finally {
    delete process.env.PI_GUARD_STRICT;
  }
});

test("a terminated turn leaves a visible guard-blocked message and starts no turn", async () => {
  const { pi, sent, emit } = fakePi();
  guard(pi);
  const ctx = fakeCtx({ cwd: "/tmp", confirm: false });
  await emit("session_start", { reason: "startup" }, ctx);
  assert.equal((await emit("tool_call", call("git push --force origin main"), ctx)).terminate, true);
  assert.equal((await emit("tool_call", call("sudo ls"), ctx)).terminate, true);   // declined
  assert.equal(await emit("tool_call", call("ls"), ctx), undefined);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => [m.message.customType, m.message.display, m.options.triggerTurn]), [["guard-blocked", true, false], ["guard-blocked", true, false]]);
  assert.match(sent[0].message.content, /^Guard blocked \(git-force-push\)[\s\S]*git push --force origin main[\s\S]*nothing after this call ran/);
  assert.match(sent[1].message.content, /^Guard stopped: you declined \(sudo\)/);
});

test("general rules: token prints ask `secret`; runs and GitHub writes ask `publish`; guard bypasses ask", () => {
  for (const c of ["gh auth token", "gh auth status --show-token", "printenv CLAUDE_CODE_OAUTH_TOKEN", "printenv", "echo $GH_TOKEN", "env"]) assert.equal(verdict(c), "ask:secret", c);
  for (const c of ["pitcrew run v0.3", "nohup pitcrew run 12", "pitcrew box run . -- -p x", "gh issue create -t x -b y", "gh pr create --draft", "gh pr comment 3 -b x", "gh issue edit 3 --add-label x"]) assert.equal(verdict(c), "ask:publish", c);
  for (const c of ["env -u PI_GUARD_STRICT pi -p x", "env --unset=PI_GUARD_STRICT pi", "unset PI_GUARD_STRICT", "git -c core.hooksPath=/tmp/h commit -m x", "git -c core.fsmonitor=evil status"]) assert.equal(verdict(c), "ask:guard-bypass", c);
  for (const c of ["printenv PATH", "echo $HOME", "pitcrew status", "gh pr view 3", "gh issue list", "env -u FOO npm test", "git -c user.name=x commit -m y"]) assert.equal(verdict(c), "pass", c);
});
