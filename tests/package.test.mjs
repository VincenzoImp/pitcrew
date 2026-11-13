import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("every pi resource in package.json exists", () => {
  for (const kind of ["extensions", "skills", "prompts"]) {
    for (const path of pkg.pi[kind]) {
      assert.ok(existsSync(new URL(path, root)), `${kind}: ${path} is missing`);
    }
  }
});

test("the global rules file stays small and names no model", () => {
  const rules = readFileSync(new URL("AGENTS.global.md", root), "utf8");
  // About 4 characters per token: 4,200 characters is about 1,050 tokens, loaded in every session.
  // Raised from 3,600 for the skill lines (#90); the owner treats the standing total as a reported target.
  assert.ok(rules.length <= 4200, `AGENTS.global.md has ${rules.length} characters`);
  assert.doesNotMatch(rules, /claude-|gpt-|qwen|gemma|opus|sonnet|haiku/i);
});

test("the baseline settings name no profile (the first working one is the default) and a valid mode", async () => {
  const base = JSON.parse(readFileSync(new URL("config/settings.base.json", root), "utf8"));
  const { resolveMode } = await import("../lib/mode.ts");
  assert.equal(base.pitcrew.profile, undefined);
  assert.equal(resolveMode(base.pitcrew.mode).rigor, "standard");
  assert.equal(base.cacheWarming, "off");
  assert.equal(base.defaultTools, undefined); // code mode is off by default
});

test("extensions use only prompt channels that reach every model", () => {
  // docs/claude-access.md: these three do not pass the Claude bridge.
  const walk = (dir) =>
    readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`],
    );
  for (const file of walk("extensions/")) {
    const text = readFileSync(new URL(file, root), "utf8");
    assert.doesNotMatch(text, /promptGuidelines|promptSnippet|\bsystemPrompt\s*:/, file);
  }
});

test("lib/ is shared code: it imports nothing from extensions/", () => {
  for (const file of readdirSync(new URL("lib/", root))) {
    const text = readFileSync(new URL(`lib/${file}`, root), "utf8");
    assert.doesNotMatch(text, /from "\.\.\/extensions\//, `lib/${file}`);
  }
});

test("versions are pinned in one place: box/package.json; the dev dependency follows it", () => {
  const box = JSON.parse(readFileSync(new URL("box/package.json", root), "utf8")).dependencies;
  assert.equal(pkg.devDependencies["@earendil-works/pi-coding-agent"], box["@earendil-works/pi-coding-agent"]);
  assert.doesNotMatch(readFileSync(new URL("tests/live/agent-dir.sh", root), "utf8"), /pi-claude-bridge@\d/);
});

test("npm ships what pi and the CLI load; CI tests the lowest Node of engines", () => {
  const shipped = (path) => pkg.files.some((f) => `${path.replace(/^\.\//, "")}/`.startsWith(f));
  for (const kind of ["extensions", "skills"]) for (const path of pkg.pi[kind]) assert.ok(shipped(path), `${path} is not in files`);
  for (const path of ["bin/pitcrew", "bin/cli.mjs", "lib/init.ts", "profiles/local.json", "config/settings.base.json", "AGENTS.global.md", "box/Dockerfile", "agents/worker.md", "CHANGELOG.md"]) {
    assert.ok(shipped(path), `${path} is not in files`);
  }
  const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.ok(ci.includes(`"${pkg.engines.node.replace(">=", "")}"`), "the CI matrix has the engines minimum");
  assert.match(readFileSync(new URL("CHANGELOG.md", root), "utf8"), new RegExp(`^## \\[${pkg.version.replace(/\./g, "\\.")}\\]`, "m"));
});
