import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");

test("every relative link and image in the README, the repo files and docs/ resolves, anchors too", () => {
  const files = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "UPSTREAM.md", "THIRD_PARTY_NOTICES.md",
    ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`), "docs/assets/README.md"];
  const broken = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"/g)) {
      const target = m[1] ?? m[2];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [path, anchor] = target.split("#");
      const full = normalize(join(root, dirname(file), path));
      if (!existsSync(full)) { broken.push(`${file}: ${target}`); continue; }
      if (anchor && full.endsWith(".md")) {
        const heads = [...readFileSync(full, "utf8").matchAll(/^#+ (.*)$/gm)].map((h) => slug(h[1]));
        if (!heads.includes(anchor)) broken.push(`${file}: ${target} (anchor)`);
      }
    }
  }
  assert.deepEqual(broken, []);
});
