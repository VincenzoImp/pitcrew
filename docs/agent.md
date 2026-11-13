# Agents

One tool, `agent`, starts and manages children: running instances of an agent
([glossary.md](glossary.md)). Code: `extensions/agent/`. Agent definitions:
`agents/*.md`.

## What a child is

- A separate `pi --mode rpc` process. It loads every pitcrew extension, so the guard, the roles and
  the verify gate run in it. It never gets `--no-extensions`.
- It is lean: it loads only its agent's skills (`--no-skills --skill <dir>`), gets a short `agent`
  tool description (only the agents it may start), and skips what nobody sees in a child: the
  footer, session names, `/stats`, `/handoff` (quota readings are still written).
  First requests are in [TESTS.md](TESTS.md) (Subagents). With `pitcrew.rules` on, a child gets the
  harness rules without the
  "Agents" and "Skills" sections. Your own `~/.pi/agent/AGENTS.md` loads in a child too: pi
  has no option that drops only the global file and keeps the project's.
- It starts with `--offline`: no model-catalog refresh or version check (the parent did them; logins and
  model requests are not affected).
- It starts with `--no-approve`: a repo's own `.pi` files (extensions, settings, MCP servers) never
  load in a child, even when the parent trusts the repo.
- Its model is a role: `--model role/<role>`. The parent's role map reaches it through
  `PITCREW_ROLES`, so the child answers on the same models as the parent session's profile.
- pi builds its system prompt as for any session; the agent's prompt is appended with
  `--append-system-prompt`. Nothing replaces pi's prompt (the Claude bridge would drop it).
- Its own session file lives in its folder of the run folder (`runs/<session id>/<id>/session/`). The child sees only its task, not the parent's
  conversation.

## Agents

| Agent | Role | Tools | Can start |
| --- | --- | --- | --- |
| `scout` | `scout` | read, grep, find, ls | — |
| `reviewer` | `reviewer` | read, grep, find, ls | — |
| `researcher` | `scout` | read, grep, find, ls, web_search, web_fetch | — |
| `worker` | `worker` | read, grep, find, ls, bash, edit, write | `scout` |

A `researcher` is a `scout` with the web tools, for the `web-research` skill's fan-out. Each child is
its own session, so each has its own cap of 60 searches (fixed, not a setting); the skill gives each researcher a budget.

Every child also gets `ask_parent`. A file in `~/.pi/agent/agents/<name>.md` adds an agent or
replaces one of the same name. Frontmatter: `name`, `description`, `tools`, `role` (default: the
name), `spawns`, `skills` (a list, or `none`; without it the child gets every skill).
A file never names a model or a thinking level; the profile decides. It sets no time limit either
(`maxMinutes` below is the one bound for every child).

| Agent | Skills |
| --- | --- |
| `worker` | `github`, `tdd`, `diagnosing-bugs` |
| `reviewer`, `scout`, `researcher` | none (a reviewer's task holds its checklist: the `code-review` skill writes it) |

## The tool

| Action | Does |
| --- | --- |
| `start {agent, task, role?}` | starts a child in the background. `agent` names the agent (`worker`, `scout`, ...); `role` runs it on another role's model (for example `second`) |
| `run {agent, task, schema?, role?}` | one-shot: starts a child, blocks, and returns the JSON its final message ends with, checked against `schema` (one repair turn if it does not parse or match). In a code mode script it resolves to `{id, status, data}` |
| `status {id?}` | one line per child, or one child's result |
| `wait {ids?, timeout?}` | blocks until the children end. Esc detaches: nothing is stopped |
| `steer {id, text}` | sends a message to a running child; a finished child is resumed with it |
| `reply {id, text}` | answers a child's `ask_parent` question |
| `stop {id}` | stops a child |
| `resume {id, text?}` | continues a finished child in its own session file |

The child works in the parent's directory and does not see the parent's conversation, so the task
says the goal, constraints, the files to read, what is ruled out, and what to report.

## Parallel workers

An agent that edits files (its tools include `edit` or `write`, like `worker`) and would run beside
another live one in the same repo gets its own worktree: `<repo>.wt/agent-<key>` on branch
`agent/<key>`, made from the parent's current commit (without its uncommitted changes). The child is
told to commit there; the result message names the branch. The parent merges or cherry-picks it;
at the end of the parent's next run the worktree and the branch are removed (`lib/tidy.ts`, with
proof: the parent's branch holds every commit). Unmerged work stays. The worktree cap
(`pitcrew.caps.worktrees`) holds: above it the second worker does not start, and the tool says why.

## Reports and delivery

- A child's final message is its report, in Markdown. Its first line is `Status: done`,
  `Status: partial` or `Status: blocked`. A child that forgets the line is reminded once.
- The whole text is saved as `report.md` in the run folder. The parent gets a header (id, agent,
  state, report status, tokens), the path, and the report up to 30,000 characters, cut at a line
  end with "Read <path> from line N" for the rest. No JSON, nothing parsed out of the body.
- When a child ends, its result comes to the parent as one message. When several children of one
  session run, only the last one to end starts a new turn, so a fan-out costs one turn. A stopped
  child never starts a turn. A `wait`, a `run`, or `status <id>` returns the result as
  the tool result instead.
- Exactly once: a result counts as delivered when the session file holds it (the message, or a tool
  result that names it), or when this process already sent it. A parent restart therefore neither
  repeats a delivered result nor loses one that was still queued. Results that arrive while the
  session is not the current one are added when it opens again, without starting a turn.
- An `interrupted` child (its parent quit) is shown to the owner, not sent to the model; resume it
  by id.

## The /agents panel

`/agents` opens an overlay with every child of the session (in a terminal; elsewhere it prints the
list). The footer shows `agents N▶` while children run (`M?` when M of them ask a question).

| View | Keys |
| --- | --- |
| List: id, agent, state, model, tokens, last action (or the open question) | ↑↓ select · Enter open · Esc close |
| Child: its live transcript (messages, tool calls, result heads, your messages) | type and Enter: steer a running child, answer a child that asks, resume a finished one · Ctrl+X twice: stop · PgUp/PgDn scroll · Esc back |

The panel always has the same height (85 % of the terminal), so it does not move while a
transcript grows. Closing the panel stops nothing. A steer reaches the child after its current step. The transcript
keeps the last 500 lines in memory; a child from an earlier process shows its report instead.

## Questions

| From a child | Top session in a terminal | No terminal (RPC, print mode) |
| --- | --- | --- |
| `ask_parent` | a notice names the child and the question; `/agents` opens on that child, type the answer. Ctrl+T, or no answer in half of `askTimeoutSeconds`, hands it to the parent model | the parent model gets it and answers with `agent reply` |
| guard confirm (for example `sudo`) | a confirm dialog `[child id] guard: …` | the child's guard blocks the call (strict mode) |

While a child's question waits for the owner, pi reports `blocked` (OSC 7501: terminals and agent
dashboards show it; `pitcrew.notify: false` turns this off). Guard questions and `ask_user` are pi's
own dialogs, so pi reports them as `blocked` by itself. A child of a child passes both up to the top the same way. The panel never opens by itself: it would
take the keys the owner is typing.

