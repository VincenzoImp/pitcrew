# Defaults

Every default of the harness in one page. Generated from the code by `scripts/defaults.mjs`; do not
edit by hand. `npm run check` fails when this page and the code differ. Regenerate:

```sh
node scripts/defaults.mjs > docs/defaults.md
```

All harness settings are keys under `pitcrew` in `~/.pi/agent/settings.json` (every repo) or
`<repo>/.pi/settings.json` (one repo; pi reads it only for a trusted repo, `pitcrew run` only in your own
repos). The repo wins, unless a section says it reads only the global file. A key that is not on
this page is not read: a session and `pitcrew run` name it once (`lib/settings.ts`). Everything else
is a constant in the code.

## pi baseline: `config/settings.base.json`

`pitcrew init` adds its missing keys to `~/.pi/agent/settings.json` ([settings.md](settings.md));
nothing reads it at run time. Its `pitcrew` part repeats the code defaults below.

| Key | Value |
| --- | --- |
| `defaultProvider` | `"role"` |
| `defaultModel` | `"lead"` |
| `enabledModels` | `["role/*"]` |
| `cacheWarming` | `"off"` |
| `enableInstallTelemetry` | `false` |
| `showCacheMissNotices` | `true` |
| `pitcrew` | `{"mode":{"stop":"pr","rigor":"standard"}}` |

## `profile`

Default: none set. When no flag, parent, env, saved session or setting names one, the first of
`claude-bridge`, `codex`, `anthropic`, `openai`, `google`, `local` whose models are all available (`lib/profile.ts`).
`pitcrew init` writes the one it finds. Example profiles in `profiles/` ([roles.md](roles.md)):

| Profile | lead | worker | scout | reviewer | second |
| --- | --- | --- | --- | --- | --- |
| `anthropic` | `anthropic/claude-opus-5-5` high | `anthropic/claude-opus-5-5` medium | `anthropic/claude-sonnet-5-5` low | `anthropic/claude-opus-5-5` high | `anthropic/claude-sonnet-5-5` high |
| `claude-bridge` | `claude-bridge/claude-opus-5-5` high | `claude-bridge/claude-opus-5-5` medium | `claude-bridge/claude-sonnet-5-5` low | `claude-bridge/claude-opus-5-5` high | `claude-bridge/claude-sonnet-5-5` high |
| `codex` | `openai-codex/gpt-6.1-sol` high | `openai-codex/gpt-6.1-sol` medium | `openai-codex/gpt-6.1-sol` low | `openai-codex/gpt-6.1-sol` high | `openai-codex/gpt-6.1-terra` high |
| `google` | `google/gemini-pro-latest` high | `google/gemini-pro-latest` medium | `google/gemini-flash-latest` low | `google/gemini-pro-latest` high | `google/gemini-flash-latest` high |
| `local` | `llama.cpp/qwen3.8-27b` medium | `llama.cpp/qwen3.8-27b` medium | `llama.cpp/qwen3.8-27b` medium | `llama.cpp/qwen3.8-27b` medium | none |
| `openai` | `openai/gpt-6.1-sol` high | `openai/gpt-6.1-sol` medium | `openai/gpt-6.1-sol` low | `openai/gpt-6.1-sol` high | `openai/gpt-6.1-terra` high |

## `mode`

Set in: `lib/mode.ts` ([mode.md](mode.md)).

| Dial | Values | Default |
| --- | --- | --- |
| `stop` | `plan`, `local`, `pr`, `merge`, `milestone` | `pr` |
| `rigor` | `fast`, `standard`, `strict` | `standard` |

Switches (`mode.switches`), per rigor preset:

| Switch | Values | fast | standard | strict |
| --- | --- | --- | --- | --- |
| `issueRequired` | `off`, `on` | off | on | on |
| `verify` | `off`, `remind`, `on` | on | on | on |
| `review` | `off`, `auto`, `on` | off | auto | on |
| `leanCode` | `off`, `warn`, `block` | off | warn | block |
| fix rounds (fixed) | | 1 | 2 | 2 |

## `tracking`

Values: `none`, `local`, `github`. Default: unset, so `github` when the repo has a GitHub remote you
can push to, else `local` (`trackingFor` in `lib/mode.ts`, [mode.md](mode.md)).

## `rules`

