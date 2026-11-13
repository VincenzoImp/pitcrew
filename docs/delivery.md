# Delivery

How a piece of work goes from an issue to a merged, cleaned-up change.

## How the dials drive the flow

One procedure for every piece of work: issue → branch → PR → review → merge → tidy. The session
mode ([mode.md](mode.md)) says how much of it runs; nothing else changes between a one-line fix
and a milestone.

| Dial | Values and effect |
| --- | --- |
| `tracking` (repo setting) | `none`: no plan file, no GitHub objects; `local`: a Markdown plan outside the repo; `github`: issues, milestones or a Project, chosen per piece of work. Unset: `github` when you can push to the repo's GitHub remote, else `local` |
| `stop` | `plan`: plan only; `local`: verified commits on a branch; `pr`: a ready PR; `merge`: merged and tidied; `milestone`: every issue of a milestone merged, then the milestone closed, and the next 0.x release cut when the repo has 0.x releases |
| `rigor` | the switches `issueRequired`, `verify`, `review`, `leanCode` (presets `fast`, `standard`, `strict`) |

Who does what:

| Part | Kind | Where |
| --- | --- | --- |
| Which GitHub object holds what; when to propose a milestone or a Project | judgment | skill `github` |
| Entering a repo by its rules; bootstrapping a new one | judgment | skill `repo-setup` (owner-invoked) |
| The procedure, the PR body, what to do when blocked | method | skill `github` |
| PR closes an issue; merge inside the stop dial on a verified head; foreign repos; caps | enforced | guard rules, below |
| Cleanup after a merge | enforced, provable | `pitcrew tidy`, below |
| Code and test volume | measured | `pitcrew check`, below |
| Many issues, unattended | enforced loop | `pitcrew run`, `pitcrew status` ([runner.md](runner.md)) |

Typical settings:

| Work | `tracking` | `stop` | `rigor` |
| --- | --- | --- | --- |
| Hackathon or demo | `none` or `local` | `local` or `merge` | `fast` |
| A fix in your repo, you watch | `github` (the default) | `pr` | `standard` |
| A contribution to someone else's repo | set by the repo's rules | `pr` (never `merge`) | `standard` |
| A milestone you planned together, then leave to run | `github` | `milestone` (`pitcrew run`) | `standard` or `strict` |

## Rules in code

The guard (`extensions/guard/delivery.ts`) checks a few delivery rules on bash commands. The table
says when each one is on; the merge rule follows the `stop` dial, and the foreign-repo rule is always
on. They ask (a confirm dialog; in a run with no user, a block) and say why; only `--admin`
is blocked outright. Everyday commands (`git status`, `gh pr view`, `gh issue list`, a read-only
`gh api`) never reach a rule.

| Rule | On when | What it does | Cost |
| --- | --- | --- | --- |
| A PR closes an issue | `issueRequired` on and `tracking` is `github` | `gh pr create` asks when its title, body, `--body-file` or (with `--fill`) commit messages have no closing keyword (`Closes #12`, `fixes owner/repo#3`, an issue URL), or when it targets a branch other than the default one (GitHub closes issues only for PRs into the default branch) | reads the body file or `git log`; no tokens |
| Merge inside the stop dial | always (the `stop` dial) | `gh pr merge` (or the merge API) asks when `stop` is not `merge` or `milestone`, or without `--match-head-commit <sha>`, or, with `verify` on, when that commit's tree has not passed the repo's verify command in this session: a verify-gate receipt, or the agent's own run of the command with nothing piped after it (repos with no verify command skip this). `--admin` is blocked | one `git rev-parse`; no tokens |
| Foreign repos | always | in a repo where your permission is not `ADMIN`: `gh pr create`, `gh issue create`, labels, releases, repo settings, `gh issue|pr edit` of labels, assignees or milestones, a `gh api` write, `git push` and merges ask. pi project trust is answered "no", so the repo's `.pi` settings, extensions and skills do not load (`pi --approve` overrides) | one `gh repo view` per repo and process (about 0.5 s) |
| Caps | `pitcrew.caps` (0 turns a cap off) | `git worktree add` and `gh issue develop --worktree` ask when the repo has `worktrees` worktrees (default 20, the main checkout included), or when its extra worktrees plus the harness work folder use `diskGB` (default 20) | one `git worktree list` and one `du` per worktree add |

Inside the stop dial the guard also stops asking for the steps it allows, in your own repos only:
from `stop` = `pr` a `git push` of a branch that is not the default one, `gh pr create` (with its
issue), and `gh issue|pr create|comment|edit`; from `stop` = `merge` a merge that passed the rule
above; at `stop` = `milestone` also closing a milestone (`gh api -X PATCH …/milestones/<n> -f
state=closed`) and `gh release create`. Force pushes, deleted branches, pushes to the default branch and everything else keep their
usual ask. Rule ids for `PI_GUARD_ALLOW`: `issue-required`, `stop`, `merge-head`, `foreign-repo`,
`cap`.

