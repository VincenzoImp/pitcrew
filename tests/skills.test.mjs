import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

// Skills: loaded by pi's own loader (so a frontmatter pi cannot parse fails here, not silently at
// start-up), the catalogue rules (docs/skills.md), and the budget of the always-loaded context.
// No line cap: a skill is as long as its job needs.

const root = new URL("..", import.meta.url);
const skillsDir = new URL("skills/", root);
const folders = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const loaded = loadSkillsFromDir({ dir: fileURLToPath(skillsDir), source: "package" });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)],
  );

test("pi loads every skill folder, without warnings, under the folder's name", () => {
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(loaded.skills.map((skill) => skill.name).sort(), [...folders].sort());
  for (const skill of loaded.skills) {
    assert.equal(skill.filePath, fileURLToPath(new URL(`${skill.name}/SKILL.md`, skillsDir)));
  }
});

test("model-picked descriptions stay short", () => {
  for (const skill of loaded.skills.filter((s) => !s.disableModelInvocation)) {
    // Always in context: about 60 tokens each.
    assert.ok(skill.description.length <= 240, `${skill.name}: description has ${skill.description.length} characters`);
  }
});

test("skills name roles, never a model, vendor or effort level", () => {
  for (const file of walk(skillsDir)) {
    const text = readFileSync(file, "utf8");
    const model = text.match(/\b(claude|anthropic|openai|gpt-?\d|codex|gemini|qwen|gemma|llama|mistral|deepseek|opus|sonnet|haiku)\b/i);
    assert.equal(model?.[0], undefined, `${file.pathname} names "${model?.[0]}"`);
    const effort = text.match(/\b(thinking|effort)\b[^.\n]{0,20}\b(low|medium|high|xhigh)\b/i);
    assert.equal(effort?.[0], undefined, `${file.pathname} sets "${effort?.[0]}"`);
  }
});

test("every file a skill links to exists", () => {
  for (const file of walk(skillsDir).filter((url) => url.pathname.endsWith(".md"))) {
    const text = readFileSync(file, "utf8");
    const links = [...text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)].map((m) => m[1]).filter((target) => !/^[a-z]+:/.test(target));
    for (const target of links) {
      assert.ok(existsSync(new URL(target, file)), `${file.pathname}: link to ${target} is broken`);
    }
  }
});

test("skills carry no provenance text; outside text is recorded in THIRD_PARTY_NOTICES.md", () => {
  const notices = readFileSync(new URL("THIRD_PARTY_NOTICES.md", root), "utf8");
  for (const file of walk(skillsDir)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^#+ Sources\b|\b(Adapted|Ported) from\b|\b[\w-]+\/[\w-]+@[0-9a-f]{7}\b/m, `${file.pathname} has a credit line`);
    // Apache-2.0 §4(b): a modified file says so; the notice file must cover it.
    if (/Modified in \d{4} from /.test(text)) assert.match(notices, new RegExp(file.pathname.split("/skills/")[1].replace(/[.]/g, "\\.")));
  }
});

test("the global rules name every model-picked skill, and only those (#90)", () => {
  const rules = readFileSync(new URL("AGENTS.global.md", root), "utf8");
  const section = rules.slice(rules.indexOf("## Skills"), rules.indexOf("\n## ", rules.indexOf("## Skills") + 1));
  const named = [...section.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).sort();
  const picked = loaded.skills.filter((s) => !s.disableModelInvocation).map((s) => s.name).sort();
  assert.deepEqual(named, picked);
});

test("always-loaded context: measured and reported, not enforced", (t) => {
  // Global rules + every model-picked description. Target about 1,500 tokens (6,000 characters);
  // the owner's decision of 2026-11-12: a target to report, never a reason to block a skill.
  // The hard limit is per description (240 characters, above).
  const rules = readFileSync(new URL("AGENTS.global.md", root), "utf8").length;
  const descriptions = loaded.skills.filter((s) => !s.disableModelInvocation).reduce((sum, s) => sum + s.description.length, 0);
  const total = rules + descriptions;
  t.diagnostic(`standing cost: rules ${rules} + descriptions ${descriptions} = ${total} characters, about ${Math.round(total / 4)} tokens (target 6,000 characters)`);
  assert.ok(total > 0);
});

test("browser-check runs the pinned playwright-cli", () => {
  // The skill's cheat sheet follows this version's --help; an upgrade needs a new coverage pass.
  const pinned = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).dependencies["@playwright/cli"];
  const dir = mkdtempSync(join(tmpdir(), "pitcrew-browser-"));
  try {
    const script = fileURLToPath(new URL("browser-check/scripts/browser", skillsDir));
    const version = execFileSync(script, ["--version"], { encoding: "utf8", env: { ...process.env, PITCREW_BROWSER_DIR: dir } }).trim();
    assert.equal(version, pinned);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
