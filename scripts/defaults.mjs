#!/usr/bin/env node
// Writes docs/defaults.md from the default values in the code. tests/defaults.test.mjs fails when
// the page and the code drift. Regenerate: node scripts/defaults.mjs > docs/defaults.md
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULTS as MODE, ENV_MODE, FIX_ROUNDS, PRESETS, RIGOR, SWITCHES, TRACKING, STOP } from "../lib/mode.ts";
import { KEYS } from "../lib/settings.ts";
import { contextSettings } from "../lib/context.ts";
import { readSettings as agentSettings } from "../lib/limits.ts";
import { webSettings } from "../extensions/web/index.ts";
import { DEFAULT_CAPS } from "../extensions/guard/delivery.ts";
import { runnerSettings } from "../lib/run-plan.ts";
import { DEFAULTS as BOX } from "../lib/box.ts";
import { settings as verifySettings } from "../extensions/verify-gate/index.ts";
import { DEFAULT_BOUNDS } from "../lib/lean.ts";
import { DEFAULT_ORDER } from "../lib/profile.ts";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const show = (v) => (v === "" ? "`\"\"`" : `\`${JSON.stringify(v).replace(/^"|"$/g, "")}\``);

// What each key means. A key in code without a line here is an error (the page must cover it).
const MEANING = {
  context: {
    compactAt: "percent of the context window at which the harness compacts; 0 = never",
  },
  agent: {
    maxRunning: "children running at once at each depth; 0 = no limit",
    askTimeoutSeconds: "how long a child's question waits for the owner; then the parent model answers it",
    maxMinutes: "wall clock of one child in minutes; at the limit it is asked to write its report, and stopped 2 min later; 0 = no limit",
  },
  web: {
    backends: "`web_search` backends, tried in this order",
    codexModel: "Codex model for the `codex` backend; unset: the `scout` role's model if it is a Codex model, else the first role on one",
  },
  caps: {
    worktrees: "worktrees of a repo (main checkout included) before a new one asks; 0 = off",
    diskGB: "GB of extra worktrees plus the work folder before a new worktree asks; 0 = off",
  },
  runner: {
    maxHours: "wall clock of one run (`--max-hours`); 0 = no limit",
    maxIssues: "issues one run takes on (`--max-issues`); 0 = no limit",
    maxRestarts: "worker restarts per issue after a kill or a crash",
    workerTurns: "model turns of one worker (and of a reviewer); 0 = no limit",
    workerMinutes: "minutes of one worker; 0 = no limit",
    setup: "command run in a new worktree before the worker; empty: none",
    sandbox: "workers and the verify command in the sandbox (`--sandbox`): `foreign` repos only, `always`, `off`",
  },
  box: {
    net: "`proxy`: egress proxy with an allow list; `open`: no filter, real token in the box",
    allow: "hosts added to the default allow list",
    tokenFile: "file with the Claude token (read on the host only)",
  },
  verifyGate: {
    timeoutSeconds: "verify is killed after this time (counts as a failure)",
  },
  leanCode: {
    maxLines: "most lines changed (added + deleted) in code and tests",
    maxTestRatio: "most test lines added per code line added",
    minCodeLines: "the ratio is judged only from this many added code lines",
  },
};

function table(section, values, where, override = {}) {
  const meaning = MEANING[section];
  const missing = Object.keys(values).filter((k) => !meaning[k]);
  const extra = Object.keys(meaning).filter((k) => !(k in values) || !KEYS[section].includes(k));
  if (missing.length || extra.length) throw new Error(`defaults.mjs ${section}: no meaning for ${missing.join(", ")}; not in code or lib/settings.ts: ${extra.join(", ")}`);
  const rows = Object.entries(values).map(([k, v]) => `| \`${k}\` | ${override[k] ?? (v === undefined ? "unset" : show(v))} | ${meaning[k]} |`);
  return [`Set in: ${where}.`, "", "| Key | Default | Meaning |", "| --- | --- | --- |", ...rows].join("\n");
}

