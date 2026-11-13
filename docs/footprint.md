# Files and layers

## Layers

pi reads configuration from two places. The harness keeps its settings in the same two.

| Layer | Where | Holds |
| --- | --- | --- |
| Global | `~/.pi/agent/` | `settings.json` (its `packages` list names this package), `AGENTS.md`, `profiles/`, `agents/`, `skills/` |
| Global skills | `~/.agents/skills/` | skills for every repo |
| Repo | `AGENTS.md` at the root | rules for this repo, added to the global rules |
| Repo | `.pi/` | `settings.json`, `profiles/`, `skills/`, `prompts/` for this repo |
| Repo skills | `.agents/skills/` | skills for this repo, added to the global skills |

Repo rules and skills add to the global ones. Repo settings replace global settings of the same key.
Harness settings are the `pitcrew` key in either `settings.json`. pi loads the repo layer only for
repos you trust. In a repo you do not own, `pitcrew run` always ignores its `.pi/settings.json` and
`.pi/profiles`; the verify gate does not run its verify command, and the roles do not read its
`.pi/profiles`, unless you trusted the repo with `/trust`.

## Working files

The harness writes its own working files outside the repo, in the **work folder** of the repo
(`<agent dir>` is `PI_CODING_AGENT_DIR`, else `~/.pi/agent`):

```
<agent dir>/pitcrew/projects/<repo-name>-<hash>/
  plans/                local plans (tracking local)
  handoffs/             /handoff files
  reports/              skill reports (security-audit runs, web-research notes)
  runs/<session id>/    the session's run folder: its children (report, session file, ledger)
                        and the verify receipts its process tree shares
  runs/runner/          pitcrew run: one ledger per target, one folder per run, and runner.lock
```

Every worktree of a repo uses the same folder. Nothing there is committed by accident, and the
repo's own `docs/`, `.gitignore` and CI are never touched for the harness's sake.

To keep these files inside the repo, set `"pitcrew": { "workDir": ".pi/work" }` (a path relative to the
repo root, or an absolute path).

Other files of the harness, outside any repo:

| Path | Holds |
| --- | --- |
| `<agent dir>/pitcrew/quota.json` | the last quota readings of each subscription ([status.md](status.md)) |
| `~/.config/pitcrew/exa-key` | the Exa search key ([web.md](web.md)) |
| `/tmp/pitcrew/browser/<session>/` | the `browser-check` skill's browser sessions |
| `/tmp/pitcrew/web/` | pages saved by `web_fetch`, pruned after 7 days ([web.md](web.md)) |
| the box's token, state and cache folders | `pitcrew box` ([sandbox.md](sandbox.md)) |

Code: `lib/paths.ts`.
