# Context

A long session loses quality before the window is full. The harness has three answers.

| Tool | When | What it does |
| --- | --- | --- |
| Footer colours | always | context use turns yellow at 35 % and red at 60 % ([status.md](status.md)) |
| `/handoff` | the normal way to go on | writes a durable file and starts a fresh session from it |
| Compaction | the safety net | replaces old messages with a summary; described here |

## /handoff

`/handoff [next goal]` is the normal way to go on when the context is large or the task changes.

1. It writes a handoff file: a state block built by code (latest requests, session mode, profile,
   branch, uncommitted changes, issue and PR links) and a handoff the model writes as a normal turn
   of this session (Context, Done, Decisions, State, Next goal, Facts to keep). Being a turn, it
   reads the conversation from the prompt cache instead of sending a second, uncached copy, and
   `Esc` cancels it (then no file is written). The turn stays in the old session.
2. The file goes to the work folder of the repo, outside the repo:
   `<work folder>/handoffs/<date>-<time>-<goal>.md` ([footprint.md](footprint.md)).
3. In the terminal it opens a new session with the handoff in the editor. Review it, edit it, submit.
   Without a terminal UI it writes the file and prints the path; start the next session with it.

The old session is not changed; `/resume` goes back to it.

## When compaction runs

When a run ends and the context is at or above **80 %** of the model's window, the harness
compacts. The threshold is a percentage, so the same value fits a 1M Claude model and a 98K local
model. pi's own compaction stays on as the last net when the window is nearly full, and
`/compact [focus]` runs it by hand at any time.

## What the summary keeps

1. **A state block built by code**: the owner's last three requests word for word (the last one is the
   current goal), the session mode, the role profile, the git branch, uncommitted changes, and the
   issue and pull-request links that were mentioned.
2. **A model summary** written by the `scout` role: goal, done, decisions, in progress, open questions,
   next steps, facts to keep. The summarizer sees each tool result up to 6,000 characters, cut in the
   middle (pi's default shows the first 2,000). A focus given to `/compact` is passed on.

If the role has no model or the summary fails, pi's default compaction runs.

## Settings

```json
{ "pitcrew": { "context": { "compactAt": 80 } } }
```

Fixed: the `scout` role writes the summary, and it sees 6,000 characters of each tool result.

`compactAt: 0` turns the harness trigger off. pi's `compaction.keepRecentTokens` (default 20,000)
still decides how many recent tokens stay word for word; raise it per model with
`compaction.modelOverrides` if a large model should keep more.

## Inside one long run

The harness trigger runs when a run ends: `ctx.compact()` in the middle of a run aborts the run
(tested), so it cannot move to the end of a turn. Inside one long run (a child agent, a `pitcrew run`
worker) pi's own check compacts between turns, with this harness's summary. It fires when the
context passes the routed model's window minus `compaction.reserveTokens` (default 16,384). The
context is the token use the last response reported plus an estimate of the newer tool results, so
it can fire one turn late after a large read.

Under a role, pi looks the setting up by the selected model, `role/<name>`, and compares it with the
window of the model the request is routed to; a `provider/modelId` key of that model is not used.
To make a 1M model compact earlier inside long runs, set it per role:

```json
{ "compaction": { "modelOverrides": { "role/worker": { "reserveTokens": 800000 }, "role/scout": { "reserveTokens": 800000 } } } }
```

With a 1M window that compacts above 200K. The value is in tokens, not a percentage: keep it below
the smallest window the role can get (a profile that puts the role on a 98K model would then compact
on every turn).

This works through the Claude bridge on a 1M model: the bridge reports token use on every response,
and pi's check fired at the set threshold in the lead and in a child (#143,
[TESTS.md](TESTS.md), Context). The report in
[pi-claude-bridge#215](https://github.com/elidickinson/pi-claude-bridge/issues/215) did not
reproduce with pi 1.5.2 and bridge 0.12.0.

## Limits

- Each compaction rewrites the prompt cache: after it, the next request writes the summary and the
  kept messages to the cache again. A threshold that compacts every few turns costs more than it saves.
- The summarizer sees 6,000 characters of each tool result. A value that only sat in the middle of a
  long result survives if the agent wrote it in its own reply; otherwise the agent reads it again.

Code: `lib/context.ts` (logic), `extensions/context/index.ts`, `extensions/handoff/index.ts`.
