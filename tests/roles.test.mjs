import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  checkMap,
  chooseActive,
  DEFAULT_ORDER,
  firstWorking,
  describe,
  loadProfiles,
  parseRoleArgs,
  profileCompletions,
  roleCompletions,
  snapshot,
  splitModel,
  withRole,
} from "../lib/profile.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shipped = loadProfiles([join(root, "profiles")]);
const spec = (model, thinking = "medium") => ({ model, thinking });
const full = (model) => ({ lead: spec(model), worker: spec(model), scout: spec(model), reviewer: spec(model) });

test("shipped profiles: neutral examples, each on one provider; the default order names only shipped ones", () => {
  assert.deepEqual(Object.keys(shipped).sort(), ["anthropic", "claude-bridge", "codex", "google", "local", "openai"]);
  const providers = (map) => new Set(Object.values(map).map((r) => splitModel(r.model)[0]));
  for (const [name, map] of Object.entries(shipped)) assert.equal(providers(map).size, 1, name);
  assert.deepEqual([...DEFAULT_ORDER].sort(), Object.keys(shipped).sort());
});

test("no profile named: the first working profile in DEFAULT_ORDER, else an error that says what to do", () => {
  const models = (name) => Object.values(shipped[name]).map((r) => r.model);
  assert.equal(chooseActive({ profiles: shipped, available: [...models("local"), ...models("codex")] }).profile, "codex");
  assert.equal(chooseActive({ profiles: shipped, available: models("local") }).source, "first working profile");
  assert.equal(firstWorking(shipped, [shipped.codex.lead.model]), undefined, "every role's model must be there, second too");
  assert.equal(firstWorking(shipped, ["openai-codex/other"]), undefined);
  assert.throws(() => chooseActive({ profiles: shipped, available: ["llama.cpp/other"] }), /available: llama\.cpp.*pitcrew init/);
  assert.throws(() => chooseActive({ profiles: shipped }), /no profile is set/);
  const base = JSON.parse(readFileSync(join(root, "config/settings.base.json"), "utf8"));
  assert.equal(base.pitcrew.profile, undefined);
});

test("model ids appear only in profiles/", () => {
  const ids = new Set(Object.values(shipped).flatMap((map) => Object.values(map).map((role) => splitModel(role.model)[1])));
  const walk = (dir) =>
    !existsSync(join(root, dir))
      ? []
      : readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
        );
  for (const file of ["extensions", "skills", "prompts"].flatMap(walk)) {
    const text = readFileSync(join(root, file), "utf8");
    for (const id of ids) assert.ok(!text.includes(id), `${file} names the model ${id}`);
  }
});

test("checkMap rejects bad input with a clear reason", () => {
  assert.throws(() => checkMap({ boss: spec("a/b") }, "p"), /unknown role "boss"/);
  assert.throws(() => checkMap({ lead: { model: "nomodel", thinking: "high" } }, "p"), /provider\/model-id/);
  assert.throws(() => checkMap({ lead: { model: "a/b", thinking: "huge" } }, "p"), /needs thinking/);
  assert.throws(() => checkMap({ lead: spec("a/b") }, "p"), /role "worker" is missing/);
  assert.deepEqual(checkMap({ lead: spec("a/b") }, "p", false), { lead: spec("a/b") });
});

test("a later directory replaces a profile of the same name", () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-"));
  mkdirSync(join(dir, "a"));
  mkdirSync(join(dir, "b"));
  writeFileSync(join(dir, "a", "x.json"), JSON.stringify(full("one/m")));
  writeFileSync(join(dir, "b", "x.json"), JSON.stringify(full("two/m")));
  writeFileSync(join(dir, "b", "y.json"), JSON.stringify(full("three/m")));
  const profiles = loadProfiles([join(dir, "a"), join(dir, "b"), join(dir, "missing")]);
  assert.equal(profiles.x.lead.model, "two/m");
  assert.equal(profiles.y.lead.model, "three/m");
});

