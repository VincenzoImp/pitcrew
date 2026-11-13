// The commands of `pitcrew`; bin/pitcrew prepares module loading, then imports this. Docs: docs/commands.md.
import { join } from "node:path";
import { currentMode, SWITCHES } from "../lib/mode.ts";
import { agentDir } from "../lib/paths.ts";
import { branchChanges, DEFAULT_BOUNDS, leanReport, render, settingsBounds } from "../lib/lean.ts";
import { boxCommand, USAGE as BOX_USAGE } from "../lib/box.ts";
import { tidy } from "../lib/tidy.ts";

const USAGE = `usage:
  pitcrew init [--dry-run] [--yes] [--rules on|off]
      Set pitcrew up, or check an existing setup: Node and pi, the package in pi's settings, the
      baseline settings (only missing keys), a profile that works with your logins, the opt-in
      rules section, the pitcrew command in ~/.local/bin, and the optional parts. Safe to run again.
  pitcrew tidy [<PR number> | <branch> ...] [--all-merged] [--dry-run] [--force]
      Remove the worktree, the local branch and the remote branch of merged work, then print
      what was removed, what was already gone, and what is left and why.
      No target: the current branch. --all-merged: every branch with a merged PR.
      --force: also remove work that is not merged, and worktrees with uncommitted files.
  pitcrew check [--base <ref>] [--level off|warn|block] [--max-lines <n>] [--max-test-ratio <x>] [--json]
      Lean-code checks on the branch's changes against <ref> (default: origin's default branch):
      size, test-to-code ratio, shortcut markers without an upgrade trigger.
      Level: the session's leanCode switch (warn outside a session). Exit 1 only at block.
  pitcrew run <target> [--stop pr|merge|milestone|local] [--rigor fast|standard|strict] [--<switch> <value>]
             [--profile <name>] [--sandbox off|foreign|always] [--max-issues <n>] [--max-hours <h>] [--dry-run]
      Deliver the frontier of a target one issue at a time: worktree, fresh worker, verify, PR, CI,
      fresh reviewer, merge or stop by the stop dial, tidy. Run it again to continue.
      Target: a milestone title, a parent issue number, label:<name>, or issue numbers.
  pitcrew status [<target>] [--post]
      One digest of the target (default: the last run's): done, in progress, in review, blocked with
      reasons, waiting, next. --post: also as a status update on the repo's Project.
${BOX_USAGE}`;

const [command, ...args] = process.argv.slice(2);
const RUN_VALUED = ["--stop", "--rigor", "--profile", "--sandbox", "--max-issues", "--max-hours", ...Object.keys(SWITCHES).map((s) => `--${s}`)];
const VALUED = new Set(["--rules", "--base", "--level", "--max-lines", "--max-test-ratio", ...RUN_VALUED]);
const options = new Map();
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (VALUED.has(args[i])) options.set(args[i], args[++i]);
  else if (args[i].startsWith("--")) options.set(args[i], true);
  else rest.push(args[i]);
}
const allow = (...names) => {
  const unknown = [...options.keys()].filter((f) => !names.includes(f));
  if (unknown.length) fail(`unknown option ${unknown.join(", ")}`);
};

if (command === "init") {
  allow("--dry-run", "--yes", "--rules");
  const rules = options.get("--rules");
  if (rules !== undefined && rules !== "on" && rules !== "off") fail("--rules must be on or off");
  const { init } = await import("../lib/init.ts");
  process.exit(await init({ dryRun: options.has("--dry-run"), yes: options.has("--yes"), rules }));
} else if (command === "tidy") {
  allow("--all-merged", "--dry-run", "--force");
  const result = tidy({ cwd: process.cwd(), targets: rest, allMerged: options.has("--all-merged"), dryRun: options.has("--dry-run"), force: options.has("--force") });
  console.log(result.lines.join("\n"));
  process.exit(result.ok ? 0 : 1);
} else if (command === "check") {
  allow("--base", "--level", "--max-lines", "--max-test-ratio", "--json");
  const level = options.get("--level") ?? currentMode().switches.leanCode;
  if (!["off", "warn", "block"].includes(level)) fail("--level must be off, warn or block");
  const found = branchChanges(process.cwd(), options.get("--base"));
  if (!found) fail("cannot find the base: not a git repo, or pass --base <ref>");
  const bounds = { ...DEFAULT_BOUNDS, ...settingsBounds([join(agentDir(), "settings.json"), join(found.root, ".pi", "settings.json")]) };
  if (options.has("--max-lines")) bounds.maxLines = Number(options.get("--max-lines"));
  if (options.has("--max-test-ratio")) bounds.maxTestRatio = Number(options.get("--max-test-ratio"));
  const report = leanReport(found.changes, bounds);
  const out = render(report, level, found.base);
  console.log(options.has("--json") ? JSON.stringify({ level, base: found.base, bounds, ...report, exit: out.exit }) : out.lines.join("\n"));
  process.exit(out.exit);
} else if (command === "box") {
  try {
    process.exit(await boxCommand(args));
  } catch (error) {
    console.error(`pitcrew box: ${error.message}`);
    process.exit(2);
  }
} else if (command === "run" || command === "status") {
  const { runTarget, status } = await import("../lib/run.ts");
  if (command === "run") allow(...RUN_VALUED, "--dry-run");
  else allow("--post");
  const switches = Object.fromEntries(Object.keys(SWITCHES).filter((s) => options.has(`--${s}`)).map((s) => [s, options.get(`--${s}`)]));
  const opts = {
    cwd: process.cwd(), target: rest, profile: options.get("--profile"), dryRun: options.has("--dry-run"), post: options.has("--post"),
    mode: { stop: options.get("--stop"), rigor: options.get("--rigor"), switches },
    runner: { maxIssues: options.get("--max-issues"), maxHours: options.get("--max-hours"), sandbox: options.get("--sandbox") },
  };
  try {
    process.exit(command === "run" ? await runTarget(opts) : status(opts));
  } catch (error) {
    const gh = /gh auth login|gh: (command )?not found|ENOENT.*\bgh\b/.test(error.message);
    console.error(`pitcrew ${command}: ${gh ? "needs the GitHub CLI, logged in (gh auth login), in a repo with a GitHub remote" : error.message}`);
    process.exit(2);
  }
} else {
  fail(command && command !== "--help" && command !== "help" ? `unknown command ${command}` : undefined);
}

function fail(message) {
  if (message) console.error(`pitcrew: ${message}`);
  console.error(USAGE);
  process.exit(message ? 2 : 0);
}
