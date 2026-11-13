import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectId } from "../lib/paths.ts";

// The work-planning skill finds the local plans folder with this script (docs/footprint.md).
const script = fileURLToPath(new URL("../skills/work-planning/scripts/plans-dir.mjs", import.meta.url));

test("plans-dir prints the harness plans folder, or the repo's workDir override", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "plans-dir-")));
  try {
    const agent = join(base, "agent");
    const repo = join(base, "repo");
    mkdirSync(join(repo, "sub"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    const run = () => execFileSync(process.execPath, [script], { cwd: join(repo, "sub"), env: { ...process.env, PI_CODING_AGENT_DIR: agent }, encoding: "utf8" }).trim();

    assert.equal(run(), join(agent, "pitcrew", "projects", projectId(repo), "plans"));

    mkdirSync(join(repo, ".pi"));
    writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ pitcrew: { workDir: ".pi/work" } }));
    assert.equal(run(), join(repo, ".pi", "work", "plans"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
