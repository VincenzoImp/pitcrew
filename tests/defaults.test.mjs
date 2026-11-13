import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { render } from "../scripts/defaults.mjs";

test("docs/defaults.md matches the defaults in the code (regenerate: node scripts/defaults.mjs > docs/defaults.md)", () => {
  assert.equal(readFileSync(new URL("../docs/defaults.md", import.meta.url), "utf8"), render());
});