`ask_user` (top session only) asks the owner one question with 2-5 options, the recommended one
first, through pi's select dialog, plus a free-text answer. With no UI it tells the model to decide
on stated assumptions.

## Lifecycle

- `/reload`: children keep running. They are kept in a process-wide registry
  (`globalThis[Symbol.for("pitcrew.agent")]`); the reloaded extension takes them over.
- `/new`, `/resume`, `/fork`: children keep running and report to the session that started them
  when it is the current session again.
- Quit: live children are stopped and marked `interrupted`. `agent resume <id>` continues one.

## Limits

Limits are settings with defaults. Their only purpose is to keep one fan-out from starting too many
processes at once. Set them in `pitcrew.agent` (global or repo `settings.json`), or for one session
with `/agents limits running 3` (children of the session inherit the change). There is no quota
check and no time limit by default.

| Setting (`pitcrew.agent`) | Default | Meaning |
| --- | --- | --- |
| `maxRunning` | 6 | children running at once at each depth of the tree; more wait for a slot. 0: no limit |
| `askTimeoutSeconds` | 600 | how long a child's question waits for the owner; then the parent model answers it |
| `maxMinutes` | 0 | wall clock of one child, in minutes. At the limit the child is asked once to write its report; 2 minutes later it is stopped, and its report, if any, is kept. 0: no limit |

- Each depth has its own pool of slots. A worker that holds a depth-1 slot waits only for a depth-2
  slot, and depth-2 children start nothing, so nested children cannot deadlock.
- No time limit by default: we cannot estimate how long real work takes, and a default would kill
  good work; an agent may work for hours, with compaction. An unattended run that wants a bound on
  a stuck child sets `maxMinutes`. An agent file with a `timeout` key is an error that names it.
- The tool description tells the model these limits and when to delegate: `scout` agents for broad
  reading, a `reviewer` before work is called done, a `worker` for a bounded change. The global rules
  (`AGENTS.global.md`) carry the same lines.

## When the quota runs out

The harness does not watch the Claude or Codex windows to stop work early; the footer only shows
them. When a provider refuses a request because a 5 h or weekly window is used up:

- The lead's turn ends with the provider's error (for Claude: `Claude quota exceeded — rate limit
  (five_hour) — resets …`). pi does not retry it. The session file keeps everything up to there.
- A child ends as `failed` with the same error and the line "Provider quota used up: nothing is
  lost. After the reset, resume it: agent resume <id>, or /agents resume for all". Its session, `state.json` and
  any report stay in its run folder.
- To go on after the reset: `pi --continue` (or `/resume`) reopens the session; ask the lead to go
  on, and `/agents resume` resumes every child of the session that a quota refusal stopped (one
  child: `agent resume <id>`). The child continues
  in its own session file.

Other sessions and children on another provider go on. `pitcrew run` stops the same way
([runner.md](runner.md)).

## Files

```
<work folder>/runs/<parent session id>/
  slots/                 running slots of the session tree
  verify-receipts.jsonl  verify results shared by the tree
  <id>/                  one child
    task.md  role.md  loadout.json  state.json  report.md  events.log
    session/             the child's pi session
```

`<work folder>` is outside the repo ([footprint.md](footprint.md)).
