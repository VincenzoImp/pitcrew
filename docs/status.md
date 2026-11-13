# Footer and stats

Code: `extensions/status/`. One extension resource: turn it off with `pi config`.

## Footer

```
~/code/app (main) • app: Fix the login bug   (claude-bridge) role/lead → opus-5-5 • high
ctx 12% 120k/1M · CH 97% · ↑1.2M ↓48k · ≈$3.41     5h 38% ↻4h35 1.3× · 7d 31% ↻4d · guard · verify ✓
agents 1▶  pr · standard  profile:claude-bridge
```

| Segment | Meaning |
| --- | --- |
| `role/lead → opus-5-5 • high` | selected model → model that answered the last request, thinking level. Provider in `( )` when there is room. A local model picked directly (not behind a role) shows `• local` |
| `ctx 12% 120k/1M` | context use; yellow from 35 %, red from 60 % (hand off before quality drops). Before the first response: `ctx ≥21k init`, a lower bound ((system prompt + active tool schemas) chars / 4; pi-claude-bridge adds its own prompt on top) |
| `CH 97%` | cache-hit rate of the last request: reads / (input + reads + writes). Red below 50 % from the second request |
| `↑ ↓` | session tokens in (input + cache) and out, all entries (as pi's own footer) |
| `≈$` / `$` | API-equivalent cost: bridge tokens × the `anthropic/<model>` price; other providers use pi's cost. `≈$` on a flat plan, `$` on API keys |
| `5h 38% ↻4h35 1.3×` | Claude plan window: use, time to reset, pace (used % / elapsed %; 1.0× = on pace; hidden in the first 5 % of the window, where one request reads as a huge rate). <50 % normal, 50–79 % yellow, ≥80 % red |
| `7d 31% ↻4d` | Claude weekly window |
| `LIMIT ↻…`, `EXTRA USAGE` | red: the plan rejected requests; overage is serving them |
| `cx 5h 0% · wk 100% · credits` | Codex windows; `credits` (red) when the plan limit is reached and calls spend credits |
| `· 42m ago` | the quota snapshot is older than 15 min (Claude sends it once per query) |
| line 3 | statuses of other extensions: `agents N▶` (`M?` for open questions) while children run, the session mode (`stop · rigor`, `*` when a switch differs from the preset) and the active profile (`profile:codex`, `codex*` after `/role`), in the order of their status keys `pitcrew.agents`, `pitcrew.mode`, `pitcrew.profile`. `/profile` and `/mode` show the details |
| `guard …` | text of the `pitcrew.guard` status. Missing status = `guard off` (yellow). Text with `off` = red |
| `gate …` | text of the `pitcrew.gate` status: `●` yellow, `✓` green, `↻` yellow, none = no change |

Narrow terminals drop, in order: provider, pace, 7 d reset, tokens; then the right part of line 2
moves to its own line.

- One footer. pi's own footer shows `0.0%/0` context for a role (a virtual model has no window of its
  own), so it is not offered; `pi config` can still turn the whole status extension off.
- Status keys: other extensions call `ctx.ui.setStatus("pitcrew.guard" | "pitcrew.gate", text)`. The
  footer shows the text as given (ANSI colours are kept) and leaves these keys out of line 3.

## Quota file

Every pi process (also headless children) writes the latest plan snapshot to
`<agent dir>/pitcrew/quota.json` (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`). Writes are atomic (temp
file + rename); an older snapshot never replaces a newer one.

```json
{ "claude": { "provider": "claude-bridge", "status": "allowed", "limitReached": false,
    "windows": { "5h": { "used": 38, "resetsAt": 1794408600, "minutes": 300 },
                 "7d": { "used": 31, "resetsAt": 1794819600, "minutes": 10080 } },
    "resetsAt": 1794408600, "claim": "five_hour", "overage": { "status": "rejected" },
    "observedAt": 1794392046955 },
  "codex": { "provider": "openai-codex", "status": "rejected", "limitReached": true, "plan": "plus",
    "windows": { "5h": { "used": 0, ... }, "7d": { "used": 100, ... } },
    "credits": { "has": true, "unlimited": false, "balance": "7853.79" }, "observedAt": 1794390392215 } }
```

Sources: Claude `anthropic-ratelimit-unified-*` headers on `after_provider_response` (the bridge
rebuilds them from Claude Code's `rate_limit_event`); Codex `codex.rate_limits` on
`provider_stream_event` (WebSocket) or `x-codex-*` headers (SSE). No pull, no credential reads.
`used` is percent; `resetsAt` is Unix seconds. Unknown or broken input is ignored.

Notices (once per process): Codex windows at 80 %, and Codex calls that spend credits; Claude
windows at 80 % and a reached plan limit when Claude comes through a provider other than the bridge
(the bridge already warns about Claude limits).

The readings only show; nothing stops work on them. A provider's own
refusal is recognised by `isQuotaError(text)` in `quota.ts`, so the agent tool and the runner can say
how to resume ([agent.md](agent.md), "When the quota runs out").

## /stats

`/stats [today|7d|30d] [--by day|project|role|model|session] [--json]` (default `7d`, tables by day,
project and role). It reads every session file under the sessions folder (also nested headless runs
that keep sessions) and the session files of child agents and runner workers in the work folders. Columns: requests, tokens in (input + cache) and out, cache-hit rate,
API-equivalent `≈$`, and billed `$` (API-key providers only). The last lines show `quota.json` with
pace. Role = the last `role/*` selected before each response; other selections are `(direct)`.

Limits: sessions run with `--no-session` or a custom `--session-dir` are not seen. Summary usage
(compaction, branch summary) has no model, so bridge summaries count tokens but no cost.

## Automatic session names

At the first `agent_settled`, an unnamed session gets `<repo>: <first 6 words of the first prompt>`
(at most 60 characters). No model call. `/name` overrides it; an existing name is never changed.

## Session map

At the end of each run the status extension labels the entries that mark progress, so `/tree` (with
its labeled-only filter) shows a long session's milestones: `verify ✓ <command> @<tree>`, `PR #N
opened` and `PR #N merged` (a successful `gh pr create` or `gh pr merge` in bash), `agent <id> <status>`;
`/handoff` labels the last entry `handoff → <file>`. Labels cost no tokens: they are not sent to the
model. Code: `extensions/status/labels.ts`.