```json
{ "pitcrew": { "caps": { "worktrees": 20, "diskGB": 20 } } }
```

## `pitcrew tidy`

After a merge, nothing of the work may stay behind: not the remote branch, not the local branch,
not the worktree. `pitcrew tidy` removes all three and prints proof.

```
pitcrew tidy                 the current branch
pitcrew tidy 12              the branch of PR #12
pitcrew tidy feat-x          a branch by name
pitcrew tidy --all-merged    every branch (local or remote) whose merged PR has the same head
--dry-run                   say what would go, change nothing
--force                     also remove work that is not merged, and worktrees with uncommitted files
```

It removes a branch only with evidence that its work is merged:

- a merged PR whose head is the branch tip (or a later commit of it). A squash merge leaves no
  ancestry, so this is the evidence for squash-merged work; `gh` reads it;
- or, for a branch named on the command line, a tip that is inside the default branch (merge
  commits, fast-forward, a repo with no GitHub remote). `--all-merged` does not use this alone,
  because a new branch with no commits is also "inside" the default branch.

It never removes the default branch, a branch checked out in the main worktree, a locked worktree,
or a worktree with uncommitted or untracked files (ignored files such as `node_modules` do not
count). A remote branch that moved after the merge is kept. A PR from a fork removes the branch on
the remote that points to the fork.

Output: one block per branch (`removed`, `gone` when it was already missing, `would remove` in a
dry run), then `left:` with the reason for each branch it kept, then `check:` lines read again
after the changes (worktrees, local branches, remote branches). The exit code is 1 when a branch
you named was kept or could not be removed.

Cost: one `git fetch --prune`, one `git ls-remote` per remote, one or two `gh` calls; no tokens.
The guard asks before `pitcrew tidy --force`.

GitHub can delete the remote branch itself on merge (repo setting "Automatically delete head
branches"; the `repo-setup` skill turns it on). `tidy` then reports the remote branch as `gone`
and removes the local side.

`pitcrew init` puts the command on your `PATH` ([install.md](install.md)). Code: `bin/cli.mjs`, `lib/tidy.ts`.

## Lean code: `pitcrew check`

Code and tests must stay in proportion, and a known shortcut must say when to upgrade it.
`pitcrew check` measures the changes of the current branch against its base (the merge base with
origin's default branch, or `--base <ref>`): commits, uncommitted edits and new untracked files.

| Check | Default bound | Finding |
| --- | --- | --- |
| Size: lines added + deleted in code and tests | 400 | split the change, or say in the PR why it cannot be split |
| Test-to-code ratio: test lines added per code line added, judged from 30 code lines added | 1.5 | keep one test per risky behaviour |
| `shortcut:` markers in added lines (after `#`, `//`, `/*`, `--`, `;`, `<!--`) | — | the marker must read `shortcut: <the limit>, <when to upgrade>` |

**What counts.** Test code: files under a `test`, `tests`, `__tests__`, `__mocks__`, `spec`,
`specs`, `testdata`, `fixtures` or `e2e` folder, and files named `*.test.*`, `*.spec.*`,
`*_test.go|py|rb|ex|exs`, `test_*.py`, `conftest.py`. Not counted: docs (`*.md`, `docs/`), data and
config (`*.json`, `*.yaml`, `*.toml`, `*.csv`), lock files, images, snapshots, generated and vendored
folders (`dist/`, `build/`, `vendor/`), dotfiles, licence and changelog files. Code: everything
else. Binary files are not counted.

**Levels** come from the `leanCode` switch (`fast` off, `standard` warn, `strict` block), or
`--level`. `off` prints that the checks are off; `warn` prints the findings and exits 0; `block`
exits 1 when there is a finding. Outside a pi session the level is the default preset's: warn.

Bounds: `"pitcrew": { "leanCode": { "maxLines": 400, "maxTestRatio": 1.5, "minCodeLines": 30 } }`
in the global or the repo's `.pi/settings.json` (the repo wins), or `--max-lines`,
`--max-test-ratio`. A bound of 0 turns that check off. `--json` prints the counts, the findings and
the exit code for scripts and `pitcrew run`.

Who runs it: the agent before it opens a PR (the `github` skill), and `pitcrew run` as a gate
after each worker. Cost: one `git diff`; no tokens.

## Unattended: `pitcrew run`

`pitcrew run <milestone | parent issue | label:<name> | issues>` takes the frontier one issue at a
time through the same procedure, with a fresh `worker` per issue and the runner itself doing the
checks, the PR, the review, the merge and `tidy`; `pitcrew status` prints the digest. Details,
budgets and the resume rules: [runner.md](runner.md).