test("chooseActive: order is flag, parent snapshot, env profile, session, setting, default", () => {
  const profiles = { custom: full("c/m"), codex: full("x/m"), local: full("l/m"), claude: full("m/m") };
  const parent = JSON.stringify({ profile: "claude*", map: full("p/m") });
  const session = { profile: "claude", map: full("s/m") };
  const all = { profiles, flag: "codex", envRoles: parent, envProfile: "local", session, setting: "claude" };
  assert.equal(chooseActive(all).map.lead.model, "x/m");
  assert.equal(chooseActive({ ...all, flag: undefined }).map.lead.model, "p/m");
  assert.equal(chooseActive({ ...all, flag: undefined }).profile, "claude*");
  assert.equal(chooseActive({ ...all, flag: undefined, envRoles: undefined }).map.lead.model, "l/m");
  assert.equal(chooseActive({ profiles, session, setting: "claude" }).map.lead.model, "s/m");
  assert.equal(chooseActive({ profiles, setting: "claude" }).map.lead.model, "m/m");
  assert.equal(chooseActive({ profiles, available: [] , flag: "custom" }).profile, "custom");
});

test("chooseActive: an unknown name is an error, not a fallback", () => {
  assert.throws(() => chooseActive({ profiles: { claude: full("c/m") }, flag: "nope" }), /no profile "nope"/);
  assert.throws(() => chooseActive({ profiles: {}, envRoles: "{\"map\":{\"lead\":1}}" }), /PITCREW_ROLES/);
});

test("chooseActive returns a copy: changing one session does not change the profile", () => {
  const profiles = { custom: full("c/m") };
  const first = chooseActive({ profiles, flag: "custom" });
  const changed = withRole(first, parseRoleArgs("lead l/m:low"));
  assert.equal(changed.map.lead.model, "l/m");
  assert.equal(profiles.custom.lead.model, "c/m");
  assert.equal(chooseActive({ profiles, flag: "custom" }).map.lead.model, "c/m");
  assert.equal(first.map.lead.model, "c/m");
});

test("parseRoleArgs", () => {
  assert.deepEqual(parseRoleArgs("lead a/b:high"), { role: "lead", model: "a/b", thinking: "high" });
  assert.deepEqual(parseRoleArgs("scout :low"), { role: "scout", model: undefined, thinking: "low" });
  assert.deepEqual(parseRoleArgs("worker ollama/qwen3:30b"), { role: "worker", model: "ollama/qwen3:30b", thinking: undefined });
  assert.deepEqual(parseRoleArgs(" second  a/b:30b:max "), { role: "second", model: "a/b:30b", thinking: "max" });
  assert.throws(() => parseRoleArgs("boss a/b"), /unknown role/);
  assert.throws(() => parseRoleArgs("lead"), /usage/);
  assert.throws(() => parseRoleArgs("lead nomodel"), /provider\/model-id/);
  assert.throws(() => parseRoleArgs("lead a/b extra"), /usage/);
});

test("withRole keeps what was not given, marks the profile as changed", () => {
  const active = chooseActive({ profiles: { custom: { ...full("c/m"), lead: spec("c/m", "high") } }, flag: "custom" });
  const effort = withRole(active, parseRoleArgs("lead :low"));
  assert.deepEqual(effort.map.lead, spec("c/m", "low"));
  assert.equal(effort.profile, "custom*");
  const model = withRole(effort, parseRoleArgs("lead l/q"));
  assert.deepEqual(model.map.lead, spec("l/q", "low"));
  assert.equal(model.profile, "custom*");
  assert.throws(() => withRole(active, parseRoleArgs("second :high")), /has no model yet/);
  assert.deepEqual(withRole(active, parseRoleArgs("second x/y")).map.second, spec("x/y", "medium"));
});

test("snapshot round-trips through the environment format", () => {
  const active = withRole(chooseActive({ profiles: { custom: full("c/m") }, flag: "custom" }), parseRoleArgs("scout s/m:off"));
  const child = chooseActive({ profiles: {}, envRoles: JSON.stringify(snapshot(active)) });
  assert.deepEqual(child.map, active.map);
  assert.equal(child.profile, "custom*");
  assert.match(describe(child), /scout +s\/m {2}off/);
});

