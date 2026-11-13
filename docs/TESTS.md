# Live tests

> Rows before 2026-11-13 record commands under the project's working name `pi-env` (`pi-env …`,
> `PI_ENV_*`, `piEnv`); they are `pitcrew …`, `PITCREW_*` and `pitcrew` now.

## How to read

This file records the live checks of pitcrew: checks run against real models, a real terminal and
real GitHub. Unit tests live in `tests/` and are named here only where they replace a live check.
All results were recorded on 2026-11-12, except #143 (2026-11-13). The `#NN` issue number gives the order: a higher number
is later (#122, #125, #137 came after #113; #140 is the pull request of #114). Two passes have no issue number; both ran after #103 and before #108:

- `acceptance`: the pass over live checks left open.
- `user pass`: every command and flag of the README once, as a user.

`#NN` in the Issue column and in the text is an issue or pull request of the development tracker
used before the first release, not of this repo: those numbers do not exist here. PR and issue numbers inside a result
(for example "PR #21", "issue #12") belong to the scratch repo.

**Areas.** Each area has the latest result on top. Checks use `| Check | Model | Result | Issue |`,
measurements use `| Measurement | Model | Value | Issue |`. Prose is only for findings and short
setup lines. Results that later changes made untrue are in [History](#history), marked
"(superseded: <why>, #NN)".

**Models.**

| Name | Meaning |
| --- | --- |
| lead | the `lead` role of the default profile (`custom`): Opus 5.5 at thinking `high` |
| Sonnet | the mid Claude model, Sonnet 5.5, through the Claude bridge |
| Haiku | the smallest Claude model, Haiku 5.5, through the Claude bridge, thinking `low` unless stated |
| local | the local model, qwen3.8-27b on llama.cpp; the `second` role in the `local` profile is gemma-4-26b-a4b |
| Codex small | the smallest Codex model in pi's catalog, thinking `low` |
| none | no model call (a CLI command or a unit test) |

"Haiku (history)" means: the owner does not use Haiku, and the row is kept only because it is the
only evidence for that check. Other Haiku results are in History. "not stated" means the source
did not say which model ran the check.

**Setup.**

- Test host: pi 1.5.2. The local model runs first, to save subscription quota.
- Scratch repo: a private test repo owned by the test user.
- `tests/live/agent-dir.sh`: makes a throwaway agent dir: `eval "$(tests/live/agent-dir.sh)"`.
  To pick a profile, `export PI_TEST_PROFILE=<name>` first. `PI_TEST_PROFILE=x eval "$(…)"` does not
  pass the variable: the command substitution runs before the assignment.
- `tests/live/drive.mjs`: the RPC driver. It sends prompts, answers dialogs as each setup line says,
  and waits for the turn that a `/skill:` prompt starts.
- `tests/live/eval.mjs`: the skill eval runner, one case per skill. `--load-only` stops at the first
  `read` of the skill file (loaded) or at the end of the first turn (not loaded).
- Other scripts: `tests/live/fidelity.sh` (prompt channels), `tests/live/box-escape.sh` (sandbox).

## Status summary

| Area | Last tested (issue) | Result | Open items |
| --- | --- | --- | --- |
| Install | #46 | pass | none |
| Roles and profiles | #122 (unit), user pass | pass | none |
| Session mode and delivery rules | #110 | pass | none |
| Guard | acceptance (last numbered: #52) | pass | 2 |
| Verify gate | #122 | pass | 1 (flaky `fail 1`) |
| Footer and stats | #112 | pass | 1 |
| Prompt and context cost | #115 | measured | none |
| Context, compaction and handoff | #143 | pass | 1 |
| Web | acceptance (last numbered: #63) | pass | 4 |
| Subagents | #111 | pass | 7 |
| Skills | #137 | pass; the 8 model-picked skills load on the lead; the changed skills pass their cases | 10 |
| Runner and tidy | #112 | pass | 3 |
| Sandbox | user pass (last numbered: #35) | pass | 1 |

## Not tested live

| # | Area | Item | Reason | Issue |
| --- | --- | --- | --- | --- |
| 1 | Guard | `rm -r .*`, `parallel … ::: /`, a function that deletes its argument, a git alias that runs a shell | unit tests only: a live run needs a model to attempt a destructive command | #52 |
| 2 | Guard | `wget … -O x.sh && sh x.sh` | the model refused to run downloaded content; unit tests cover the block. The `curl … -o && sh` form was blocked live (acceptance) | #52 |
| 3 | Verify gate | one `fail 1` in a full `npm run check` | flaky: it did not repeat in the next two runs, nor in `tests/lean.test.mjs` alone; not traced | #33 |
| 4 | Footer and stats | the Codex quota segment | #6 left the quota segments to the cut-over; #46 showed only the Claude windows | #6, #46 |
| 5 | Context | the compaction threshold at 80 % on a 1M model | cost | #10 |
| 6 | Web | redirects and DNS rebinding in `web_fetch` | unit tests with a local server cover them | #20 |
| 7 | Web | Exa out of credit (HTTP 402); Codex over its usage limit | unit tests cover both messages | #63 |
| 8 | Web | backend comparison on 20 questions | 8 questions were run, to keep Codex use small | #63 |
| 9 | Web | a `researcher` agent on the Codex search backend | not seen | #21 |
| 10 | Subagents | two sessions in one process (`/new` with a live child) | not tested | #13 |
| 11 | Subagents | the hand-over of a child question to the model after half the ask timeout (5 min) | not tested | #16 |
| 12 | Subagents | a grandchild's question | not tested | #16 |
| 13 | Subagents | the repair turn of `agent run` | unit test only | #18 |
| 14 | Subagents | the parent's own edits beside a worker (only worker beside worker gets a worktree) | not isolated by design (#111) | #111 |
| 15 | Subagents | a successful `agent resume` after a provider quota reset | the window had not reset; a unit test with a fake child covers it | #100 |
| 16 | Skills | work-planning: the granularity check of slices and the decision-map path | one slice only; the task was not foggy | #23 |
| 17 | Skills | codebase-design with `scout` agents | the `agent` tool was not built at the time | #24 |
| 18 | Skills | browser-check: opening the browser before forming a theory | the bug was visible in four lines of code | #26 |
| 19 | Skills | frontend-design: a first action in the empty state; a heading-level check | no action fits a shop waiting for orders; the heading used was correct | #26 |
| 20 | Skills | spec-review and security-audit on the local model | the local model was busy with another builder | #25 |
| 21 | Skills | a second round of spec-review or security-audit; a mutation check by the lead | not seen | #25 |
| 22 | Skills | the full eval set on the local model | the local model was busy | #27 |
| 23 | Skills | the behaviour cases of `diagnosing-bugs`, `tdd`, `codebase-design`, `frontend-design`, `browser-check` on the lead | their text did not change in #113; loading on the lead passed | #113 |
| 24 | Skills | the `security-audit` case after the parameter rename | about 1.5M tokens for a wording change | #137 |
| 25 | Skills | repo-setup: `gh repo create`, the ruleset POST, label and milestone creation, the model-driven flow | not re-tested: no delete scope for a fresh repo | acceptance |
| 26 | Runner and tidy | `pi-env tidy` on a PR from a fork; a locked worktree | unit logic only (fork); not tested (locked worktree) | #29 |
| 27 | Sandbox | Docker Sandboxes `sbx` v0.53.0 | `sbx diagnose` fails on `/dev/kvm` (the test host user is not in the kvm group); it needs a Docker account login; the test host OS (Debian 13) is not supported | #35 |
| 28 | Runner and tidy | the runner's default `sandbox: foreign` on a repo that is not yours | unit tests cover the setting; #109's live check used `--sandbox off` | #110 |
| 29 | Subagents | removal of a worker's worktree after a real merge | unit-tested | #111 |

## Install

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Cut-over of the test host to v2: installed package and real agent dir; roles listed, guard and footer through Claude (rows in Guard and Footer); rollback to `v1-final` and forward again | Sonnet | pass. After `git checkout v1-final` the v1 web extension failed to load until `npm ci` ran (the two versions have different dependencies); `docs/install.md` has the step | #46 |
| Rename pi-env → pitcrew, cut-over of the test host (2026-11-13): backup of settings.json and of the old state first; checkout, `~/.pi/agent/pitcrew/`, `~/.config/pitcrew/` (700/600), `~/.local/state/pitcrew/` moved; package path and key `pitcrew` in settings.json; link `~/.local/bin/pitcrew`; `npm ci`; image `pitcrew-box:1.5.2` built, `pi-env-box:1.5.2` removed | none | pass | #156 |
| After the rename: `pi --list-models role` | none | five roles, no notice | #156 |
| After the rename: fresh interactive session, `--profile local`, one turn; then `/mode rigor fast` and `/profile` | local | answered; footer `pr · standard profile:local`, then `pr · fast`; `/profile` lists the local map | #156 |
| After the rename: a session saved before it (entries `pi-env-roles`, `pi-env-mode`), resumed from a copy | none | `/profile`: `custom (from session)` with its map; footer `local · standard` (the settings say `pr`) | #156 |
| After the rename: `pitcrew status`, `pitcrew tidy --dry-run`, `pitcrew check` in the checkout | none | run: no run yet / main kept / `ok` | #156 |
| After the rename: `web_search` in a session | local | `backend: exa`, results (the key from `~/.config/pitcrew/exa-key`) | #156 |
| After the rename: one scout child (`ls -a` of the cwd) | local | started, done in 3 turns, report shown | #156 |
| After the rename: `pitcrew box exec <repo> -- sh -c ...` | none | exit 0 in the new image, `/opt/pitcrew` mounted | #156 |
| After the rename: one turn through the bridge, `pi -p --thinking low` | Sonnet | answered | #156 |
| `@playwright/cli` 0.1.24 needs Chromium revision 1254; the test host had only v1's 1248. Installed with `scripts/browser install-browser chromium` | none | about 700 MB on disk | #26 |

## Roles and profiles

Profiles: `claude`, `codex`, `local`, `custom` (default). `mixed` was removed (#100). The user pass
used a test profile file `haiku` (every role on Haiku).

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| A `direct` request on `role/lead` (`streamSimple` from a test extension, as pi's summaries route): profile with lead on qwen3.8-27b and scout on gemma-4-26b-a4b | local | before: answered by qwen3.8-27b; after: by gemma-4-26b-a4b (the server swapped to it) | #126 |
| A repo's `.pi/profiles` is read only in your own or a trusted repo | none (unit) | pass (the same `ownOrTrusted` test as the verify gate) | #122 |
| `/profile`: the map and "available: claude, codex, custom, local, haiku" | Haiku (history) | pass | user pass |
| `/profile custom`, `/profile nope` | Haiku (history) | pass. After the switch the footer still shows the last routed model (`→ haiku-5-5`) until the next request | user pass |
| `/role`, `/role scout :medium`: profile shows `haiku*` | Haiku (history) | pass. With the completion list open, the first Enter takes the completion and the second runs the command (pi's editor) | user pass |
| Start-up line: `Model scope: lead, worker, scout, reviewer, second (Ctrl+P to cycle)`, no physical model | local | pass | #96 |
| `/role lead lla` + Tab: completes to `llama.cpp/…` (2 matches; Tab takes the first) | local | pass | #96 |
| `/role lead` + Enter: list "Model for lead" of all 25 available models; picked `llama.cpp/gemma-4-26b-a4b`; map shows `local*` with the new lead, level kept | local | pass | #96 |
| Next request: footer `role/lead → gemma-4-26b-a4b`, answer `ok` | local | pass | #96 |
| A second session started after the change (RPC, same agent dir): `/role` shows lead `qwen3.8-27b`, and qwen3.8-27b answered its request; the first session still shows gemma | local | pass | #96 |
| Package loads; `pi --list-models role` shows lead, worker, scout, reviewer, second | none | pass | #2 |
| `--profile local`: `role/lead` is answered by the local model | local | pass | #2 |
| Two sessions at once (default profile, `--profile local`): each keeps its own map while the other changes roles | not stated | pass | #2 |
| `/role lead <model>:low`, then another model, then `/profile claude`: each next request goes to the new model; the profile shows as `claude*` after a change | not stated | pass | #2 |
| `/role scout :high` changes only the level | not stated | pass | #2 |
| Unknown role, model not in the catalog: error message, map unchanged | none | pass | #2 |
| A process started with `PI_ENV_ROLES` uses that map (child inheritance) | not stated | pass | #2 |
| Resume (`--continue`): the changed map comes back from the session | not stated | pass | #2 |
| `--profile nope`: clear error at start; requests fail with the reason, no fallback | none | pass | #2 |

#96 setup: pi in tmux (160 × 45), throwaway agent dir with `enabledModels: ["role/*"]`, profile
`local`. Found: only `config/settings.base.json`, `box/settings.json` and `tests/live/agent-dir.sh`
set `enabledModels`; all three are now `["role/*"]`, and a unit test checks it.

Note (#2): pi clamps the thinking level to what the physical model supports (the local model reports
`off` or `medium`).

## Session mode and delivery rules

Since #110 the mode has two dials (`stop`, `rigor`) and four switches; `tracking` is a repo
setting. Rows before #110 use the old shape (a `tracking` dial, `review: pr`, `foreignRepos`); they
show the mechanics, not today's names.

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `pi --stop plan`: "create note.txt containing hi"; then `/mode stop local` and the same request | local (qwen3.8-27b) | at plan: no `edit`/`write` tool, "Plan-only mode is active, so I won't create any files"; after the change: `write` was back and the file was created | #127 |
| Session start with an old key (`mode.tracking`) in the settings | local | one notice `settings not read … piEnv.mode.tracking (now: piEnv.tracking …)`; the session runs | #110 |
| The mode reaches the model as a message: "may you merge a PR yourself?" | local | "Stop at a ready PR (owner reviews and merges it — I may not merge myself); track work on GitHub" | #110 |
| The same through the bridge | Sonnet, low | "I go as far as a ready PR (which must close an issue), and I may not merge it myself" (first request 8,845) | #110 |
| The message is sent again only after a change (`/mode stop milestone`, `/mode stop pr`, `/mode review on`) | local | one message per change, none for an unchanged mode | #110 |
| `stop milestone`: `gh api -X PATCH …/milestones/9999 -f state=closed` | local | no guard question; the call ran (404) | #110 |
| `stop pr`: the same command | local | guard asked (`github-write`), declined | #110 |
| `/mode review on`, then "will a fresh reviewer check your change?" | local | "Yes — … a fresh reviewer agent checks the change before I merge or call it done" | #110 |
| `/mode tracking none` | local | error: "tracking is a repo setting: …" | #110 |
| `pi --profile haiku --tracking local --stop local --rigor fast`: footer `local · local · fast profile:haiku` | Haiku (history) | pass | user pass |
| `/mode`, `/mode stop pr`, `/mode stop deploy` | Haiku (history) | pass; the error lists the allowed values | user pass |
| `--stop pr`: `gh pr create -t lt1 -b "No issue here."` | local | ask `issue-required` with the reason; declined, PR not created | #28 |
| Same with `-b "Closes #5"` | local | no dialog (inside the stop dial); PR #6 created | #28 |
| `--stop pr`: `gh pr merge 6 --squash` | local | ask `stop`: "the stop dial is pr" | #28 |
| `--stop merge`: `gh pr merge 6 --squash` | local | ask `merge-head`: no `--match-head-commit` | #28 |
| `--stop merge`: `gh pr merge 6 --squash --match-head-commit <head>` (repo without a verify command) | local | no dialog; merged; issue #5 closed by the PR | #28 |
| Repo with a verify command (`npm run check`): merge pinned to a head with no verify run in the session | local | ask `merge-head`: "no passing verify run on be3ef2a" | #28 |
| Same session: the model appends a line, commits, pushes (no dialog for the push at `--stop merge`); the verify gate runs at the end of the turn; then merge pinned to the new head | local | no dialog; merged | #28 |
| Foreign clone with `.pi/settings.json` (stop `plan`) and `.pi/extensions/mark.ts`, agent dir with `defaultProjectTrust: always` | local | trust answered "no": `pi-env: octocat/Hello-World is not your repo (permission READ) …`; the mark extension did not load; mode stayed `issue · pr · standard` | #28 |
| Foreign clone: `gh label create pi-env-test --help` (inert if it ran) | local | ask `foreign-repo` | #28 |
| `piEnv.caps.worktrees: 2` with 3 worktrees: `git worktree add ../pes.wt/lt3 -b lt3 origin/main` | local | ask `cap` with the count; nothing created | #28 |
| A repo with `piEnv.mode` in `.pi/settings.json` (`none`, `local`, `fast`) starts in that mode | local | pass | #3 |
| `/mode review pr` and `/mode stop merge` change the session; the footer shows `fast*` | local | pass | #3 |
| Resume (`--continue`): the session's changes come back | local | pass | #3 |
| A plain folder started with `--rigor strict --tracking project` at the same settings: its own mode | local | pass | #3 |
| A bad value (`/mode stop deploy`): error that lists the allowed values, mode unchanged | local | pass | #3 |
| A process started with a parent's `PI_ENV_MODE` starts from the parent's dials and switch changes; `/mode rigor strict` then gives the strict preset plus the parent's change | local | pass | #3 |

#110 setup: a clone of the scratch repo, a throwaway agent dir whose settings still held the old
`mode.tracking`.

#28 setup: RPC driver, throwaway agent dir, the scratch repo (permission ADMIN) and a clone of
`octocat/Hello-World` (permission READ) as the foreign repo. Dialogs answered "no". One exact command
per prompt. Cleanup with `pi-env tidy --all-merged` removed both branches (worktree, local, remote).

#3 setup: throwaway agent dir, `local` profile, trusted repos.

Found and fixed:
- #28: pi's action methods (`getSettings`) throw during `project_trust`, so the first trust handler
  failed and pi fell back to its default. The handler now reads the global settings file; a unit
  test covers it.
- #3: `/mode` in a child dropped the parent's mode.

Note (#3): pi applies a repo's `.pi/settings.json` only when the repo is trusted.

## Guard

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `/guard off`, `/guard on` | Haiku (history) | pass: "asks skipped, blocks stay" | user pass |
| Download then run: `curl … -o /tmp/pe5/dl.sh && sh /tmp/pe5/dl.sh` | local | blocked (`pipe-to-shell`), nothing downloaded. A block, not an ask, as `docs/guard.md` says | acceptance |
| `curl -s -m 2 http://169.254.169.254/latest/meta-data/` | local | ask `secret`: "requests a cloud metadata address" | #52 |
| `find .git -delete` (from a subfolder) | local | ask `git-internals`: "find deletes inside .git" | #52 |
| `wget -q https://example.com/ -O v26-i.sh && sh v26-i.sh` | local | not exercised: the model refused to run downloaded content and only downloaded and read it. Unit tests cover the block | #52 |
| Through Claude: `sudo ls /root` opens the guard dialog; Escape ends the turn with the guard message | Sonnet | pass | #46 |
| `git push --force origin main`: blocked, the turn ends, a `guard-blocked` message is shown | local | pass | #4 |
| `sudo ls /root`: confirm dialog; declined; the command does not run | local | pass | #4 |
| `ls`: runs | local | pass | #4 |
| Headless with `PI_GUARD_STRICT=1`: `sudo` is blocked without a dialog | local | pass | #4 |

#52: the other closed gaps (`rm -r .*`, `parallel … ::: /`, a function that deletes its argument, a
git alias that runs a shell) are unit-tested only. Everyday commands in the corpus still pass (19,
6 new ones next to the new rules).

#4 setup: scratch repo, RPC driver answering dialogs "no". #4 did not use the Claude path; the
cut-over (#46) did.

Guard fixes found by other tests: a GraphQL `query` no longer asks (#30, Skills); a body file written
in the same command line counts, and a merge needs the literal sha (#32, Skills); the guard and the
strict run in subagents and the sandbox (Subagents, Sandbox).

## Verify gate

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| A worker child of the agent tool edits README.md in your own repo (scratch clone, `check` script) | local (qwen3.8-27b) | before: the only receipt was the parent's (`by session`): the child's gate never ran. After: `by worker-1 npm run check exit 0`, the child's own gate ran it | #144 |
| A local repo with no GitHub remote (not yours) and no `.pi/`; its `check` script touches a marker; "Create a file a.txt containing hello": main before the change | local | marker created: the gate ran the repo's script on the host | #122 |
| The same with the change | local | marker absent: the gate sent its reminder instead | #122 |
| The same, folder trusted with a `trust.json` yes (as `/trust` writes it) | local | marker created | #122 |
| `pi-env check` on main | none | pass: `ok` | user pass |
| Lean-code checks, `pi-env check` with no options (no session, so the `standard` preset: warn) | none | `code +176 -6, tests +76 -0, other +34 -1 (not counted)`, `ok`, exit 0 | #33 |
| `pi-env check --level block --max-lines 100` | none | `block: change size 254 lines …`, exit 1 | #33 |
| `PI_ENV_MODE='{"rigor":"fast"}' pi-env check` | none | "lean-code checks are off", exit 0 | #33 |
| `pi-env check --json` | none | counts, bounds, findings and exit code as one JSON line | #33 |
| Gate on: after the edit the gate runs `npm run verify`, it fails, fix round 1/2 starts, the agent repairs the code, the gate runs again and passes (`verify ✓`) | local | pass | #5 |
| `/mode verify off`: the same edit ends the turn with no verify run | local | pass | #5 |

#33 setup: run on its own branch (`v2/33-lean-checks`), no model. Found and fixed: marker strings
inside the test file's string literals were read as markers (now skipped when the opener sits inside
quotes); the base fell back to the local `main` when the clone has no `origin/HEAD` (now
`origin/main`, then `origin/master`, then local). Open: one flaky `fail 1` (see Not tested live).

#5 setup: scratch repo with `calc.js`, `calc.test.js` and `"verify": "node --test"`. The prompt tells
the agent to break `add` and to run no command.

Related: since #32 a passing run of the verify command by the agent (alone, or a link of an `&&`
chain) counts for the tree it ran on (see Skills, github-delivery).

## Footer and stats

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| pi in tmux, scratch clone: type `fix #1`, Tab; then `alt+a` | local | the editor became `fix #14` (the first open issue starting with 1); `alt+a` opened the `agents (0)` panel | #130 |
| Session map: a write (the gate ran `npm run check`), a background scout, `/handoff`; label entries in the session file | local | `verify ✓ npm run check @e650612`, `agent scout-1 done`, `handoff → 2026-11-12-2331-continue.md`. PR labels: unit test only (no PR opened) | #128 |
| Status keys with one prefix: `pi-env.profile`, `pi-env.mode`, `pi-env.guard`, `pi-env.gate`; `/agents limits running 0` then `/agents limits`: "running no limit at each depth, … child time no limit (piEnv.agent.maxMinutes; 0: no limit)" | local | pass | #141 |
| `PI_PROGRAM_STATUS=1`: a scout asks with `ask_parent` while the owner is at the terminal (pane output captured with `pipe-pane`, OSC 7501 decoded) | local | `working`, then `blocked kind=question "scout-1 asks: …"`, then `working` when the question went to the parent model after 30 s, then `done` | #112 |
| `/footer` | local | no longer a command (one footer since #112) | #112 |
| `/stats` | Haiku (history) | pass (no usage yet in a new agent dir) | user pass |
| Footer through Claude: `(claude-bridge) role/scout → sonnet-5-5 • low`, context, cache, cost, Claude 5 h and 7 d windows, guard counts; line 3 `issue · pr · standard profile:claude` | Sonnet | pass (`claude` was the default profile then; now `custom`) | #46 |
| Line 1: location and branch; `(llama.cpp) role/lead → qwen3.8-27b • off` after `/role lead :off` | local | pass | #6 |
| Line 2: context use, cache hit, tokens; guard and gate state | local | pass | #6 |
| Line 3: session mode and profile (`issue · pr · fast profile:local*`) after `/mode rigor fast` | local | pass | #6 |
| `/stats` prints the three tables | local | pass (empty: the test used its own session folder) | #6 |

#6 setup: pi in tmux (150 columns), scratch repo. The `agents 1▶` segment is in Subagents (#15).

## Prompt and context cost

**Standing cost now (#113):** global rules 3,355 characters (bound 4,200 in
`tests/package.test.mjs`); rules plus the 8 model-picked skill descriptions 5,127 characters, about
1,280 tokens (the reported target is 6,000 characters; `npm run check` reports it, does not enforce
it).

History (rules + model-picked descriptions): 2,747 characters, about 690 tokens (#7, rules only) →
2,747 + 673 (three descriptions) = 3,420, about 860 (#24) → 3,170 + 1,546 (seven descriptions) =
4,716, about 1,180 (#26) → 3,170 + 2,217 = 5,387, about 1,350 (#27) → 3,788 rules, total 6,005, about
1,500 (#90) → 3,682 + 2,217 = 5,899 (#118, provenance line out) → 3,355 + 1,772 = 5,127 (#113, 8
model-picked skills). The github-tracking description alone is 227 characters, about 57 tokens (#30).

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| First request, "Reply ok", global rules as the `personal_defaults` section (`piEnv.rules: on`): lead / `scout` child | local | 4,683 / 2,393 tokens | #115 |
| The same | lead (bridge) / Sonnet low child | 7,683 / 4,595 tokens | #115 |
| First request of the lead, native, "Reply ok" | local | 5,102 tokens (5,427 after #110, 5,440 before it) | #111 |
| Global rules: old symlink → section → none: lead | local | 5,314 → 5,281 → 4,447 | #125 |
| The same: `scout` child (child arguments, `PI_ENV_DEPTH=1`) | local | 2,680 → 2,395 → 1,814 | #125 |
| The same: lead | lead (bridge) | 8,538 → 8,484 → 7,289 | #125 |
| The same: `scout` child | Sonnet low (bridge) | 5,000 → 4,595 → 3,751 | #125 |
| First request, "Reply ok", before / after the skill merge (base a9e4f39) | local | 5,438 / 5,304 | #113 |
| The same | lead (bridge) | 8,751 / 8,522 | #113 |
| First request of a session | local | 5,616 tokens | acceptance |
| First request of a session, through the bridge | Haiku (history) | 9,912 tokens | acceptance |
| First request of a child, worker: before / after | Haiku (history) | 9,635 / 7,902 tokens (18 % saved) | #76 |
| First request of a child, scout: before / after | Haiku (history) | 7,401 / 5,768 tokens (22 % saved) | #76 |
| First request of a child, reviewer: before / after | Haiku (history) | 7,446 / 6,070 tokens (18 % saved) | #76 |
| Where a scout's 7.4K went (before) | Haiku (history) | skill listing 1.6K, context files (global rules) 1.2K; the rest is the bridge's own prompt, the tools and the agent's prompt | #76 |

First-request history: 2,610 native and 5,596 through the bridge (#9); 2,263 local and 5,126 bridge
(#8, the 2,900 difference is the prompt Claude Code adds); about 4,000 local before the #26 rebase.
The growth to 5,616 / 9,912 comes from more global rules, skills and extensions.

#76 method: `pi --mode rpc` with the child's args and env, task "Reply ok", every role on Haiku,
scratch repo; tokens sent = input + cache.

**Prompt fidelity** (`tests/live/fidelity.sh`: ten markers, one per instruction channel; the model
calls one tool and lists the markers it sees).

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| After #125, on the lead (local profile) and the bridge | local; Sonnet low | as `fidelity.expected.txt`: 10 native, 8 through the bridge (SECTION among them) | #125 |
| The rules section arrives: "quote the line about a shortcut comment; does an instruction name diagnosing-bugs?" with `rules: on` and no `AGENTS.md`: lead quotes the `shortcut:` line, "yes"; a child quotes it, "no" (short variant); control without rules: "None", "yes" (skill list only) | lead; Sonnet low | pass | #125 |
| pi native | local | all 10. The first run listed 9 (no SNIPPET), the second all 10: the model's listing, not the channel | acceptance |
| Claude bridge | Haiku (history) | the 8 of `fidelity.expected.txt` | acceptance |
| pi native | local | all 10 | #9 |
| Claude bridge 0.12.0 | Haiku (history) | 8: not `promptGuidelines`, not `promptSnippet` | #9 |
| Claude bridge, whole `systemPrompt` returned by an extension | Haiku (history) | the same 8; the forced prompt does not arrive, the turn does not fail | #9 |

The rule that follows is in `docs/claude-access.md`.

**Global rules file** (`AGENTS.global.md` linked as `AGENTS.md` in the agent dir; one question about
a rule, one `printenv PI_ENV_MODE`):

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| The model answers from the rules and reads the session mode with bash (no guard dialog) | local | pass | #7 |

**Code mode** (#8). Task: six JavaScript files of 41 to 241 lines, "count the lines and find the NAME
constant of each". One run per cell, so small differences are noise. Value = requests / first request
tokens / sent (input + cache, all requests) / output / tool calls.

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| Code mode off | local | 2 / 2,263 / 4,851 / 568 / bash 1 | #8 |
| Code mode on | local | 3 / 2,815 / 10,322 / 813 / bash 2, read 1 | #8 |
| Code mode off | Codex small | 4 / 1,824 / 14,527 / 633 / bash 4, read 6 | #8 |
| Code mode on | Codex small | 4 / 2,411 / 13,765 / 430 / bash 2, read 6 | #8 |

Findings: code mode adds 552 (local) and 587 (Codex) tokens to the first request. No model called
`codemode`. Decision: off by default for every model; a switch. #18 ran code mode with scriptable
subagents (see Subagents).

## Context, compaction and handoff

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| pi's own between-turn check through the bridge on a 1M model: `compaction.modelOverrides["role/lead"]` (and the Sonnet model's key) `reserveTokens: 970000`, `keepRecentTokens: 8000`, so the threshold is 30K of the 1M window; `compactAt: 0`; 14 files of about 15K tokens read whole, one per turn | Sonnet (lead, low) | fires: 13 compactions with reason `threshold` inside the one run, at 31.7K–34.3K tokens; usage arrived through the bridge on every response (never 0 or stale: about 24K after each compaction); summaries by the `scout` role (Sonnet); the run went on after each one and ended by itself. 15 requests, 354K tokens sent, 4.7K output. Found: the answer was wrong (see below), fixed | #143 |
| The same after the fix | Sonnet (lead, low) | 20 compactions at 31.8K–34.0K; the `FINAL` line was right (14 of 14 words). With a compaction on every turn the agent re-read 7 files to check words it no longer saw; 22 requests, 521K sent, 3.9K output | #143 |
| The same inside a `scout` child started by the lead (`role/scout`) | Sonnet (low) | 19 compactions in the child's session file, at 30.3K–44.5K (the first came one turn late: pi counts the newest tool result by characters, which undercounts this dense text); the child ended and the lead's `FINAL` line was right. Child: 22 requests, 475K sent (367K of it cache writes), 7 re-reads | #143 |
| `/handoff` after reading three files (a test extension logged the old path's separate `complete()` usage) | Sonnet (lead, low) | before: the separate request reports no usage through the bridge (all zeros), so it is not measurable there; it sends the serialized conversation uncached, plus the Claude Code preset (about 10K tokens here, estimated from the request text). After: the handoff turn sent 370 new tokens (4 input + 366 cache write) and read 8,249 from the cache; file written | #124 |
| The same on the local model | local | before: 4,555 input (first run); after: 224 new, 11,987 read from cache; file written. A first version waited with `waitForIdle()`, which returned before the turn started (no file): fixed by waiting for the run's end | #124 |
| Harness trigger moved to the end of a turn (`compactAt: 10`): `ctx.compact()` in the middle of a run | local | fails: the run is aborted and the compaction cancelled. Not adopted | #123 |
| pi's own between-turn check under a role (`compaction.modelOverrides["role/lead"].reserveTokens: 86304`, about 12K of the 98K window; harness trigger off); six 400-line files read one per turn | local | 5 compactions with reason `threshold` in the one run, each with the harness's summary; the answer after the last one was right | #123 |
| The same inside a `scout` child (`role/scout`) | local | 5 compactions in the child's session file; the child finished with `Status: done` | #123 |
| `/handoff make greet print the greeting` | Haiku (history) | pass: file written, new session with the handoff in the editor. Found: the new session started from the settings again (`/role` change lost); fixed, see below | user pass |
| After the fix: `--tracking local --rigor fast`, `/mode stop pr`, `/role scout :high`, `/handoff` | local | pass: the new session shows `local · pr · fast profile:local*`, scout `high`, "from previous session" | user pass |
| `/compact keep only …` on a short session | Haiku (history) | pi: "Error: Compaction failed: Nothing to compact (session too small)". An "Error" for a normal case; the README now says so | user pass |
| Compaction through the bridge: repo settings `compactAt: 1`, `compaction.keepRecentTokens: 1500`; read a 401-line file, then "answer without any tool: first word, branch" | Haiku (history) | pass: compaction at 2 %, state block first, answer "Zanzibar", branch `feat-x` | acceptance |
| RPC: `/handoff fix the add bug and add the test` writes `…/handoffs/2026-11-12-1456-fix-the-add-bug-and-add.md` in the work folder outside the repo; the repo stays clean | local | pass | #12 |
| The handoff file holds the state block (request with the decisions the user stated, mode, profile, branch) and the model's handoff (context, done, decisions, state, next goal with checks, facts) | local | pass | #12 |
| Terminal: `/handoff fix add` opens a new session with the handoff in the editor and the notice "Handoff ready" | local | pass | #12 |
| The run ends at 9 % of the window: the harness starts a compaction | local | pass | #10, #11 |
| The summary starts with the state block: latest request, session mode, profile, git branch, uncommitted file, the issue link | local | pass | #10, #11 |
| The model summary (by the `scout` role) follows, with goal, done, facts to keep | local | pass | #10, #11 |
| After the compaction the agent answers from context: first word of the file, issue link, branch, mode | local | pass | #10, #11 |
| A session smaller than `keepRecentTokens`: pi reports "nothing to compact"; no error is shown | local | pass | #10, #11 |

Found and fixed (user pass): pi loads the extensions again for a new session, so the mode and the
role map are now carried in the process (`/new` too).

Found and fixed (#143): the summarizer sees each tool result cut in the middle at 6,000 characters,
and the marker said only "characters left out". Its summaries then said the code word "was cut from
the output" and "invented", and the agent withdrew 13 right answers (`FINAL: unavailable, …`). The
marker now says the cut is in the summarizer's copy only and the agent saw the whole result, and the
summary prompt says that a value the agent reported is not lost because the copy does not show it.

#143 setup: a throwaway agent dir with a profile that puts every role on Sonnet at `low`, a scratch
repo with 14 files of 350 lines (line 174 holds a code word), and the prompt "read each file whole,
one per turn; write the code word and the last line's measure; end with `FINAL:` and the 14 words".
The threshold was set so low that every turn compacts; a real setting compacts far less often.

#10, #11 setup: scratch repo on a branch with one uncommitted file; repo settings `compactAt: 6` and
`compaction.keepRecentTokens: 1500`. The session reads a 22 KB file and is asked about it after the
compaction, with tools forbidden. Note: pi refuses a new prompt while a compaction runs.

## Web

### web_fetch

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `web_fetch https://excalidraw.com/`: "page renders client-side … Open it in a headless browser with the browser-check skill, or look for … raw files, an API or the docs source" (#79) | local | pass | acceptance |
| HTML: `https://nodejs.org/api/dns.html` with `find: "verbatim"`: banner, title, 71,889 chars saved under `/tmp/pi-env/web/<session>/`, 13 matching lines inline | local | pass | #20 |
| PDF: `https://arxiv.org/pdf/1706.03762`, `maxChars: 1500`: 39,850 chars with page markers, truncation pointer | local | pass | #20 |
| GitHub: a `blob` URL of `nodejs/undici/package.json` is read from `raw.githubusercontent.com`; `find` returns the version line | local | pass | #20 |
| SSRF: `http://169.254.169.254/latest/meta-data` → `blocked: … not public (link-local / cloud metadata)`; `http://localhost:8080/` → `blocked: localhost is a local name` | local | pass | #20 |

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| #20 run, 4 prompts | local | 8 requests, first 2,481, sent 58,430, output 4,347 tokens | #20 |

### web_search

#63 setup: both backends called directly with no model choosing the query: a test-only extension
command ran `runSearch` from `extensions/web/search.ts` with a fixed order, through pi in RPC mode
(throwaway agent dir, local profile; the lead model was never called). Exa: key from the key file.
Codex: `piEnv.web.codexModel` = `openai-codex/gpt-6-luna`, thinking `low`. The same 8 questions to
both, 5 results each. Relevance judged by reading the top results (`curl` of the pages, the fact
searched in the text). Codex searches used: 8. Codex tokens are in / cache / total.

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| Q1 undici `Client` `bodyTimeout` default | Exa | undici docs site and GitHub `Client.md`, snippet "Default: `300e3`" (checked in the raw file); 2.1 s | #63 |
| Q1 | Codex | right (300,000 ms); `Client.md` twice, a mirror, a GitHub diff page, a Node issue; 5.6 s, 4,743 / 3,968 / 8,816 | #63 |
| Q2 Node.js version with type stripping on by default | Exa | 22.18.0 release note ("Type stripping is enabled by default", checked), Node TypeScript docs, Node Learn; 1.7 s | #63 |
| Q2 | Codex | right (22.18.0, also 23.6.0); the same release note and docs; 5.7 s, 4,737 / 3,968 / 8,837 | #63 |
| Q3 TypeScript `erasableSyntaxOnly`: what, which version | Exa | TS 5.8 release notes, the option's own TSConfig page (checked), two blog posts; 1.3 s | #63 |
| Q3 | Codex | right (5.8, enums, parameter properties); sources: the TSConfig index (lists the option only), an almanac page (5.8, checked), a PDF, a TS 6 migration blog; 9.1 s, 9,036 / 3,968 / 13,239 | #63 |
| Q4 Python `requests` default timeout | Exa | quickstart and advanced docs ("requests do not time out unless a timeout value is set", checked), a GitHub issue, a Stack Overflow answer about sockets; 1.2 s | #63 |
| Q4 | Codex | right (none); advanced docs, GitHub source and docs files; 4.7 s, 4,646 / 3,968 / 8,729 | #63 |
| Q5 GitHub Actions `cancel-in-progress`: pending and running jobs | Exa | GitHub docs (pending replaced, checked), two blog posts, Stack Overflow, a docs PR; 1.6 s | #63 |
| Q5 | Codex | right; four GitHub docs pages, one with `?utm_source=openai`; 5.5 s, 4,601 / 3,968 / 8,714 | #63 |
| Q6 git "refusing to merge unrelated histories" | Exa | git `merge-options` docs (`--allow-unrelated-histories`, checked), Baeldung, two Stack Overflow, Tower; 1.3 s | #63 |
| Q6 | Codex | right; git-scm `git-merge` (checked), `git-pull`, an old `merge-options`; 8.4 s, 4,636 / 3,968 / 8,716 | #63 |
| Q7 Compose `depends_on` `service_healthy` with a healthcheck | Exa | Docker startup-order docs (checked), Docker Learn example, Compose reference, two blogs; 1.7 s | #63 |
| Q7 | Codex | right, with a YAML example; startup-order (with `?trk=` parameter), Compose reference, three general Docker pages; 6.2 s, 4,598 / 3,968 / 8,783 | #63 |
| Q8 Vitest: run test files one after another | Exa | `fileParallelism` config page (checked), parallelism guide, a discussion, the recipe; 2.2 s | #63 |
| Q8 | Codex | right (`fileParallelism: false`); the same pages (in the fallback run); 5.3 s, 4,767 / 3,968 / 8,860 | #63 |
| Search time and cost | Exa | 1.2 to 2.2 s; no subscription tokens (about $0.012 per search) | #63 |
| Search time and cost | Codex | 4.7 to 9.1 s; 8,700 to 13,200 tokens per search | #63 |
| Codex cost per search, from the tool result | Codex small | 8,840 and 8,768 tokens total; 4,764 input + 195 output. About 5,000 to 9,000 tokens per search, almost all input | #19 |
| Lead cost per search turn | local | 2 requests, about 5,600 tokens sent | #19 |

Reading (#63): both backends put a right, official page first or second in 8 of 8. Exa's snippets
carry the fact itself (the lead can often skip a fetch); its lower results are sometimes blogs or
Stack Overflow. Codex adds a short answer (right in 8 of 8) but gives no snippets, and 5 of its 40
sources were noise or weak (a diff page, a mirror, an index page, tracking parameters). Decision: the
default order stays `["exa", "codex"]`; a unit test pins it.

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Fallback: order `exa, codex`, `EXA_API_KEY=bad-test-key` in the env for this run only (key file not touched): `exa: failed: HTTP 401 key rejected`, then Codex answered Q8 | Codex | pass (5.3 s) | #63 |
| Fallback: order `codex, exa`, `codexModel` set to a model that does not exist: `codex: model openai-codex/no-such-model is not in pi's model list`, then Exa answered Q8 (no Codex call) | Exa | pass (0.3 s) | #63 |
| No backend configured: the result is an error that lists `exa: no key: set EXA_API_KEY, or write the key to ~/.config/pi-env/exa-key (mode 0600)…` and `codex: no openai-codex model: set piEnv.web.codexModel…`; the model reports it and does not invent an answer | local | pass | #19 |
| Default order with no Exa key: `exa` is skipped with the reason, `codex` answers: 5 sources and a short answer (undici 8.12.4, the version `web_fetch` read from GitHub in #20) | local lead, Codex small search | pass | #19 |
| `site: ["exa.ai"]`: the two sources the model listed are on exa.ai subdomains (the others were not printed) | local lead, Codex small search | pass | #19 |
| Third query, after the result line was changed to show input and output tokens | local lead, Codex small search | pass | #19 |

#19 setup: profile `local` (no Codex role), RPC driver; no Exa key on the test host then. A scratch
repo set `piEnv.web.codexModel` to Codex small. Three Codex searches.

### web-research skill

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Citation check drops a claim: "the Node.js docs say dns.lookup() never reads /etc/hosts" with the DNS page as source | local | pass: `web_fetch` with `find` twice, then grep of the saved page; "Claim dropped. The cited page says the opposite" | acceptance |
| One fact: does turndown 7.2.5 turn `<br>` into two spaces and a newline, which option changes it. Expected: installed source first, no web, cited | local | did not load the skill; read the installed source, ran a 3-line check, cited `node_modules/turndown` lines; no web call. Right behaviour, skill not picked. 49K sent, 8 requests | #21 |
| Comparison: Exa and Brave free tier and price per 1,000, citations checked. Expected: official pages, quotes, citation check | local | loaded the skill; fetched both pricing pages (no fan-out: one page per option), found a conflict on Brave's page ($20 hero against $5 per plan) and reported it; 5 claims checked with `web_fetch find`, one re-found after a markup split. 203K sent (one 53K page read in parts) | #21 |
| Broad report: instruction files of three agent CLIs, "split the work". Expected: 3 `researcher` agents, merge, citation check | local | 3 researchers started in one turn with the template task; all 3 failed on the 98K context (one reached 152K input before the cap) with partial reports; the lead said so and did the research itself (docs, `find`, shallow clones), then a cited report. 797K sent, 23 requests | #21 |
| Same broad report | Haiku (history) | loaded the skill; 3 researchers with a JSON schema (`agent run`), each done in about 15 s (about 33K tokens in, 3K out); merged; 9 doc quotes re-checked with `web_fetch`; the source-line claims from the researchers marked "not verified by me". 96K sent, 6 requests | #21 |

#21 setup: RPC driver, `--tracking none --stop local`, scratch repo with `turndown` 7.2.5 installed,
search backend Exa. Tokens are the lead's. The Haiku run was used because the local model was busy.

Changes after #21: the size table gained the row "one or two pages per option: do it yourself"; the
researcher task and agent now say to keep the context small (`find`, grep the saved file, report
before the context fills); the skill warns that small-context models lose researchers to context
overflow.

## Subagents

Since #111 the tool takes `{agent, task, role?}`; `fork`, `files`, `name`, `cwd`, `thinking` and
`start.wait` are gone, so the rows below that use them record removed options. #114 (PR #140) moved
the child runner to `lib/rpc-child.ts`; its live smoke (guard block, agent start and wait, one
`pi-env run` issue, box rebuild and `box exec`, local model) is stated in PR #140, with no table here.

Current limits: no quota stop (removed in #101). No default time limit (#103). With
`piEnv.agent.maxMinutes` set, the child gets a wrap-up message at the limit and is stopped 2 minutes
later. `askTimeoutSec` stays 600 s (#100).

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Children start with `--offline` (no catalog refresh or version check): `agent run` a scout on the bridge and a worker on the local model, each answering JSON | Sonnet (scout, low); local (lead, worker) | both answered (`{"word": "hello"}`, `{"ok": true}`); the scout's session shows `claude-bridge/claude-sonnet-5-5` | #129 |
| "Start two worker agents in one turn": A adds `a.txt`, B adds `b.txt`, each commits | local | pass: `start {agent: "worker", task}` twice; worker-2 ran in its own worktree (`…/repo.wt/agent-…-worker-2`, branch `agent/…`); `main` holds only `a.txt`, the agent branch only `b.txt` | #111 |
| `ask_user` with one question | local | pi's select dialog, recommended option first; "The user selected: Spaces" | #111 |
| Worktree removed once the parent's branch holds its commits; kept before | none (unit) | pass | #111 |
| `/agents resume` resumes the children a quota refusal stopped | none (unit, fake child) | pass | #111 |
| `/agents` (no children), `/agents limits`, `/agents limits running 2` | Haiku (history) | pass. `/agents limits` did not show `maxMinutes`: fixed | user pass |
| `/agents` opened on a running worker (six `sleep 20` calls), its transcript opened, then Esc, Esc: the child kept running, finished, its report was delivered and started a parent turn | local (tmux) | pass | acceptance |
| Queued result and a parent crash: a scout finished while the parent ran `sleep 90`; the parent was killed with `kill -9`; `pi --continue` delivered the report once; a second `--continue` did not deliver it again (one entry in the session file) | local (tmux) | pass | acceptance |
| `piEnv.agent.maxMinutes: 1`, a background worker told to run `sleep 20` ten times: at 60 s the log has `wrap-up: Time limit: 1 min (piEnv.agent.maxMinutes) reached`; the child stopped after 3 sleeps and wrote `Status: partial` with what was done, 78 s after start (before the stop 2 minutes later); delivered to the parent | local | pass | acceptance |
| Provider quota used up: `pi -p` ends the turn with `Claude quota exceeded — rate limit (five_hour) — resets <time>: You've hit your 5-hour limit · resets <time>`; no retry | Haiku (history) | seen | #100 |
| The lead starts a scout (`wait: true`) while the quota is used up: the tool returns `scout-1 (scout) failed — Claude quota exceeded …` and "Provider quota used up: nothing is lost. After the reset, resume it: agent resume scout-1 (or /agents)"; `state.json`, `events.log` and the child's session file stay in its run folder; the lead reports it and goes on | local lead, Haiku (history) scout | pass | #100 |
| `pi --continue`, then `agent resume scout-1`: the run is found and restarted in its own session (`resume:` line in `events.log`); it failed again with the same message (the window had not reset) | local lead, Haiku (history) scout | pass (mechanics); the resume after the reset is unit-tested with a fake child | #100 |
| Panel before the fix: an overlay of fixed height stays put while the chat grows, also while the model streams (two repro extensions) | local; Haiku for the streaming repro | pass: pi keeps overlays screen-relative | #77 |
| Panel before the fix, on a running child: its top row moved from 11 to 6 as the child's transcript grew (the overlay is centred by its height) | local | reproduced | #77 |
| Panel after the fix: fixed height; list and child view both span rows 5 to 46 at every capture (6 captures over 90 s while the chat grew and the child finished) | local | pass | #77 |
| A worker child: `/skill:github-delivery …` still expands (its skill is loaded) | Haiku (history) | pass | #76 |
| The guard in a worker child blocks `sudo ls /root` (strict, no user) | Haiku (history) | pass | #76 |
| `npm run check`: skills per agent; an unknown skill is an error | none | pass | #76 |
| Code mode (`--tools +codemode`): one script runs `agent run` on a scout (claims with lines, JSON Schema), then two reviewers in parallel (`Promise.all`, verdict schema), and returns a JSON array; the `sub` bug is confirmed | local | pass (112 s script wall time) | #18 |
| The same find-then-refute with the model calling `agent run` itself, for the token comparison in `docs/settings.md` | local | pass | #18 |
| `fork: true`: the child knows a code word said only in the parent's conversation | local | pass | #18 |
| `fork: true` on the Claude bridge: same answer; first turn 6.8K tokens cache write (uncached, as expected) | Haiku (history) | pass | #18 |
| `files: [calc.js]`: the child quotes line 2 in one turn with no tool call | local | pass | #18 |
| 8 scouts started in one turn: 6 start at once, the other 2 when slots free; all 8 reports arrive once; the parent gets one turn, after the last | local | pass | #17 |
| `/agents limits running 1`, then a worker (`wait: true`) that starts 2 scouts: the worker holds the only depth-1 slot, its scouts run one after the other in the depth-2 pool; no deadlock; the worker reports both | local | pass | #17 |
| Terminal: a scout calls `ask_parent`; a notice names it, the footer shows `1?`; `/agents` opens on that child with the question; the typed answer reaches it and its report uses it | local | pass | #16 |
| Terminal: a worker runs `sudo ls /root`; the owner gets the dialog `[sudoer-1] guard: runs with elevated privileges`; "No" blocks it in the child, which reports `blocked` | local | pass | #16 |
| Terminal: `ask_user` with two options shows the dialog (recommended first, free text last); the choice comes back to the model | local | pass | #16 |
| RPC (no terminal): the question goes to the parent model, which answers with `agent reply`; the child continues | local | pass | #16 |
| Footer line 3 shows `agents 1▶` while a child runs and nothing after it ends | local | pass | #15 |
| `/agents`: list with id, agent, state, model, tokens, last action; Enter opens the child's live transcript (tool calls, result heads, text) | local | pass | #15 |
| Typed "Stop reading … add the line STEERED" + Enter: the message appears in the transcript, the child ends its report with STEERED | local | pass | #15 |
| Ctrl+X once only arms; Ctrl+X again stops the child (`stopped`); its result is added without a parent turn | local | pass | #15 |
| `/reload` with the panel's code changed, then a new scout and the panel again | local | pass | #15 |
| Esc goes back to the list, then closes the panel | local | pass | #15 |
| A scout writes a report longer than 30,000 characters (it stopped at 53K characters on the old default timeout): `report.md` holds the whole text; the parent got the first 30,000 characters cut after line 1,110 with "Read <path> from line N"; asked for the end, it read the file and quoted the last line | local | pass | #14 |
| A background scout reports, the parent quits; `--continue` reopens the session: no result is delivered again | local | pass | #14 |
| `agent resume quick-1` in the reopened session continues the child in its own session file (it still knew its first answer) | local | pass | #14 |
| Local child (`worker`, `wait: true`) told to run `git push origin main`: the guard in the child blocks it (strict run, no user); the report says so | local | pass | #13 |
| The repo's `.pi/extensions` load in the parent (trusted) and not in the child (`--no-approve`) | local | pass | #13 |
| Claude bridge child: `scout` on a throwaway profile; report returned; the child session shows the bridge model and level `low` | Haiku (history) | pass (2.6 s, 5.7K tokens cache write) | #13 |
| Codex child: `scout`; report returned | Codex small | pass | #13 |
| A background `scout`, then `/reload` (by an extension command; RPC has no `/reload`): the child keeps running, its report arrives once, after the reload, and starts one parent turn | local | pass | #13 |
| Quit with a live child: it is marked `interrupted`, its process is gone | local | pass | #13 |

The parent ran on the local model in every #13 test. Setups: #77 pi in tmux (170 × 50), the lead
starts a background scout and writes 90 lines while `/agents` is open on it. #15 and #16 pi in tmux
(170 × 50), scratch repo with a copy of `docs/`. #18 scratch repo with a 3-line `calc.js` (`sub`
adds). #100 lead local, scout on Haiku while the Claude 5 h window was used up (101 %).

Unit tests (#100): a fake child refused for quota fails with the resume line and resumes to `done`;
a new child starts whatever the quota file says; `isQuotaError` on the observed texts.

Found and fixed:
- #77: the cause was the panel's own height, not pi's overlay API; no pi limit to document.
- #18: a forked child sees the parent's pending `agent` call without a result; the providers accept
  it, and one child mentioned it as an open question. (Finding, not a fix.)
- #16: the first build opened the panel by itself when a child asked. It took the keys the owner was
  typing (a prompt went into the panel and resumed a finished child), and the overlay scrolled up
  while the chat grew. Now only a notice and the footer count appear.
- #15: a child that replied without a report got the reminder "do no more work" and gave up; the
  reminder now says to continue the task if it is not finished. The overlay did not hide the text
  under short lines; lines are now padded. Seen, not fixed: a local scout that read 10 long reviews
  failed with "Context size has been exceeded" (98K window); the report says so.
- #14: the report of a timed-out child is kept, and its header shows `timeout`.
- #13: a child that settled in the same stdout read as the prompt response was never seen as
  finished (the waiter was added too late).

## Skills

Skill count now: 14 skills, 8 of them model-picked (#113: `grilling` inside `work-planning`, one
`github` skill from `github-tracking` and `github-delivery`, `prototype` owner-invoked). Rows before
#113 use the old names.

### After the merge (#113, #137)

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `eval code-review` (planted money bug and over-engineering; checks first, fresh reviewers, no edits) | lead | 7/7, 2.0 min, lead 181K sent, children 77K | #137 |
| `eval web-research` | lead | 5/5, 0.5 min, 71K sent | #137 |
| `eval spec-review` (zoom-out first, the planted contradiction) | Sonnet, medium | 4/4, 0.9 min, 61K sent, children 15K | #137 |
| `eval github` (implement an issue, `stop local`, tracking `github`) | lead | 5/5, 0.6 min, 83K sent | #113 |
| `eval github-plan` (GitHub objects for a 3-slice plan; no `gh` call) | lead | 5/5, 0.7 min, 40K sent | #113 |
| `eval work-planning` (tracking `local`; no `printenv`) | Sonnet, medium | 4/4, 0.9 min, 68K sent | #113 |
| `eval work-planning-grill` (`/skill:work-planning grill …`) | Sonnet, medium | 4/4, 0.5 min, 38K sent | #113 |
| `eval prototype` (`/skill:prototype …`) | Sonnet, medium | 3/3, 0.3 min, 22K sent | #113 |
| `--load-only`, the 8 model-picked cases | lead | 8/8 loaded, each in the first request (about 8.5K sent each) | #113 |

Check fixes (the case was wrong, not the skill): `work-planning-grill` read the repo with `bash`, and
the check named only `read` (3/4 first); the "fresh reviewer" checks of `code-review` and
`spec-review` looked for the removed `"role"` argument (6/7 and 3/4 first, with the children
started). The routing test (TF-IDF) was removed in #113 ([decisions.md](decisions.md)).

### Loading of model-picked skills

`eval.mjs --load-only` on the 10 model-picked cases, one run per cell (one cell is noise; read the
totals). Cell order: diagnosing-bugs, tdd, codebase-design, prototype, frontend-design,
browser-check, code-review, web-research, github-tracking, github-delivery (`p` loaded, `F` not).
"Skill lines" = the "Skills" section in `AGENTS.global.md` added in #90 and kept.

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| With skill lines | lead | `pppppppppp` **10/10** | #108 |
| With skill lines | Sonnet, high | `pppFpppFpp` 8/10 | #108 |
| With skill lines | local, medium | `pppppppppp` **10/10** | #90 |
| With skill lines | Sonnet, low | `pFpFpppFFF` **5/10** | #90 |
| With skill lines (prototype, web-research, github-tracking, tdd) | lead | `pppp` **4/4** | #90 |
| Trigger words first in the descriptions (reverted) | local, medium | `pppFpppFpF` 7/10 | #90 |
| Trigger words first | Sonnet, low | `FFpFppFFFF` 3/10 | #90 |
| Trigger words first | Sonnet, high | `FppFpppFpp` 7/10 | #90 |
| Before #90 | local, medium | `pppFpppppF` 8/10 | #90 |
| Before #90 | Sonnet, low | `FFpFppFFFF` 3/10 | #90 |
| Before #90 | Sonnet, high | `pppFpppFFp` 7/10 | #90 |
| Before #90 (prototype, web-research, github-tracking, tdd) | lead | `FFpp` 2/4 | #90 |

#108: not loaded on Sonnet high: `prototype` (the case asks a spike question; the model answers it
directly) and `web-research` (it reads the installed source first, which is the skill's own first
step). Every skill loads on the lead, so none is changed.

#90 changes, one at a time:
1. Descriptions with the trigger words first ("Use when … " before what the skill does), same words:
   no gain (26 → 22 of 50 over the five rows; noise). Reverted.
2. One "Skills" section in `AGENTS.global.md`: when a description matches, read the skill first,
   with one short line per kind of work. Gain on every model measured. Kept. Where a skill loaded, it
   was in the first request, before any other tool call.

**Routing** (`tests/skill-routing.test.mjs`, in `npm run check`, #27): 10 model-picked skills, 39
trigger prompts, 20 prompts of other skills: all pass, no pair of descriptions 0.5 or more similar.
First run: 7 misses, from three causes: a stemmer that turned "modules" into "modul" (fixed), prompts
whose words no description had (rewritten to how people ask), and `web-research` lacking "supports"
(description now "Look up what a library or API supports, …").

### Eval scores

`tests/live/eval.mjs`, one case per skill, 16 cases, each a small scratch repo. Value = score, then
tokens: lead sent / subagents (subagent counts only from the runner fix onward). Loading notes in the
#27 rows predate the #90 skill lines.

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| tdd, after its text change | local | 5/5 (3.5 min, 334K sent) | acceptance |
| browser-check | Sonnet, low | 3/3, 34K | #27 |
| code-review | Sonnet, low | 6/7 (loaded, reviewed alone), 39K; rerun after the "always a finder" rule: 4/7 (not loaded), 19K | #27 |
| code-review | local | no eval run; live check #25: all found, 2 finders + 3 refuters | #27 |
| codebase-design | Sonnet, low | 4/4, 33K | #27 |
| codebase-design | local | 4/4, 34K | #27 |
| diagnosing-bugs | Sonnet, low | 2/4 (not loaded, edited before showing the bug), 67K | #27 |
| diagnosing-bugs | local | 4/4, 155K | #27 |
| frontend-design | Sonnet, low | 4/4, 147K | #27 |
| github-delivery | Sonnet, low | 4/5 (not loaded), 46K | #27 |
| prototype | Sonnet, low | 2/4 (not loaded; empty final message), 9K | #27 |
| tdd | Sonnet, low | 4/5 (not loaded), 76K | #27 |
| web-research | Sonnet, low | 4/5 (not loaded), 37K | #27 |
| web-research | local | 5/5, 61K | #27 |
| github-tracking | Haiku (history) | 5/5, 41K | #27 |
| grilling | Haiku (history) | 3/4 (asked before reading `orders.js`), 38K | #27 |
| repo-setup | Haiku (history) | 4/5 (did not open CONTRIBUTING with `read`), 40K | #27 |
| security-audit | Haiku (history) | 6/6: run folder outside the repo, agents, both checks PASS, injection found, false lead not reported, repo unchanged; 6.2 min, 1.45M (mostly cache) | #27 |
| spec-review | Haiku (history) | first run stalled on `ask_user` (the runner did not answer dialogs; fixed); then 3/4 and 2/4 on two check bugs (fixed); then 4/4, 132K / 20K | #27 |
| work-planning | Haiku (history) | 4/4, 105K | #27 |
| writing-for-agents | Haiku (history) | 3/3, 83K | #27 |

Checks fixed after the first #27 runs (the case was wrong, not the skill): test summaries grepped
instead of `tail`; spec-review's order check (zoom-out stops the panel on a blocker, so no second
reviewer follows) and its text checks moved to the transcript (the final message came after the
owner's answer); the runner now answers dialogs (first option, which `ask_user` makes the recommended
one) and reads subagent tokens from the run ledgers.

### github-delivery

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `--tracking milestone --stop milestone`, one prompt "Deliver the milestone …", after the skill change below | Sonnet (all roles, lead `high`) | pass (milestone "delivery live 4"): PR #42, milestone closed, release `v0.4.0`, run report, demo | #108 |
| Same, before the skill change | lead | pass (milestone "delivery live 3"): PR #40, milestone closed, release `v0.3.0`, run report, demo | #108 |
| Same, before the skill change | Sonnet (all roles, lead `high`) | milestone "delivery live 2": issue delivered (PR #38), milestone closed, run report, demo; **no release** although the repo has `v0.x` releases | #108 |
| `--stop pr`, "Deliver issue #12" | Haiku (history) | first run: the guard asked `issue-required` for `gh pr create -F /tmp/pr-body-12.md` whose body file was written by a here-document in the same command line (it did not exist yet when the guard read it). Fixed: the whole command line counts. Rerun ("continue"): commit with `Refs #12`, push, draft PR #16 with evidence before/after and `Closes #12`, `gh pr checks` (none), `gh pr ready`, stopped: "no merge, since the mode is stop pr". No dialog | #32 |
| `--stop merge`, same issue, "Deliver issue #12 to the end" | Haiku (history) | first run: merged with `--match-head-commit "$sha"` (the skill's own example used a variable): the guard asked `merge-head`. Fixed: the skill writes the sha out; the guard says "give the commit sha itself". Second run: checks inside `(npm run check; echo EXIT=$?) \| tail`, which proves nothing; the guard asked again, now with the fix in its message. Third run, owner says "do what the guard message says": `npm run check` alone, merge with the literal sha, no dialog; issue #12 closed; `pi-env tidy 16` removed worktree, local and remote branch | #32 |

#108 skill change: step 9 was one sentence; it is now five ordered steps (done-check, close,
`gh release list` and the next `v0.x` release when the repo has them, run report, demo). In every
milestone run the guard asked before the milestone `PATCH` and `gh release create` (answered yes):
inside `stop milestone` these are expected steps; left as they are.

#32 setup: scratch repo (ruleset: PR required), issue #12 from the #30 test, `--tracking issue`,
`review` off, confirms answered "no". The local model ran first at `--stop pr`: it read the skill,
the mode and the issue, made the worktree with `gh issue develop`, wrote a failing test and the code,
then stopped with "Context size has been exceeded" before the push; the checks then ran on Haiku.
Also fixed in #32: the merge rule needed the verify gate's receipt, which comes only at the end of a
turn, so a build-and-merge in one turn always asked. A passing run of the verify command by the
agent now counts for the tree it ran on. Quota use: 4 short runs, about 250K tokens sent, mostly
cache.

### grilling

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `/skill:grilling I want greet to accept --shout …` | lead | pass: restated what it found, a numbered round (Q1 sequencing, Q2 exact output …) each with a recommendation, no file changed | #108 |
| `/skill:grilling I want greet to accept --shout …` | Sonnet (all roles, lead `high`) | pass: read the repo and issues, asked one blocking question (does `--shout` wait for #13), no file changed | #108 |
| Reads the territory before asking; restates the goal | local | yes: read all 7 files; listed known knowns (no status field, no auth, no payments) | #23 |
| Relentless style by default: the whole frontier in one numbered round, each with a recommendation that "yes" accepts | local | yes: Q1 identity, Q2 state model, Q3 side effects | #23 |
| Next round recomputed from the answers | local | yes: Q4 handler shape (shown as a sketch), Q5 repeat cancel, and the low-risk rest as assumptions A1–A6 to veto | #23 |
| No facts asked of the owner; nothing built | local | yes; no file changed | #23 |

#23 setup (grilling and work-planning): throwaway agent dir, the scratch order repo from #24,
owner-invoked with `/skill:<name>`. grilling: `--tracking none --stop plan`, prompts
`/skill:grilling I want customers to be able to cancel an order.`, then "Yes to all your
recommendations."

### work-planning

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Reads the session mode first | local | yes (`printenv PI_ENV_MODE`) | #23 |
| Facts by itself, then one round of decisions with recommendations and rejected options | local | yes: 4 decisions, 2 labelled assumptions | #23 |
| Scale chosen and said | local | "small, one session": one vertical slice | #23 |
| Seam and acceptance checks agreed before code | local | yes: the existing function seam (catches / misses), V1–V4 lines with `Check:`, one done-check | #23 |
| Plan in the harness plans folder, not in the repo | local | yes: `scripts/plans-dir.mjs`, then `…/projects/scratch-design-<hash>/plans/2026-11-12-customer-cancel-order.md`; repo unchanged | #23 |
| Written for another agent: decisions, deviation policy, approval line | local | yes | #23 |
| `stop` is `plan`: builds nothing | local | yes | #23 |
| Plan review (`planReview` optional) | local | offered, skipped as small and reversible | #23 |

Setup: `--tracking local --stop plan`, prompts `/skill:work-planning Customers can cancel an
order.`, then "Yes to all your recommendations. Write the plan." Both #23 skills are owner-invoked,
so their descriptions are not in the always-loaded context.

### code-review

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `--rigor strict` (`review: pr+second`) on the planted SAVE10 change, then "fix the confirmed findings, run the next round" | local (`second`: gemma-4-26b-a4b, seen in the child's session) | pass: round 1 with 3 finders (defects, spec+lean, defects on `second`) and 3 refuters; fixes committed on `feature` (SAVE10 now gives 540 for 600); round 2 on the fix diff with 3 finders (again one on `second`) and a refuter; round 3 with one finder; clean. 34 lead requests, 1.46M tokens sent, about 75 min with the model swaps | acceptance |
| Same, with no `second` in the profile (by mistake, first) | local | the finder failed at once with `role/second: no model in profile "local"; use /role second <model>`; the lead reported it | acceptance |
| Loads the skill | local | yes, and the finders reference | #25 |
| Checks first, intent pinned, files outside the repo | local | yes: `npm test`, `/tmp/review.*` with diff and intent | #25 |
| Fresh finders, refuters per serious finding | local | 2 finders (defects; spec + standards + lean), 3 refuters; one finder asked the parent for git through `ask_parent` (reviewers are read-only) | #25 |
| Planted bug found | local | yes, blocker, reproduced (-9000 for 1000) | #25 |
| Over-engineering found | local | yes, "Lean: -40 lines", grep of every caller | #25 |
| Test gap found | local | yes, "suite green on the broken math" | #25 |
| Short, checkable findings and a verdict | local | yes: F1–F3 with case, fix, if-we-skip-it; callouts; not checked | #25 |

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| code-review tokens | local | lead 354K sent / 18K out; finders 41K + about 45K in, refuters about 30K each | #25 |

#25 setup: repo with a cart total; branch `feature` for issue #7 ("SAVE10: 10 % off, rounded to whole
cents") with a planted bug (`PercentDiscount(10)` multiplies by 10, so totals go negative) and a
planted over-engineered change (a strategy base class, a registry with `register`/`unregister`, two
options nobody sets, four tests of the plumbing that miss the bug). Agent tokens are from the agent
headers.

### spec-review

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Short plan → `zoom-out` first, alone | Haiku (history) | yes | #25 |
| Contradiction found | Haiku (history) | yes, blocker, both lines quoted | #25 |
| Stops the panel on a zoom-out blocker and asks the owner | Haiku (history) | yes: "the other reviewers did not run, so this is not a clean round" | #25 |
| Resolution with decisions | Haiku (history) | 6 findings, each with a decision (the contradiction escalated to the owner) | #25 |
| Report outside the repo | Haiku (history) | no: written next to the plan inside the repo (untracked). The skill now says: always in the harness plans folder | #25 |
| Tokens | Haiku (history) | lead 302K sent; reviewer about 19K in, 3K out | #25 |

Setup: owner-invoked; a one-page plan for session expiry with a planted contradiction (Behaviour:
30-minute idle timeout; slice 2: 24 hours with no idle timeout).

### security-audit

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Run folder outside the repo | Haiku (history) | yes: `check-audit.mjs new-run` → harness work folder `reports/security-audit/run-1` | #25 |
| Recon, hunters, critic, verifiers as agents, within budget | Haiku (history) | 8 agents, all done (each about 15–50K in with cache) | #25 |
| Command injection found | Haiku (history) | yes, critical, confirmed | #25 |
| False lead not reported | Haiku (history) | yes: "the `/uploads` sort path is safe" | #25 |
| Also found | Haiku (history) | crash of the process on a failing `convert` (high), `../` in `file` (low), `execSync` blocks the event loop (medium) | #25 |
| `findings.json` and `ledger.json` pass the check | Haiku (history) | the first ledger had no ids by the rule and owner-less covered units; the check caught them (`expected an array`, `id: expected …`, `covered needs an agent`); fixed; both PASS | #25 |
| Honest status | Haiku (history) | `incomplete` for budget, two critic gaps deferred, "nothing was run, no sandbox" | #25 |
| Tokens | Haiku (history) | lead 1.05M sent (mostly cache reads) / 31K out | #25 |

Setup: owner-invoked, audit depth `quick`, budget 8 agents. A 30-line public HTTP service:
`/thumb?file=` concatenated into `execSync` (real command injection); a comparator built with `new
Function` from a sort key (false lead: only keys of a fixed map reach it). Changed after the run: the
"confirmed" records rested on source alone (no sandbox); the skill now says when that is allowed
("Source-established", the language decides the result) and when it must be `needs_validation`.

### repo-setup

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Bootstrap, dry: the read-back commands of the recipes on the scratch repo (repo view, merge settings, `gh ruleset check main`, labels, milestones) | none (by hand) | pass: squash only, auto-delete on, auto-merge on, 3 rules (`deletion`, `non_fast_forward`, `pull_request` with 0 approvals), `needs-owner` and `ready-for-agent` present. GitHub now lists more `pull_request` parameters (`allowed_merge_methods`, `required_reviewers`, `require_extra_approval_for_unattributed_changes`); the recipe's five still work | acceptance |
| Enter: whose repo first | local | yes: "foreign entry (READ)" | #31 |
| Enter: rules, templates, CODEOWNERS, checks, history, other people | local | yes: no CONTRIBUTING/templates/CODEOWNERS; `security.md` "No AI slop"; their `AGENTS.md` rules (`null` never accepted); CI matrix and local `npm test`; maintainer commits straight to main, small PRs merged by the owner; maintainers named; retry issues all closed | #31 |
| Enter: plan in their terms | local | yes: open a bug issue first, fork (`gh repo fork --remote`), `fix/<topic>` from `upstream/main`, one small PR; check recent retry commits before filing | #31 |
| Enter: no writes to the repo | local | yes; note saved in the harness work folder, not in the repo | #31 |
| Enter: `scout` agents | local | 4 started; they had no shell tool (the `scout` role reads files only) and asked the parent, which stopped two and did the `gh`/`git` reads itself | #31 |
| Bootstrap, first run | local | merge settings right (squash only, auto-delete on, auto-merge on); labels right; but the ruleset was sent without its `conditions` block and with an empty `pull_request` rule, so it applied to no branch. The model concluded the API "rejects" `pull_request`, and tested by pushing a probe commit to `main` (removed again by a PR). AGENTS.md proposed as a diff, not committed | #31 |
| Bootstrap, second run (settings reset first, after the skill fix) | local | settings right and read back; `gh ruleset check main`: 3 rules (`deletion`, `non_fast_forward`, `pull_request` with 0 approvals); labels `needs-owner`, `ready-for-agent`; milestones and Project left alone; AGENTS.md as a diff for the owner, not committed | #31 |

#31 setup: owner-invoked (`/skill:repo-setup …`), default mode (`issue · pr · standard`). Enter: a
public repo (`sindresorhus/ky`, cloned, permission READ; confirms answered no), prompt "Enter this
repo. I may contribute a fix for a retry bug later." Bootstrap: the scratch repo "as if new" (owner,
solo, private; confirms answered yes; "yes to all, except no CI and no templates"). Skill fix after
the first run: send the recipe JSON as is, `conditions` is required, `pull_request` needs all five
parameters, "0 rules apply" means the ruleset is wrong, never test by pushing to the default branch.
Checked by hand first: the recipe ruleset on the private user repo refused a direct push to `main`
("push declined due to repository rule violations"). `gh ruleset check` works for a reader; classic
branch protection gives 404 to a non-admin.

### github-tracking

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| The skill is picked by the model | local | yes: read `SKILL.md`, then the recipes file | #30 |
| Reads the mode and the existing tracking first | local | yes: mode, remotes, `gh` auth, milestones, labels, Project, its fields and items | #30 |
| Milestone with a done-check, no invented due date | local | yes: `greet command`, "Done when: `greet --name Alice` prints …"; no due date "(none is real)" | #30 |
| Issues with acceptance lines, out of scope, no file paths; edges 12 ← 13 ← 14 | local | yes, read back: milestone, type Task, `blockedBy` [] / [12] / [13] | #30 |
| Reuses the existing Project and labels; no parent issue without a reason | local | yes: items added to `scratch product`; `documentation` label reused; no parent, with the reason | #30 |
| Frontier from dependency data | local | yes: #12 | #30 |

Setup: `--tracking project --stop pr`, confirms answered yes, scratch repo with milestone `M1 Recipes
check` and Project `scratch product` already there. Prompt: an agreed 3-issue plan (parse
`--name`; print, blocked by 1; README, blocked by 2), "set it up as the tracking mode says, read it
back, give me the frontier, no code".

Recipes, run by hand on the scratch repo and a scratch user Project: milestone with a due date; issues
with `--milestone --parent --blocked-by --type` in one call; read back sub-issues, blockers and the
dependency summary; Project created, linked, two fields, `In review` added to Status, three items with
status and date, a status update, a board view; all read back. Findings, now in the reference file:
- `due_on=…T00:00:00Z` is stored as the day before; `T12:00:00Z` keeps the date.
- `gh project link --owner @me` fails ("different owner"); the login works.
- `updateProjectV2Field` keeps option ids when the full list carries them.
- `gh repo view --json projectsV2` prints the list under `Nodes`.
- A new Project item got `Status = Todo` at once.
- Field type `MULTI_SELECT` exists; status values also `INACTIVE` and `COMPLETE`.

Found and fixed: the guard asked before every `gh api graphql` read (a GraphQL query is a POST); a
`query` with no `mutation` now passes, a mutation or a query from a file still asks. The model hit a
`jq` error on `.subIssues[]` (it is `{nodes}`); the reference file states the shape.

### prototype, browser-check, frontend-design, writing-for-agents (#26)

Setup: `--tracking none --stop local`, one scratch repo per skill. Prompts for model-picked skills do
not name the skill.

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `scripts/browser --version` prints the pinned 0.1.24 (new unit test) | none | pass | #26 |
| prototype: loads the skill and the logic reference on its own | local | yes | #26 |
| prototype: logic demo, one HTML file, question at the top, pure module apart from the page | local | yes: `Refunds` module with no DOM access, labelled state panel, free play, five scenario tabs | #26 |
| prototype: throwaway branch, named as a prototype; main untouched | local | yes: branch `prototype/refund-rules`, `src/refund-rules.prototype.html`, one local commit | #26 |
| prototype: no tests, no persistence | local | yes | #26 |
| prototype: checked before hand-over | local | yes: drove every scenario in the headless browser, found and fixed a step that did not advance, checked again | #26 |
| browser-check: loads the skill on its own | local | yes, after it had read the 4-line script and fixed the typo | #26 |
| browser-check: real browser on a local static server, files outside the repo | local | yes: `python3 -m http.server` on 127.0.0.1, sessions `signup-fix` and `signup-verify`, files in `/tmp/pi-env/browser/<session>/`; repo has only the fix | #26 |
| browser-check: same steps after the fix show the expected state; console read | local | yes: fill, click, `find` shows "Thanks, …"; only the favicon 404 in the console | #26 |
| browser-check: session closed, server stopped and checked | local | yes: port no longer answers | #26 |
| frontend-design: loads the skill on its own, then `browser-check` | local | yes, both | #26 |
| frontend-design: uses the project's tokens, no new values | local | yes: `--surface`, `--border`, `--radius`, `--space-*`, `--muted` | #26 |
| frontend-design: empty state that says what the area is for | local | yes: "No orders yet / When customers place orders, they will appear here"; the table is hidden | #26 |
| frontend-design: checked in a browser at two widths, filled state not broken | local | yes: screenshots at desktop and phone width read; a copy with two injected orders still renders rows | #26 |
| frontend-design: files outside the repo | local | scratch copy in a sibling folder, removed; repo has only the three edits | #26 |
| writing-for-agents: loads by `/skill:` | local | yes | #26 |
| writing-for-agents: finds the `: ` trap and proves it | local | yes: ran pi's loader on the old file (0 skills, "Nested mappings…") and on the new one (1 skill, no warnings) | #26 |
| writing-for-agents: roles not models; no-ops; method not choreography; repo comes first | local | yes: all removed, with the rule each one broke | #26 |
| writing-for-agents: bans turned into targets; one meaning in one place | local | yes: "skip any labelled `internal`", "write short, plain sentences" | #26 |
| writing-for-agents: completion criteria per step; Sources section | local | yes | #26 |

Prompts: prototype: Node repo with `placeOrder`, `pay`, `cancel`, no refunds; refunds in several parts,
never more than paid, a cancelled unpaid order cannot be refunded; "give me something I can click
through to check these rules". browser-check: static site whose sign-up form shows no message (the
handler writes to a mistyped element id); "the sign-up form does nothing when I click Sign up… find
out why and fix it". frontend-design: static orders page with design tokens in `styles.css` and an
empty table; "a new shop with no orders sees only an empty table header. Make that screen right for
them." writing-for-agents: a draft skill with a `: ` in its description, a model id and reasoning
setting, "think step by step… double-check", files written into the repo, a fixed output path, three
"do not" rules and a repeated `package.json` fact; `/skill:writing-for-agents Review the draft skill …
rewrite it so it follows these rules.`

Findings (#26): two earlier prototype runs did not finish: one hit the local model's context limit
while generating; in the other a parallel build's cleanup deleted the shared `/tmp/pi-env-agent.*`
dir mid-run. The agent stopped its static server by `$!`, which was the wrapper shell's id, so two
servers stayed up (stopped by hand); `browser-check` now says to check that the port no longer
answers.

### diagnosing-bugs, tdd, codebase-design (#24)

Setup: `--tracking none --stop local`, one scratch repo per skill. The prompts do not name the skill.

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| diagnosing-bugs: loads the skill on its own | local | yes, first tool call | #24 |
| diagnosing-bugs: a command that shows the bug before any edit | local | yes: printed `total: 4500` | #24 |
| diagnosing-bugs: ranked hypotheses shown before probing | local | no: it read the cause from the 5-line function and said so | #24 |
| diagnosing-bugs: shrink the repro | local | not needed (one-line input) | #24 |
| diagnosing-bugs: regression test fails first, for the right reason | local | yes: `3600 !== 5400` | #24 |
| diagnosing-bugs: fix in the shared function, one test, literal expected values | local | yes: one new test, `5400` and `6300` | #24 |
| diagnosing-bugs: original scenario run again after the fix | local | yes: `total: 6300` | #24 |
| tdd: loads the skill on its own | local | yes | #24 |
| tdd: finds the repo's test command | local | yes (`node --test`, checked the Node version) | #24 |
| tdd: seams agreed before tests | local | stated the single seam and went on, calling "test-first" the go-ahead; the skill now says that a one-seam case may go on and that "test-first" alone is not agreement | #24 |
| tdd: vertical slices, each red for the right reason | local | yes: 5 slices, each run red then green | #24 |
| tdd: few, meaningful tests | local | 5 tests (28 lines) for 19 lines of code; literal expected values, no mocks, no tautologies; the fifth (alpha before beta) is a behaviour nobody asked for | #24 |
| tdd: full suite with the repo command; commit within `stop` | local | yes; one local commit | #24 |
| codebase-design: loads the skill and the survey reference | local | yes, both | #24 |
| codebase-design: scope by history | local | yes: found the commits that touch the handler | #24 |
| codebase-design: deletion test, vocabulary used exactly | local | yes: "shallow", "locality", "leverage", "one adapter is a hypothetical seam" | #24 |
| codebase-design: candidates with files, problem, change, gains, dependency category, strength | local | yes: 3 candidates (collapse the intake pipeline: strong; pass-through repo: worth exploring; admin/staff term: worth exploring) and a top recommendation | #24 |
| codebase-design: no interfaces proposed; asks which candidate to explore | local | yes | #24 |
| codebase-design: `scout` agents | local | not started (the `agent` tool was not built yet); it said the 63 lines were small enough to read whole | #24 |

Prompts: diagnosing-bugs: Node repo where `parseDuration("1h30m")` drops the minutes; "our schedule
total is wrong: 1h30m and 15m give 4500 seconds instead of 6300". tdd: empty Node repo; add
`compareVersions(a, b)` (fewer parts equal zeros; a pre-release sorts before its release), "build it
test-first". codebase-design: Node repo with an order pipeline split into four one-line modules, a
pass-through repository wrapper, a duplicated admin handler, and history touching the handler; "Where
does the structure of the orders code hurt, and what would you change? Do not change code yet."

Found and fixed (#24): before the first run the model listed only two skills: a `: ` in the
`codebase-design` description made pi's YAML parser drop it, with only a start-up warning.
`tests/skills.test.mjs` now loads the folder with pi's own loader and fails on any warning.

## Runner and tidy

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `pi-env run pe136 --stop milestone` on a milestone with no open issue, three times (the third with the ledger removed, as from another checkout) | none | run 1 closed the milestone and cut `v0.5.0`; runs 2 and 3 wrote nothing. Found on the way: 5 s after the release, GitHub's release list did not show it yet, so the marker alone let run 2 try `v0.5.0` again (HTTP 422); the ledger now records the release first | #136 |
| `pi-env run 49 --stop local` on a terminal | local | start line `budgets with no limit: …`; OSC 7501 `working` at the start, `done` at the end; end line `tokens: #49 64K; total 64K`; `pi-env status` prints the same `tokens:` line | #112 |
| Found and fixed: after #135 `pi-env run` started `bin/pi-env` itself as the worker (0 turns); outside pi the child is now `pi` from PATH (unit test) | local | pass after the fix | #112 |
| Review cost of one small PR at the defaults (`stop pr`, `standard`), the same kind of issue | local | before: worker 71,040 + reviewer 28,154 tokens, 101 s; after (`review: auto`, no reviewer at `stop pr`): worker 74,661, 47 s | #110 |
| `pi-env run 43 --stop local` on a clone with a hostile `.pi/settings.json`, seen as a foreign repo: start line `… is not your repo: its .pi/settings.json is ignored`; worker built and committed; `PWNED` not created; the hostile `workDir` not created | local | pass (9 turns, 79K tokens, 43 s) | #109 |
| The same repo as your own (`--dry-run`): its `workDir` applies | none | pass | #109 |
| Unit: a foreign repo ignores setup and `workDir`; an own repo runs setup, its `workDir` wins over the global one; `pi-env status` finds that ledger; `--profile` wins over the session's role map | none | pass | #109 |
| `pi-env run "greet command" --dry-run` | none | pass: digest and frontier `#13` | user pass |
| `pi-env status`, `pi-env status "greet command"` | none | pass. With no run yet: "no run yet; name a target" | user pass |
| `pi-env tidy --all-merged --dry-run` | none | pass | user pass |
| Fix round: `PI_VERIFY` pointed at a script that, only in the runner (not in the worker's own gate), also asks for a first line `// rt: <name>` the issue does not mention. Issue #29: worker 1 passed its gate, the runner's verify failed, a fix-round worker got the failure tail, added the line, verify passed, reviewer, merged (PR #32) | Haiku (history) | pass. The rerun showed "fix round 2" because the first attempt (before #101) stopped on the old quota stop with "fix round 1" counted; since #101 a refused round is not counted | acceptance |
| `kill -9` of `pi-env run 30 --sandbox always` while the worker ran in its container: container and egress proxy gone with it, worktree and the worker's commit kept; rerun: attempt 2 on the same worktree, reviewed, merged (PR #33); no container, network, worktree or branch left | Haiku (history) | pass | acceptance |
| `pi-env run 31 --away --rigor strict --stop merge` (no `--sandbox` flag): the strict preset put the worker in the sandbox ("workers in the sandbox"), PR #34 merged, nothing left | Haiku (history) | pass | acceptance |
| #18 delivered: worker, verify, draft PR, reviewer, merge on the checked head, issue closed, tidy | Haiku (history) | pass (PR #21; 7 turns, 83K tokens, 33 s) | #34 |
| `kill -9` of the runner during #19's review (draft PR #22 open); rerun reused PR #22, reviewed and merged it; no second PR | Haiku (history) | pass | #34 |
| #20 cannot pass its check: the worker reported `Status: blocked` with the conflict; label `needs-owner`, one comment, no commits kept; the run went on and stopped with "only blocked or waiting work is left" | Haiku (history) | pass | #34 |
| `kill -9` during #23's worker (no commits yet); rerun: attempt 2 on the same worktree, merged (PR #24) | Haiku (history) | pass (attempts 2, 8 turns, 99K tokens, 33 s) | #34 |
| A third run: nothing to do, no new comment (still 1 on #20), PR or merge | Haiku (history) | pass | #34 |
| Worker and reviewer processes ended with the killed runner (no orphan `pi` left) | Haiku (history) | pass | #34 |
| `pi-env status`: done #18 #19 #23 with PRs, blocked #20 with its reason, next none, last run's stop reason | none | pass | #34 |
| `status --post` twice on a test Project linked to the repo: one `AT_RISK` update (the second was skipped as equal) | none | pass | #34 |
| Milestone "runner live 2" (one issue, #25) with a v0.1.0 release present: merged, milestone closed, release v0.2.0 cut | Haiku (history) | pass | #34 |
| Left behind: `git worktree list` main only; local branches main only; remote branches main only | none | pass | #34 |
| `pi-env tidy 1` after the merge of PR #1: worktree, local branch, remote branch removed; `git branch -a` and `git worktree list` show only `main` | none | pass | #29 |
| `pi-env tidy --all-merged` with: PR #2 merged; PR #3 open; PR #4 merged with its remote branch already deleted; `t4` new, no commits | none | pass: #2 removed (3 items), #4 removed (remote `gone`), `t3` and `t4` kept with their reasons, exit 0 | #29 |
| `pi-env tidy t3 t4` (PR #3 closed, not merged): `t4` removed on ancestry (named), `t3` kept, exit 1 | none | pass | #29 |
| `pi-env tidy t3 --force`: removed, remote branch too | none | pass | #29 |

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| Per issue (worker plus reviewer; mostly the fixed prompt of each fresh child) | Haiku (history) | 7–8 turns, 83–99K tokens, about 33 s | #34 |

#109 setup: a clone of the scratch repo with a hostile `.pi/settings.json` (`runner.setup: touch
<lab>/PWNED`, `stop: merge`, `foreignRepos: off`, `sandbox: off`, `workDir` in the lab). The test user
is admin there, so a `gh` wrapper on PATH reported `viewerPermission: WRITE` for `gh repo view` and
passed every other call to the real `gh`.

#34 setup: every role on Haiku (profile file mapping all roles). Scratch repo, milestone "runner
live": #18 sum, #19 mean (blocked by #18), #20 answer (asks for `rt/c.js`, which the verify script
`sh rt/check.sh` forbids), later #23 double. `--stop milestone`, rigor `standard` (reviewer on),
`--verifyFixRounds 1`.

Unit tests (#100): `pi-env run` on a worker refused for provider quota stops with "provider quota
used up …; nothing is lost: run the same command again after the reset", no label, no comment, the
refused start not counted, and the same command then delivers and merges the issue; budgets of 0
mean no limit. Runner budgets now default to 0 (no limit).

#29 setup: the scratch repo (auto-delete of head branches off), one worktree per branch, PRs
squash-merged with `gh pr merge --squash` (no `--delete-branch`). Found and fixed: a branch that was
already gone reported `--force` as its evidence.

## Sandbox

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| `pi-env box exec . -- node --version` | none | pass: `v24.22.2`, set-up 359 ms | user pass |
| Token proxy: the box holds a placeholder; `pi -p` in the box answered; the egress log shows `POST /v1/messages`, `injected: true`, status 200 | Haiku (history) | pass | #35 |
| Escape test `tests/live/box-escape.sh` (11 checks: host home, SSH keys, other repos and host `.git` not visible; read-only pi-env and root; no docker socket; no credentials; blocked hosts, no direct API, no route around the proxy; allowed host works) | none | pass, 11/11 | #35 |
| A running worker box: its `CLAUDE_CODE_OAUTH_TOKEN` differs from the real token (hash compare on the host) | Haiku (history) | pass | #35 |
| Guard inside the box: `sudo ls /root` asked of the model was blocked (strict, no user) | Haiku (history) | pass | #35 |
| `pi-env run 27 --stop merge --away --sandbox always` on the scratch repo: worker in the box (4 turns, 55K tokens, 11 s), commits fast-forwarded into the worktree, verify in a box, PR #28 reviewed on the host and merged; no container, network, clone or worktree left | Haiku (history) | pass | #35 |
| Docker Sandboxes `sbx` v0.53.0 (user-local install) | none | not run: `sbx diagnose` fails on `/dev/kvm` permission (the test host user is not in the kvm group); it needs a Docker account login; the test host OS (Debian 13) is not supported | #35 |

| Measurement | Model | Value | Issue |
| --- | --- | --- | --- |
| Start-up: `box exec <repo> -- true` | none | 1.96 / 1.93 / 1.90 s | #35 |
| Start-up: `box exec <repo> -- pi --version` | none | 2.1 s (host 0.12 s) | #35 |
| Image `pi-env-box:1.5.2` | none | built in 35 s, 1.6 GB | #35 |

#35 setup: Docker 29.9.3; Haiku inside the box. Found and fixed: the reviewer's failure reason was
not reported (a stale test agent dir pointed at a removed worktree); the runner now blocks with the
child's error. Kill and strict-preset runs with the sandbox are in Runner (acceptance).

## History

Superseded results and Haiku results that are not the only evidence for a check. Kept for the
record; do not read them as current behaviour.

### Superseded

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Unit-tested, not live: the quota stop during a run (a child is asked to report when the quota file crosses the stop), the refusal of a new child above the stop, the warning at 80 % of the time | none | (superseded: the quota stop and the 80 % warning were removed, #101) | #17 |
| A timed-out child got no warning before the kill; fixed in #17 with a steer at 80 % of the time. The scout of #14 hit its 10-minute timeout | local | (superseded: no default timeout since #103; with `maxMinutes` the wrap-up comes at the limit and the stop 2 minutes later, #103) | #14 |
| Quota stop during a run; "write your report" at 80 % of the time | none | (superseded: obsolete, removed by #101 and #103) | acceptance |
| `/profile mi` + Tab: `/profile mixed` | local | pass (superseded: the `mixed` profile was removed, #100) | #96 |
| Owner decisions: the quota stop (`piEnv.agent.quotaStop`) and its checks are gone (agent admission, the steer of running children, the runner pre-check), and so are the default agent timeouts (`agents/*.md`). Runner budgets keep their defaults and accept 0 = no limit | none | (superseded in part: runner budgets now default to 0 = no limit) | #100 |
| Default profile `claude` (footer `profile:claude` in the cut-over) | Sonnet | (superseded: the default profile is now `custom`, #100) | #46 |
| web_search: no Exa key on the test host; Exa backend untested live; a Codex failure falling over to Exa untested; the 20-question comparison that sets the default order pending | none | (superseded: #63 tested Exa, both fallbacks, and compared 8 questions) | #19 |
| Listing: the model lists the six model-picked skills, `browser-check`, `frontend-design` and `prototype` among them; `npm run check`: pi's loader loads all 9 skills without warnings; links, licences, names, budget | local | pass (point-in-time count: now 16 skills, 10 model-picked, #27) | #26 |
| #27 reading: model-picked skills are rarely loaded by the small Claude models at `low` (1 of 10 on Haiku, 4 of 9 on Sonnet); the local model loaded the skill in every case and in every #21, #24 and #25 live run; "the lead role runs a larger model in the `claude` profile" | — | (superseded: the #90 skill lines and the #108 loading run, #90, #108) | #27 |
| #90 not done: no skill was made owner-invoked; six model-picked skills not run on the lead, to save quota | — | (superseded: all 10 load on the lead, #108) | #90 |
| Code mode: "measure again with scriptable subagents (#18)" | — | done in #18 | #8 |
| A lost delivery (the process dies with the result still queued): covered by a unit test, not live | — | (superseded: tested live in acceptance, see Subagents) | #14 |
| Closing the `/agents` panel while a child runs: unit test only | — | (superseded: tested live in acceptance, see Subagents) | #15 |
| The runner's fix-round path did not run live (Haiku stopped itself on #20) | — | (superseded: tested live in acceptance, see Runner) | #34 |
| A citation dropped as wrong not seen | — | (superseded: tested live in acceptance, see Web) | #21 |
| Guard not run through the Claude path; footer Claude and Codex quota segments not tested | — | (superseded for Claude: tested in the cut-over #46; the Codex segment is still open) | #4, #6 |

Standing cost history: see Prompt and context cost.

### Haiku results with stronger evidence elsewhere

| Check | Model | Result | Issue |
| --- | --- | --- | --- |
| Skill loading, Haiku high, with skill lines | Haiku, high | 7/10 (6/10 before #90) | #108 |
| Skill loading, before #90 | Haiku, low | `FFFFFpFFpF` 2/10 | #90 |
| Skill loading, trigger words first | Haiku, low | `FFFFFFFFFF` 0/10 | #90 |
| Skill loading, with skill lines | Haiku, low | `pFpFFFFFpF` 3/10 | #90 |
| Skill loading, before #90 | Haiku, high | `pFpFFppFpp` 6/10 | #90 |
| Skill loading, trigger words first | Haiku, high | `FFpFFppFpp` 5/10 | #90 |
| Skill loading, with skill lines | Haiku, high | not run (quota) | #90 |
| `/skill:grilling I want greet to accept --shout …` | Haiku | built the code and a test instead of asking questions (the #27 eval had 3/4). Not changed: the skill says it plainly. See #108 for Sonnet and lead | user pass |
| github-delivery: `--stop milestone --tracking milestone`, "Deliver issue #35 to the end": worktree, test, `pi-env check`, a reviewer, PR #36, merge with the literal sha (the guard asked `merge-head` because the agent ran `sh rt/check.sh`, the issue's check, while the repo's verify command is `npm run check`; answered yes), issue closed, tidy. It stopped there | Haiku | partial | acceptance |
| github-delivery: then "Deliver the milestone delivery live": frontier empty, milestone closed (the guard asked for the `gh api PATCH`), run report as an issue comment. Not done: the 0.x release the skill asks for (the repo has v0.1.0 and v0.2.0) and the demo | Haiku | partial: the skill path does not reach the end of step 9 on the smallest model (step 9 was rewritten in #108) | acceptance |
| Eval browser-check | Haiku | 2/3 (skill not loaded) | #27 |
| Eval code-review | Haiku | 5/7 (skill not loaded, no reviewer), 58K | #27 |
| Eval codebase-design | Haiku | 3/4 (skill not loaded), 29K | #27 |
| Eval diagnosing-bugs | Haiku | 1/4, then 3/4 after a check fix (skill not loaded), 75K | #27 |
| Eval frontend-design | Haiku | 3/4 (skill not loaded), 55K | #27 |
| Eval github-delivery | Haiku | 4/5 (skill not loaded), 75K | #27 |
| Eval prototype | Haiku | 3/4 (skill not loaded), 19K | #27 |
| Eval tdd | Haiku | 3/5, then 4/5 after a check fix (skill not loaded), 99K | #27 |
| Eval web-research | Haiku | 4/5 (skill not loaded), 54K | #27 |
| code-review: loads the skill | Haiku (2 runs) | no (answered directly; also after the description gained "even a small one you could read yourself") | #25 |
| code-review: checks first | Haiku | ran the tests | #25 |
| code-review: fresh finders, refuters | Haiku | none | #25 |
| code-review: planted bug / over-engineering / test gap | Haiku | yes / yes, as "beyond the issue" / yes | #25 |
| code-review: findings and verdict | Haiku | a plain review | #25 |
| code-review: tokens | Haiku | lead 70K and 97K sent | #25 |
| Global rules: answers from the rules and reads the session mode with bash | Haiku | pass | #7 |
| Code mode off: requests / first / sent / output / tool calls | Haiku | 2 / 5,126 / 10,567 / 490 / bash 1 | #8 |
| Code mode on | Haiku | 2 / 5,890 / 12,189 / 612 / bash 1. Code mode adds 764 tokens; the tool reaches Claude through the bridge but was not used | #8 |

### Other

- The v1 SearXNG container, its image and `~/.config/searxng/` were removed from the test host (#20).
- Cut-over and rollback of the test host: see Install (#46).
