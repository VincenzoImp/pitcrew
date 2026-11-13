# Session mode

Two dials say how a session works. Each session has its own; other sessions do not change.

| Dial | Values | Meaning |
| --- | --- | --- |
| `stop` | `plan`, `local`, `pr`, `merge`, `milestone` | how far the agent goes alone: plan only (the `edit` and `write` tools are off; bash still runs, so this is not a sandbox), local commits, a ready PR, merge and clean up, a whole milestone (merged issues, then the milestone closed and its release cut) |
| `rigor` | `fast`, `standard`, `strict` | which checks are on |

Defaults: `pr`, `standard`.

## Switches

`rigor` is a named set of switches. Each switch can also be set alone.

| Switch | Values | `fast` | `standard` | `strict` | Acts in |
| --- | --- | --- | --- | --- | --- |
| `issueRequired` | `off`, `on` | off | on | on | the guard: with tracking `github`, a PR must close an issue |
| `verify` | `off`, `remind`, `on` | on | on | on | the verify gate: `on` runs the repo's check when files changed; `remind` only reminds the model |
| `review` | `off`, `auto`, `on` | off | auto | on | a fresh reviewer: `auto` reviews only when the agent merges by itself (`stop` `merge` or `milestone`); at `stop pr` you review the PR. `on` and `off` force it. `pitcrew run` follows it in code; a session through the skills |
| `leanCode` | `off`, `warn`, `block` | off | warn | block | `pitcrew check` and `pitcrew run` |

Fixed per rigor, not a switch: automatic fix rounds after a failed check (`fast` 1, else 2), and at
`strict` a second reviewer on the `second` role.

Always on, not a switch: the care in a repo you do not own (the guard asks before objects, settings,
pushes and merges there, and pi does not load its `.pi` files; [delivery.md](delivery.md)), and the
guard's block of catastrophic commands.

**Interactive sessions are never sandboxed**: commands run as you, on this machine, with your
credentials in reach. Only `pitcrew run` puts workers in the sandbox (`pitcrew.runner.sandbox`,
[sandbox.md](sandbox.md)). `/mode` says so too.

## Tracking

Where work items live is a repo setting, `pitcrew.tracking`: `none` (no plan file, no GitHub objects),
`local` (plans as Markdown files in the work folder) or `github`. Unset, it is `github` when the repo
has a GitHub remote you can push to, else `local`. With `github`, which object holds a piece of work
(an issue, a milestone, a Project) is chosen per piece of work (skill `github`).

## How the model learns it

At the start of a session, and after each change, the mode reaches the model as one short message
in the conversation (a channel every model receives, [claude-access.md](claude-access.md)): the stop
point, the tracking, and what rigor means for this work (review already resolved for the stop point).

## Setting it

| Where | How | Scope |
| --- | --- | --- |
| Every repo | `"pitcrew": { "mode": { "rigor": "standard" } }` in `~/.pi/agent/settings.json` | default |
| One repo | the same key in `<repo>/.pi/settings.json`; `switches` goes inside `mode`; `tracking` beside it | that repo |
| At start | `pi --rigor fast --stop local` | that session |
| In a session | `/mode rigor fast`, `/mode stop merge`, `/mode review on` | that session |
| See it | `/mode` | |

Later rows win over earlier ones. `/mode rigor <name>` drops the session's own switch changes, so the
preset applies whole. The session's mode is saved with it and comes back on resume. `/new` and
`/handoff` open the next session with the same mode. Child sessions start from the parent's mode.

A key that the harness does not read (an old one, or a typo) does not stop the session: it names
the key once, with where it went.

Example for a hackathon repo, in `.pi/settings.json`:

```json
{ "pitcrew": { "profile": "local", "tracking": "none", "mode": { "stop": "local", "rigor": "fast" } } }
```

Code: `lib/mode.ts` (logic; other parts call `currentMode()`), `lib/settings.ts` (keys read),
`extensions/mode/index.ts`.
