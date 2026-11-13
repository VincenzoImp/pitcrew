# Commands

Everything you type: in a pi session, at start-up, and in the shell.

## In a session

| Command | Does |
| --- | --- |
| `/profile [name]` | show the role map, or switch to another profile for this session ([roles.md](roles.md)) |
| `/role <role> [provider/model][:level]` | change one role for this session; `/role lead` with no model opens a list ([roles.md](roles.md)) |
| `/mode [setting value]` | show the session mode, or change `stop`, `rigor` or one switch: `/mode stop merge`, `/mode review on` ([mode.md](mode.md)) |
| `/agents [resume \| limits running <n>]` | open the panel of child agents; `resume`: take up again the children a quota refusal stopped; `limits running <n>`: children running at once, for this session ([agent.md](agent.md)) |
| `/handoff [next goal]` | write a handoff file and go on in a fresh session with the same mode and role map ([context.md](context.md)) |
| `/compact [focus]` | pi's compaction, with pitcrew's summary. On a short session pi answers "Nothing to compact" |
| `/guard [on \| off]` | show the guard, or turn its confirm dialogs on or off; blocks stay ([guard.md](guard.md)) |
| `/stats [today \| 7d \| 30d] [--by day\|project\|role\|model\|session] [--json]` | usage and API-equivalent cost ([status.md](status.md)) |
| `/skill:<name> [task]` | run a skill ([skills.md](skills.md)) |

## Start-up flags

| Flag | Does |
| --- | --- |
| `pi --profile <name>` | the profile of this session |
| `pi --stop <value>`, `pi --rigor <value>` | the session mode of this session |

`PITCREW_PROFILE=<name> pi` does the same as `--profile`, for a shell or a script.

## Keys

| Key | Does |
| --- | --- |
| `alt+a` | open the agents panel |
| `#`, then Tab | complete an open GitHub issue of the repo (`#12`) |
| `Esc` | stop the current turn (also a `/handoff` being written) |
| `shift+tab` | next thinking level for the selected role |
| `ctrl+p` | next role (only roles are in the model cycle) |
| `ctrl+o`, `ctrl+t` | expand tool output, thinking blocks |
| `alt+enter` | queue a follow-up while the agent works |
| `ctrl+g` | write the prompt in your editor |

In the agents panel: `↑` `↓` select, `Enter` open, `Esc` close. In one child: type and `Enter` to
steer, answer or resume it; `ctrl+x` twice to stop it; `PgUp` `PgDn` to scroll.

pi leaves `/tree` and `/resume` without a key. To bind them, add to `~/.pi/agent/keybindings.json`:
`{ "app.session.tree": "alt+t", "app.session.resume": "alt+r" }`. `/tree` with the labeled-only
filter shows the session map (verify passes, PRs, agent results, handoffs; [status.md](status.md)).

## In the shell: `pitcrew`

| Command | Does |
| --- | --- |
| `pitcrew init [--dry-run] [--yes] [--rules on\|off]` | set pitcrew up, or check a setup; changes only what is missing ([install.md](install.md)) |
| `pitcrew run <target> [options]` | deliver the open issues of a milestone, a parent issue, `label:<name>` or a list, one at a time, unattended; run it again to continue ([runner.md](runner.md)) |
| `pitcrew status [<target>] [--post]` | one digest: done, in progress, blocked with reasons, next ([runner.md](runner.md)) |
| `pitcrew tidy [<PR> \| <branch> ...] [--all-merged] [--dry-run] [--force]` | remove the worktree, local branch and remote branch of merged work, with proof ([delivery.md](delivery.md)) |
| `pitcrew check [--base <ref>] [--level off\|warn\|block] [--json]` | lean-code checks on the branch: size, test-to-code ratio, `shortcut:` markers ([delivery.md](delivery.md)) |
| `pitcrew box build \| run \| exec \| shell` | the sandbox container that `pitcrew run` uses ([sandbox.md](sandbox.md)) |

`pitcrew` with no command prints every option. Code: `bin/cli.mjs`.
