# Getting started

From nothing to a first piece of work done with pitcrew, in about ten minutes. You need pi, logged
in to at least one provider, and Node 22.19 or later.

## 1. Install

```sh
git clone https://github.com/VincenzoImp/pitcrew.git
cd pitcrew && npm ci --ignore-scripts && ./bin/pitcrew init
```

Run it in a terminal: it asks you to confirm the profile and whether to add pitcrew's working rules
(say yes if you want the model to keep its notes out of your repo). Once the package is published,
`npx @vincenzoimp/pitcrew init` does the same without a clone.

`init` registers the package with pi, adds the baseline settings, proposes a profile that works
with your logins, and lists the optional parts ([install.md](install.md)). Keep its output: the
`option` lines say what to add later.

## 2. Open a session

In a repo of yours:

```sh
cd ~/code/my-app
pi
```

The footer shows the folder and branch, the role and model that answered, context use, cost, and
the session mode and profile (`pr · standard profile:codex`). Try:

- `/profile`: which model and thinking level answer for each role.
- `/mode`: how far the agent goes alone (`stop`) and which checks run (`rigor`).

## 3. Give it work

Ask for something real and small: "the test for X fails, find out why and fix it". The lead may
start child agents: a `scout` to read code, a `worker` for a bounded change, a `reviewer` for a
fresh check. While they run, the footer shows `agents 1▶`:

- `alt+a` (or `/agents`) opens the panel; `Enter` opens a child's live transcript.
- Type there to steer it; `ctrl+x` twice stops it.

When the turn changed files, the verify gate runs the repo's own check and shows `verify ✓`, or
sends the failure back to the model. It finds the check as a `verify` or `check` script in
`package.json`, a `verify` target in a Makefile or justfile, `scripts/verify`, or `PI_VERIFY`;
`test` is never guessed. A repo with none gets a reminder instead ([verify-gate.md](verify-gate.md)).

## 4. Let it go further

The default `stop` is `pr`: the agent stops at a ready pull request that closes an issue. That needs
a GitHub remote you can push to. In a repo without one, tracking is `local` and there is no PR to
stop at (in a test the agent left its fix uncommitted). Use `stop local` there to get verified
commits on a branch. Change
the dial for this session:

| You want | Type |
| --- | --- |
| a plan first, no edits | `/mode stop plan` |
| commits on a branch, nothing pushed | `/mode stop local` |
| the PR merged and the branches cleaned up | `/mode stop merge` |
| fewer checks for a demo | `/mode rigor fast` |

The guard asks before a push, a PR or a merge that the stop dial does not allow, and blocks
catastrophic commands in any mode ([guard.md](guard.md)).

## 5. Go on, or hand off

When the footer's context number turns yellow (35 %) or red (60 %), type `/handoff <next goal>`: it
writes a handoff file and opens a fresh session with the same mode and roles ([context.md](context.md)).

## 6. Unattended work

For a milestone of small issues you planned, from the shell:

```sh
pitcrew run "v0.2" --stop pr      # one issue at a time: worktree, worker, checks, PR
pitcrew status                    # what is done, blocked and next
```

Run the same command again to continue after a stop ([runner.md](runner.md)).

Next: [how it works](how-it-works.md), every command in [commands.md](commands.md), and
[troubleshooting.md](troubleshooting.md) when something does not work.
