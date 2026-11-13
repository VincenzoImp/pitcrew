# Troubleshooting

The failure modes seen in real use and in the live tests ([TESTS.md](TESTS.md)), with what to do.
Start with `pitcrew init --dry-run`: it checks the setup and names what is missing.

## The session has no model

**`pitcrew roles: no profile is set and no shipped profile has all its models available …`**
Nothing names a profile, and none of the example profiles fits the models pi can use now. Log in
to a provider (`/login`), then run `pitcrew init`; or set `pitcrew.profile`; or write your own
profile ([roles.md](roles.md)). The message lists the providers pi has.

**`role/lead: <provider/model> is not in the model catalog`** The profile names a model pi cannot
reach: the provider is not logged in, the Claude bridge is not installed (`claude-bridge/…`
models), or the local server does not serve that model. Switch with `/profile <name>`, or change
one role with `/role lead` and pick from the list. pitcrew never falls back to another model.

**A local profile fails at once.** The `local` example names one llama.cpp model. Copy it to
`~/.pi/agent/profiles/local.json` and put the model your server has (`pi --list-models llama`).

## Claude through the bridge ignores an instruction

`pi-claude-bridge` runs Claude Code under pi, and Claude Code builds its own prompt. Tool
`promptGuidelines`, `promptSnippet` and a whole `systemPrompt` returned by an extension do not
reach the model; context files, skills, tool descriptions, prompt sections and messages do
([claude-access.md](claude-access.md)). pitcrew uses only the channels that arrive. If an
extension of yours relies on one that does not, move its text into the tool description.
`tests/live/fidelity.sh` shows which channels a setup passes.

## The provider refused for quota

When a 5-hour or weekly window is used up, the provider refuses and pi does not retry:

- The lead's turn ends with the provider's message (for Claude: `Claude quota exceeded — rate limit
  (five_hour) — resets …`). The session keeps everything up to there.
- A child ends as `failed` with "Provider quota used up: nothing is lost. After the reset, resume
  it: agent resume <id>, or /agents resume for all".
- `pitcrew run` stops with `stop: provider quota used up …; nothing is lost: run the same command
  again after the reset`. The issue is not blocked.

After the reset: `pi --continue` (or `/resume`), ask the lead to go on, `/agents resume` for the
children; for the runner, the same `pitcrew run` command. pitcrew has no quota stop of its own: the
footer only shows the windows ([status.md](status.md)).

## A local model runs out of context

`Context size has been exceeded` on a model with a small window (98K in the tests) comes from large
reads and from fan-out: three research children each filled their window and stopped with partial
reports. What helps:

- Read less at once: `web_fetch` with `find`, grep a saved page, read files in parts.
- Do small research yourself rather than start researchers; the `web-research` skill says when.
- Make pi compact earlier inside long runs, per role:
  `"compaction": { "modelOverrides": { "role/lead": { "reserveTokens": 40000 } } }` ([context.md](context.md)).
- Put the roles that read a lot (`scout`, `worker`) on a model with a larger window.

Small models at low thinking also often do not load a model-picked skill by themselves. Name the
skill in the prompt, or start it with `/skill:<name>`.

## The guard asks or blocks

The guard asks before risky commands (`sudo`, writes outside the project, `git push`, GitHub writes,
token prints) and blocks catastrophic ones (recursive delete of home or the project, `curl … | sh`,
`git push --force`). A block ends the turn and shows a `guard-blocked` message ([guard.md](guard.md)).

- Too many dialogs for this session: `/guard off` skips the asks; blocks stay.
- A PR, push or merge asks every time: the `stop` dial allows these steps only from `pr` (push, PR)
  or `merge` (merge); see `/mode` and [delivery.md](delivery.md). A merge also asks without
  `--match-head-commit <sha>` on a commit that passed verify.
- `gh pr create` asks `issue-required`: the body has no `Closes #<issue>` while tracking is
  `github`.
- With no terminal (`pi -p`, children of a headless run, `pitcrew run` workers) an ask is a block.
  Pre-approve rule ids for one run: `PI_GUARD_ALLOW=git-push,publish pi -p …`. `guard-bypass` cannot
  be pre-approved.
- In a repo that is not yours, pushes, PRs, issues and merges always ask.

## The verify gate only reminds

The gate runs the repo's check only in your own repo (admin permission) or one you trusted with
pi's `/trust`; elsewhere it reminds the model to run a check. Set `PI_VERIFY="<command>"` to run a
command in any repo. In your own repo, add a check it can find: a `verify` or `check` script in
`package.json`, a `verify` target in a Makefile or justfile, `scripts/verify`, or else a `test`
script or target ([verify-gate.md](verify-gate.md#which-command)).

## `pitcrew run` stops at the start

- `sandbox: image pitcrew-box:<version> missing`: the repo is not yours, so workers go to the
  sandbox. Run `pitcrew box build` (Docker), or `--sandbox off` if you accept workers on this host.
- `another pitcrew run works on this repo (pid …)`: one run per repo at a time.
- No frontier: every issue of the target is closed, blocked by an open issue, or labelled
  `needs-owner` ([runner.md](runner.md)).

## The agent wrote a plan or notes file into my repo

Without the rules section the model does not know that pitcrew keeps plans and notes in the work
folder, outside the repo ([footprint.md](footprint.md)), and it may add a file like `PLAN.md` and
then commit it. Turn the rules on (`pitcrew init --rules on`, or `"pitcrew": { "rules": "on" }`):
they say to keep bookkeeping out of the repo. Check `git status` before you let it commit.

## Model calls spend credits or money

The footer shows the cost (`≈$` on a plan, `$` on an API key) and, for Claude and Codex plans, the
windows. A red `credits` means the Codex plan limit is reached and calls now spend credits; a notice
says so once. Switch profile (`/profile`) or wait for the reset ([status.md](status.md)).

## Smaller things

- **`/compact` says "Nothing to compact"**: the session is smaller than what pi keeps word for word.
- **`pitcrew status` or `pitcrew run` says it needs the GitHub CLI**: both work on GitHub issues;
  install `gh`, run `gh auth login`, and run them in a repo with a GitHub remote.
- **`pitcrew: command not found`**: `~/.local/bin` is not on `PATH`; `pitcrew init` says so.
- **`alt+a` or `alt+enter` do nothing in tmux**: pi warns that `extended-keys` is off. Add
  `set -g extended-keys on` to `~/.tmux.conf` and restart tmux.
- **`browser-check` says `playwright-cli is missing`** or no browser: install the browser
  ([install.md](install.md), optional parts).
