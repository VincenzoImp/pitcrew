import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { rulesText } from "../extensions/rules/index.ts";

const file = readFileSync(new URL("../AGENTS.global.md", import.meta.url), "utf8");

test("the lead gets the whole rules file; a child gets it without the top-session sections", () => {
  assert.equal(rulesText(file, false), file.trim());
  const child = rulesText(file, true);
  assert.doesNotMatch(child, /^## (Agents|Skills)$/m);
  for (const kept of ["## Language and style", "## The smallest complete change", "## Done means checked", "## Safety", "## Models"]) {
    assert.ok(child.includes(kept), `child variant lacks ${kept}`);
  }
  assert.ok(child.length < file.length);
});
