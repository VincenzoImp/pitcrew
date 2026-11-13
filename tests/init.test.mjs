import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeMissing, plan, registered } from "../lib/init.ts";

const base = { defaultProvider: "role", defaultModel: "lead", cacheWarming: "off", pitcrew: { mode: { stop: "pr", rigor: "standard" } } };
const spec = (model) => ({ model, thinking: "medium" });
const profiles = { codex: { lead: spec("openai-codex/m"), worker: spec("openai-codex/m"), scout: spec("openai-codex/m"), reviewer: spec("openai-codex/m") } };
const tools = { gh: true, ghAuth: true, docker: false, boxImage: false, exa: false, bridge: false, browser: false, claudeToken: false };

function facts(over = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "init-")));
  const pkgDir = join(dir, "checkout");
  mkdirSync(join(pkgDir, "bin"), { recursive: true });
  writeFileSync(join(pkgDir, "bin", "pitcrew"), "");
  return { node: "22.19.0", nodeMin: "22.19.0", pi: "1.5.2", piTested: "1.5.2", bridgeVersion: "0.12.0", pkgDir, pkgName: "@vincenzoimp/pitcrew",
    agentDir: join(dir, "agent"), settings: {}, base, models: ["openai-codex/m"], profiles, binDir: join(dir, "bin"), pathDirs: [join(dir, "bin")], tools, ...over };
}

test("a new user: install the checkout, add the baseline, the first working profile and the link; rules stay off unless asked", () => {
  const f = facts();
  const p = plan(f);
  assert.equal(p.ok, true);
  assert.equal(p.install, f.pkgDir);
  assert.deepEqual(p.settings.pitcrew, { mode: base.pitcrew.mode, profile: "codex" });
  assert.equal(p.settings.defaultModel, "lead");
  assert.deepEqual(p.link, { from: join(f.binDir, "pitcrew"), to: join(f.pkgDir, "bin", "pitcrew") });
  assert.match(p.lines.join("\n"), /option +Exa search key/);
  assert.equal(plan(f, { rules: true, profile: false }).settings.pitcrew.rules, "on");
  assert.equal(plan(f, { rules: true, profile: false }).settings.pitcrew.profile, undefined);
});

test("run from npx: the source is the npm package, and the link points into pi's npm folder", () => {
  const f = facts({ pkgDir: "/home/u/.npm/_npx/abc/node_modules/@vincenzoimp/pitcrew" });
  const p = plan(f);
  assert.equal(p.install, "npm:@vincenzoimp/pitcrew");
  assert.equal(p.link.to, join(f.agentDir, "npm", "node_modules", "@vincenzoimp/pitcrew", "bin", "pitcrew"));
});

test("an existing setup: nothing changes, no key of the user is overwritten", () => {
  const f = facts();
  mkdirSync(f.agentDir, { recursive: true });
  mkdirSync(f.binDir, { recursive: true });
  symlinkSync(join(f.pkgDir, "bin", "pitcrew"), join(f.binDir, "pitcrew"));
  const settings = { packages: ["../checkout"], defaultProvider: "role", defaultModel: "lead", cacheWarming: "idle", pitcrew: { profile: "codex", rules: "off", mode: { stop: "merge" } } };
  const p = plan({ ...f, settings, onPath: join(f.pkgDir, "bin", "pitcrew") });
  assert.equal(p.install, undefined);
  assert.equal(p.settings, undefined, p.lines.join("\n"));
  assert.equal(p.link, undefined);
  assert.equal(settings.cacheWarming, "idle");
});

test("registered: a relative path, an npm source with a version, a git URL", () => {
  const f = facts();
  mkdirSync(f.agentDir, { recursive: true });
  assert.equal(registered({ ...f, settings: { packages: ["../checkout"] } }).source, "../checkout");
  assert.equal(registered({ ...f, settings: { packages: [{ source: "npm:@vincenzoimp/pitcrew@0.1.0" }] } }).dir, join(f.agentDir, "npm", "node_modules", "@vincenzoimp/pitcrew"));
  assert.equal(registered({ ...f, settings: { packages: ["git:github.com/VincenzoImp/pitcrew@v0.1.0"] } }).dir, join(f.agentDir, "git", "github.com", "VincenzoImp", "pitcrew"));
  assert.equal(registered({ ...f, settings: { packages: ["npm:other", "../elsewhere"] } }), undefined);
});

test("missing pi or an old node: stop before any change; no working profile: say what to do", () => {
  assert.equal(plan(facts({ pi: undefined })).ok, false);
  assert.equal(plan(facts({ node: "20.11.0" })).ok, false);
  const none = plan(facts({ models: ["llama.cpp/x"] }));
  assert.match(none.lines.join("\n"), /missing +profile: .*providers: llama\.cpp/);
  const into = { a: 1, pitcrew: { mode: "x" } };
  assert.deepEqual(mergeMissing(into, { a: 2, b: 3, pitcrew: { mode: "y", rules: "on" } }), ["b", "pitcrew.rules"]);
  assert.deepEqual(into, { a: 1, b: 3, pitcrew: { mode: "x", rules: "on" } });
});