test("roleCompletions: roles, then models, then levels; each value replaces the whole argument", () => {
  const models = ["llama.cpp/gemma-4", "llama.cpp/qwen3", "x/big"];
  const values = (text) => roleCompletions(text, models, { lead: spec("x/big", "high") })?.map((item) => item.value);
  assert.deepEqual(values(""), ["lead ", "worker ", "scout ", "reviewer ", "second "]);
  assert.deepEqual(values("re"), ["reviewer "]);
  assert.equal(roleCompletions("le", models, { lead: spec("x/big", "high") })[0].description, "x/big  high");
  assert.deepEqual(values("lead "), ["lead llama.cpp/gemma-4", "lead llama.cpp/qwen3", "lead x/big"]);
  assert.deepEqual(values("lead QWEN"), ["lead llama.cpp/qwen3"]);
  assert.deepEqual(values("lead llama.cpp/qwen3:h"), ["lead llama.cpp/qwen3:high"]);
  assert.deepEqual(values("scout :m"), ["scout :minimal", "scout :medium", "scout :max"]);
  assert.equal(values("boss "), undefined);
  assert.equal(values("lead nothing-like-this"), undefined);
  assert.equal(values("lead x/big extra"), undefined);
});

test("profileCompletions: names that contain the text", () => {
  assert.deepEqual(profileCompletions("", ["claude", "local"]).map((item) => item.value), ["claude", "local"]);
  assert.deepEqual(profileCompletions("LO", ["claude", "local"]).map((item) => item.value), ["local"]);
  assert.equal(profileCompletions("zz", ["claude"]), null);
});

test("only roles are in the model cycle: every enabledModels entry in the repo is role/*", () => {
  const files = ["config/settings.base.json", "box/settings.json", "tests/live/agent-dir.sh"];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const list = text.match(/"enabledModels":\s*(\[[^\]]*\])/);
    assert.ok(list, `${file}: no enabledModels`);
    assert.deepEqual(JSON.parse(list[1]), ["role/*"], file);
  }
});

test("a direct request (pi's summary, a /tree summary) goes to the scout's model at the scout's level", async () => {
  const { default: rolesExt } = await import("../extensions/roles/index.ts");
  const { fakeCtx, fakePi } = await import("./helpers.mjs");
  const saved = process.env.PITCREW_ROLES;
  delete process.env.PITCREW_ROLES;
  try {
    const f = fakePi({ pitcrew: { profile: "claude-bridge" } });
    const routers = {};
    Object.assign(f.pi, { registerFlag() {}, getFlag() {}, setThinkingLevel() {}, registerVirtualModel: (m) => { routers[m.id] = m.route; } });
    rolesExt(f.pi);
    const modelRegistry = { find: (provider, id) => ({ provider, id }), getAvailable: () => [] };
    await f.emit("session_start", { reason: "startup" }, { ...fakeCtx(), modelRegistry, model: undefined });
    const lead = routers.lead({ reason: "user", thinkingLevel: "high" }, { modelRegistry });
    const direct = routers.lead({ reason: "direct", thinkingLevel: "high" }, { modelRegistry });
    assert.match(lead.model.id, /opus/);
    assert.deepEqual([direct.model.id, direct.thinkingLevel], [shipped["claude-bridge"].scout.model.split("/")[1], shipped["claude-bridge"].scout.thinking]);
  } finally {
    if (saved !== undefined) process.env.PITCREW_ROLES = saved;
  }
});

test("parseModelList reads pi --list-models and leaves out the roles", async () => {
  const { parseModelList } = await import("../lib/pi.ts");
  const text = "provider       model              context  max-out  thinking  images\nllama.cpp      qwen3.8-27b        98.3K    98.3K    yes       yes\nrole           lead               0        0        yes       yes\n";
  assert.deepEqual(parseModelList(text), ["llama.cpp/qwen3.8-27b"]);
  assert.deepEqual(parseModelList(""), []);
});
