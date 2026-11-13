import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeCtx, fakePi } from "./helpers.mjs";
import mode from "../extensions/mode/index.ts";
import roles from "../extensions/roles/index.ts";

// /new and /handoff open a new session in the same process: it keeps the mode and the role map.
function withFlags(f, values) {
  f.pi.registerFlag = () => {};
  f.pi.getFlag = (name) => values[name];
  f.pi.registerVirtualModel = () => {};
  f.pi.setThinkingLevel = () => {};
  return f;
}

test("a new session keeps the mode of the flags and of /mode; resume restores its own", async () => {
  delete process.env.PITCREW_MODE;
  const f = withFlags(fakePi({ pitcrew: { tracking: "local" } }), { rigor: "fast" });
  mode(f.pi);
  const ctx = fakeCtx();
  await f.emit("session_start", { reason: "startup" }, ctx);
  await f.commands.mode.handler("stop merge", ctx);
  // pi loads the extensions again for a new session: a fresh instance gets the event.
  const g = withFlags(fakePi({ pitcrew: { tracking: "local" } }), {});
  mode(g.pi);
  await g.emit("session_start", { reason: "new" }, fakeCtx());
  const kept = JSON.parse(process.env.PITCREW_MODE);
  assert.deepEqual([kept.tracking, kept.stop, kept.rigor], ["local", "merge", "fast"]);
  const h = withFlags(fakePi({ pitcrew: { tracking: "local" } }), {});
  mode(h.pi);
  await h.emit("session_start", { reason: "resume" }, fakeCtx());
  const own = JSON.parse(process.env.PITCREW_MODE);
  assert.notEqual(own.stop, "merge", "a resumed session without saved mode starts from the settings");
});

test("a new session keeps the role map changed with /role", async () => {
  delete process.env.PITCREW_ROLES;
  const f = withFlags(fakePi({ pitcrew: { profile: "local" } }), {});
  roles(f.pi);
  const ctx = { ...fakeCtx(), modelRegistry: { find: () => ({}), getAvailable: () => [] }, model: undefined };
  await f.emit("session_start", { reason: "startup" }, ctx);
  await f.commands.role.handler("scout x/y:high", ctx);
  const g = withFlags(fakePi({ pitcrew: { profile: "local" } }), {});
  roles(g.pi);
  await g.emit("session_start", { reason: "new" }, { ...ctx, sessionManager: { getBranch: () => [] } });
  const map = JSON.parse(process.env.PITCREW_ROLES);
  assert.equal(map.profile, "local*");
  assert.deepEqual(map.map.scout, { model: "x/y", thinking: "high" });
});

test("stop plan takes the edit and write tools away; another stop gives them back", async () => {
  delete process.env.PITCREW_MODE;
  const f = withFlags(fakePi({ pitcrew: { tracking: "local" } }), { stop: "plan" });
  mode(f.pi);
  const ctx = fakeCtx();
  await f.emit("session_start", { reason: "startup" }, ctx);
  assert.deepEqual(f.pi.tools, ["read", "bash"]);
  await f.commands.mode.handler("stop pr", ctx);
  assert.deepEqual(f.pi.tools.sort(), ["bash", "edit", "read", "write"]);
  await f.commands.mode.handler("rigor fast", ctx);
  assert.deepEqual(f.pi.tools.sort(), ["bash", "edit", "read", "write"], "unchanged when the stop does not change");
});

test("a session saved before the rename (entry types pi-env-mode, pi-env-roles) resumes with its mode and role map", async () => {
  delete process.env.PITCREW_MODE;
  delete process.env.PITCREW_ROLES;
  const branch = [
    { type: "custom", customType: "pi-env-mode", data: { stop: "merge", rigor: "fast" } },
    { type: "custom", customType: "pi-env-roles", data: { profile: "local*", map: Object.fromEntries(["lead", "worker", "scout", "reviewer"].map((r) => [r, { model: r === "scout" ? "x/y" : "a/b", thinking: r === "scout" ? "high" : "low" }])) } },
  ];
  const m = withFlags(fakePi({ pitcrew: { tracking: "local" } }), {});
  mode(m.pi);
  await m.emit("session_start", { reason: "resume" }, fakeCtx({ branch }));
  const own = JSON.parse(process.env.PITCREW_MODE);
  assert.deepEqual([own.stop, own.rigor], ["merge", "fast"]);
  const r = withFlags(fakePi({ pitcrew: { profile: "local" } }), {});
  roles(r.pi);
  await r.emit("session_start", { reason: "resume" }, { ...fakeCtx({ branch }), modelRegistry: { find: () => ({}), getAvailable: () => [] }, model: undefined });
  const map = JSON.parse(process.env.PITCREW_ROLES);
  assert.deepEqual(map.map.scout, { model: "x/y", thinking: "high" });
});
