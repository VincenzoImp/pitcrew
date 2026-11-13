# Settings

`config/settings.base.json` is the starting point for `~/.pi/agent/settings.json`. `pitcrew init`
adds the keys your file lacks and changes none you have ([install.md](install.md)); nothing reads it
at run time.

| Key | Value | Why |
| --- | --- | --- |
| `defaultProvider`, `defaultModel` | `role`, `lead` | a session starts on the `lead` role; the profile decides the model |
| `enabledModels` | `role/*` | Ctrl+P cycles roles; `/model` still lists every model of every provider |
| `cacheWarming` | `off` | pi's default is `idle`, which sends requests between runs and spends quota |
| `enableInstallTelemetry` | `false` | no install pings |
| `showCacheMissNotices` | `true` | a cache miss is a cost; show it |
| `pitcrew.profile` | not set | `pitcrew init` writes the first working profile ([roles.md](roles.md)) |
| `pitcrew.rules` | not set (off) | `on` adds the harness's global rules as a prompt section ([install.md](install.md)) |
| `pitcrew.mode` | `stop: pr`, `rigor: standard` | default session mode ([mode.md](mode.md)) |

Any provider that pi supports (subscription login, API key, local server) works: add its models to
a profile. Only profiles name models; a few parts recognise providers: the `codex` search backend
(`openai-codex`), and the quota and local badges of the footer.

Every `pitcrew` key and its default, generated from the code: [defaults.md](defaults.md).

## Code mode

Code mode is pi's `codemode` tool: the model writes a script that calls other tools, and only the
script's output comes back. It is off by default, the same for every model; turn it on as below.

| Scope | How |
| --- | --- |
| One run | `pi --tools +codemode` |
| One repo | `"defaultTools": ["+codemode"]` in `<repo>/.pi/settings.json` |
| Everywhere | the same key in `~/.pi/agent/settings.json` |

Why off: measured on 2026-11-12 ([TESTS.md](TESTS.md)). With the built-in tools only, code mode
adds 550 to 760 tokens to every request, and no model chose to use it for a multi-file task: one
`bash` call did the work. It should pay when a script can fan out many calls whose results are large
(children started from scripts, MCP servers with many tools).

Measured again on 2026-11-12 with the agent tool called from a script (#18): find-then-refute on a
3-line file (one scout, then two reviewers in parallel), local model, parent tokens only.

| Run | Parent requests | First request | Tokens sent | Output |
| --- | --- | --- | --- | --- |
| The model calls `agent run` itself | 3 | 4,814 | 15,767 | 1,034 |
| One code mode script does the same | 3 | 5,490 | 19,868 | 2,764 |

The script cost more: the fixed description (+680 tokens per request) and the script itself, and
the children's answers were small, so there was nothing to filter out. The default stays off. Turn
code mode on for work where a script fans out many children with large answers and returns a short
result (audits, deep research).