export function render() {
  const savedMode = process.env[ENV_MODE];
  delete process.env[ENV_MODE]; // the gate reads the session mode; outside a session: the default mode
  const gate = verifySettings({ getSettings: () => ({}) });
  if (savedMode !== undefined) process.env[ENV_MODE] = savedMode;
  const base = JSON.parse(read("config/settings.base.json"));
  const switches = Object.keys(SWITCHES).map((s) =>
    `| \`${s}\` | ${SWITCHES[s].map((v) => `\`${v}\``).join(", ")} | ${RIGOR.map((r) => PRESETS[r][s]).join(" | ")} |`);
  const box = Object.fromEntries(KEYS.box.map((k) => [k, BOX[k]]));
  const profiles = readdirSync(new URL("profiles/", root)).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const map = JSON.parse(read(`profiles/${f}`));
    const cell = (r) => (map[r] ? `\`${map[r].model}\` ${map[r].thinking}` : "none");
    return `| \`${f.slice(0, -5)}\` | ${["lead", "worker", "scout", "reviewer", "second"].map(cell).join(" | ")} |`;
  });
  const baseRows = Object.entries(base).filter(([k]) => k !== "pitcrew").map(([k, v]) => `| \`${k}\` | \`${JSON.stringify(v)}\` |`);
  return `# Defaults

Every default of the harness in one page. Generated from the code by \`scripts/defaults.mjs\`; do not
edit by hand. \`npm run check\` fails when this page and the code differ. Regenerate:

\`\`\`sh
node scripts/defaults.mjs > docs/defaults.md
\`\`\`

All harness settings are keys under \`pitcrew\` in \`~/.pi/agent/settings.json\` (every repo) or
\`<repo>/.pi/settings.json\` (one repo; pi reads it only for a trusted repo, \`pitcrew run\` only in your own
repos). The repo wins, unless a section says it reads only the global file. A key that is not on
this page is not read: a session and \`pitcrew run\` name it once (\`lib/settings.ts\`). Everything else
is a constant in the code.

## pi baseline: \`config/settings.base.json\`

\`pitcrew init\` adds its missing keys to \`~/.pi/agent/settings.json\` ([settings.md](settings.md));
nothing reads it at run time. Its \`pitcrew\` part repeats the code defaults below.

| Key | Value |
| --- | --- |
${baseRows.join("\n")}
| \`pitcrew\` | \`${JSON.stringify(base.pitcrew)}\` |

## \`profile\`

Default: none set. When no flag, parent, env, saved session or setting names one, the first of
${DEFAULT_ORDER.map((n) => `\`${n}\``).join(", ")} whose models are all available (\`lib/profile.ts\`).
\`pitcrew init\` writes the one it finds. Example profiles in \`profiles/\` ([roles.md](roles.md)):

| Profile | lead | worker | scout | reviewer | second |
| --- | --- | --- | --- | --- | --- |
${profiles.join("\n")}

## \`mode\`

Set in: \`lib/mode.ts\` ([mode.md](mode.md)).

| Dial | Values | Default |
| --- | --- | --- |
| \`stop\` | ${STOP.map((v) => `\`${v}\``).join(", ")} | \`${MODE.stop}\` |
| \`rigor\` | ${RIGOR.map((v) => `\`${v}\``).join(", ")} | \`${MODE.rigor}\` |

Switches (\`mode.switches\`), per rigor preset:

| Switch | Values | ${RIGOR.join(" | ")} |
| --- | --- | ${RIGOR.map(() => "---").join(" | ")} |
${switches.join("\n")}
| fix rounds (fixed) | | ${RIGOR.map((r) => FIX_ROUNDS[r]).join(" | ")} |

## \`tracking\`

Values: ${TRACKING.map((v) => `\`${v}\``).join(", ")}. Default: unset, so \`github\` when the repo has a GitHub remote you
can push to, else \`local\` (\`trackingFor\` in \`lib/mode.ts\`, [mode.md](mode.md)).

## \`rules\`

Values: \`on\`, \`off\`. Default: \`off\`. \`on\` adds this package's \`AGENTS.global.md\` to every session as
a prompt section; a child gets it without the "Agents" and "Skills" sections
(\`extensions/rules/index.ts\`, [install.md](install.md)).

## \`context\`

${table("context", contextSettings(undefined), "`lib/context.ts` ([context.md](context.md))")}

## \`agent\`

${table("agent", agentSettings(undefined), "`lib/limits.ts` ([agent.md](agent.md)); `/agents limits` changes `maxRunning` for a session")}

No time limit per agent file: \`maxMinutes\` is the one bound for every child.

## \`web\`

${table("web", webSettings({}), "`extensions/web/index.ts`, `extensions/web/search.ts` ([web.md](web.md))")}

## \`caps\`

${table("caps", DEFAULT_CAPS, "`extensions/guard/delivery.ts` ([delivery.md](delivery.md)); the guard and `pitcrew run`")}

## \`runner\`

${table("runner", runnerSettings(), "`lib/run-plan.ts` ([runner.md](runner.md)); global, then repo, then flags")}

## \`box\`

${table("box", box, "`lib/box.ts` ([sandbox.md](sandbox.md)); read from the global settings only")}

## \`verifyGate\`

${table("verifyGate", { timeoutSeconds: gate.timeoutSeconds }, "`extensions/verify-gate/index.ts` ([verify-gate.md](verify-gate.md)); on, remind or off is the `verify` switch")}

## \`leanCode\`

${table("leanCode", DEFAULT_BOUNDS, "`lib/lean.ts` ([delivery.md](delivery.md)); `pitcrew check` and the runner; the level is the `leanCode` switch")}

## \`workDir\`

Default: unset, so the work folder is \`<agent dir>/pitcrew/projects/<repo name>-<hash>\` (\`lib/paths.ts\`,
[footprint.md](footprint.md)). An absolute path, or a path relative to the repo root.

## \`notify\`

Default: \`true\`. pi reports its own state to the terminal (OSC 7501: working, blocked, done, error;
read by terminals and agent dashboards). pitcrew adds \`blocked\` while a child's question waits for
you, and the state of a \`pitcrew run\` at its start and end. \`false\` turns these two off;
\`pitcrew run\` reads it from the global file only (\`PI_PROGRAM_STATUS=0\` turns off pi's own too).
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(render());