Values: `on`, `off`. Default: `off`. `on` adds this package's `AGENTS.global.md` to every session as
a prompt section; a child gets it without the "Agents" and "Skills" sections
(`extensions/rules/index.ts`, [install.md](install.md)).

## `context`

Set in: `lib/context.ts` ([context.md](context.md)).

| Key | Default | Meaning |
| --- | --- | --- |
| `compactAt` | `80` | percent of the context window at which the harness compacts; 0 = never |

## `agent`

Set in: `lib/limits.ts` ([agent.md](agent.md)); `/agents limits` changes `maxRunning` for a session.

| Key | Default | Meaning |
| --- | --- | --- |
| `maxRunning` | `6` | children running at once at each depth; 0 = no limit |
| `askTimeoutSeconds` | `600` | how long a child's question waits for the owner; then the parent model answers it |
| `maxMinutes` | `0` | wall clock of one child in minutes; at the limit it is asked to write its report, and stopped 2 min later; 0 = no limit |

No time limit per agent file: `maxMinutes` is the one bound for every child.

## `web`

Set in: `extensions/web/index.ts`, `extensions/web/search.ts` ([web.md](web.md)).

| Key | Default | Meaning |
| --- | --- | --- |
| `backends` | `["exa","codex"]` | `web_search` backends, tried in this order |
| `codexModel` | unset | Codex model for the `codex` backend; unset: the `scout` role's model if it is a Codex model, else the first role on one |

## `caps`

Set in: `extensions/guard/delivery.ts` ([delivery.md](delivery.md)); the guard and `pitcrew run`.

| Key | Default | Meaning |
| --- | --- | --- |
| `worktrees` | `20` | worktrees of a repo (main checkout included) before a new one asks; 0 = off |
| `diskGB` | `20` | GB of extra worktrees plus the work folder before a new worktree asks; 0 = off |

## `runner`

Set in: `lib/run-plan.ts` ([runner.md](runner.md)); global, then repo, then flags.

| Key | Default | Meaning |
| --- | --- | --- |
| `maxHours` | `0` | wall clock of one run (`--max-hours`); 0 = no limit |
| `maxIssues` | `0` | issues one run takes on (`--max-issues`); 0 = no limit |
| `maxRestarts` | `2` | worker restarts per issue after a kill or a crash |
| `workerTurns` | `0` | model turns of one worker (and of a reviewer); 0 = no limit |
| `workerMinutes` | `0` | minutes of one worker; 0 = no limit |
| `setup` | `""` | command run in a new worktree before the worker; empty: none |
| `sandbox` | `foreign` | workers and the verify command in the sandbox (`--sandbox`): `foreign` repos only, `always`, `off` |

## `box`

Set in: `lib/box.ts` ([sandbox.md](sandbox.md)); read from the global settings only.

| Key | Default | Meaning |
| --- | --- | --- |
| `net` | `proxy` | `proxy`: egress proxy with an allow list; `open`: no filter, real token in the box |
| `allow` | `[]` | hosts added to the default allow list |
| `tokenFile` | `~/.config/pitcrew/claude-token` | file with the Claude token (read on the host only) |

## `verifyGate`

Set in: `extensions/verify-gate/index.ts` ([verify-gate.md](verify-gate.md)); on, remind or off is the `verify` switch.

| Key | Default | Meaning |
| --- | --- | --- |
| `timeoutSeconds` | `300` | verify is killed after this time (counts as a failure) |

## `leanCode`

Set in: `lib/lean.ts` ([delivery.md](delivery.md)); `pitcrew check` and the runner; the level is the `leanCode` switch.

| Key | Default | Meaning |
| --- | --- | --- |
| `maxLines` | `400` | most lines changed (added + deleted) in code and tests |
| `maxTestRatio` | `1.5` | most test lines added per code line added |
| `minCodeLines` | `30` | the ratio is judged only from this many added code lines |

## `workDir`

Default: unset, so the work folder is `<agent dir>/pitcrew/projects/<repo name>-<hash>` (`lib/paths.ts`,
[footprint.md](footprint.md)). An absolute path, or a path relative to the repo root.

## `notify`

Default: `true`. pi reports its own state to the terminal (OSC 7501: working, blocked, done, error;
read by terminals and agent dashboards). pitcrew adds `blocked` while a child's question waits for
you, and the state of a `pitcrew run` at its start and end. `false` turns these two off;
`pitcrew run` reads it from the global file only (`PI_PROGRAM_STATUS=0` turns off pi's own too).
