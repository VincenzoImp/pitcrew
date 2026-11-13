#!/usr/bin/env node
// Print the folder for local plans of the repo in the current directory, and create it.
// The harness keeps its working files outside the repo (docs/footprint.md); the setting
// pitcrew.workDir (repo .pi/settings.json, else the global settings) moves them.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir, workPath } from "../../../lib/paths.ts";
import { ownSettings } from "../../../lib/settings.ts";

const setting = (file) => {
  try {
    return ownSettings(JSON.parse(readFileSync(file, "utf8")))?.workDir;
  } catch {
    return undefined;
  }
};

let top = process.cwd();
try {
  top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {}
const override = setting(join(top, ".pi", "settings.json")) ?? setting(join(agentDir(), "settings.json"));
console.log(workPath(process.cwd(), "plans", override));
