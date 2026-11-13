---
name: github
description: Track and deliver work on GitHub. Which object holds what (issue, milestone, Project), then issue, branch, verify, review, PR, merge and tidy as far as the stop dial allows. Use when implementing an issue, opening or merging a PR.
---

# GitHub

Two jobs: keep the plan's GitHub objects true, and deliver a change through them. One procedure
serves every size of work and every level of autonomy; the session mode decides how much of it
runs. A one-line fix and a milestone of twenty issues go through the same steps; small work skips
the steps that do not apply. The exact commands are in [references/gh-recipes.md](references/gh-recipes.md)
(checked live).

## The session mode here

The session mode message in the conversation gives the values; the owner changes `stop` and the
switches with `/mode`. `tracking` is a repo setting (`pitcrew.tracking`); unset, it is `github` when
the repo has a GitHub remote you can push to, else `local`. The owner can name another home for one
piece of work ("make this a milestone"); that wins for that work.

| Setting | What it changes here |
| --- | --- |
| `tracking` `none` | the plan lives in the conversation; no issue, no GitHub objects unless the owner asks |
| `tracking` `local` | a Markdown plan outside the repo (the `work-planning` skill says where); a PR without an issue is fine |
| `tracking` `github` | the plan lives on GitHub; every PR closes an issue. Which objects (an issue, a milestone, a Project) is chosen per piece of work: see "Which object for what" |
| `stop` `plan` | build nothing; this skill only records the plan |
| `stop` `local` | build, verify, commit on the branch; stop before the push |
| `stop` `pr` | push and open the PR; stop when it is ready. The owner reviews it |
| `stop` `merge` | review, merge on the verified head, tidy |
| `stop` `milestone` | merge and tidy each issue of the milestone, then close it (step 9) |
| `verify` | `on`: the harness runs the repo's checks when files changed; `remind`: you run them. Either way, done = the checks passed on the final tree |
| `review` | step 5. `auto`: only when you merge by yourself (`stop` `merge` or `milestone`); at `stop` `pr` the owner reviews the PR. `on`, `off`: always, never |
| `leanCode` | what `pitcrew check` does with size and test-ratio findings (step 4) |
| `issueRequired` | with `tracking` `github`, the guard asks when a PR closes no issue |

The guard enforces the backbone: no merge outside the stop dial, a merge only with
`--match-head-commit` on a verified head, no `--admin`, care in foreign repos, caps on worktrees.
Do not work around it; when it stops a step, say what you wanted to do.

## Whose repo

Read `viewerPermission` first (recipe "Read the state"). In a repo you do not own (not `ADMIN`):
create no labels, milestones, Projects or settings, assign nobody, add no Project items, and never
merge, without the owner's yes; the guard asks before each. Follow the repo's own process (its
templates, labels, milestones, issue claims; the `repo-setup` skill). Never take an issue someone
else holds.

## Which object for what

| Question | Object | Rule |
| --- | --- | --- |
| What is one reviewable change? | **Issue**, closed by one PR | The unit of delivery: one outcome, its acceptance checks, what is out of scope |
| What ships together, and when is it done? | **Milestone** | A scope with a finish line. Its description holds the done-check. A due date only if it is real |
| This issue is too big to be one change | **Sub-issues** | The shape of one feature. A parent only when the whole needs its own discussion, a spec link or a progress bar. Parent and children share the milestone |
| What must come first? | **Dependency** (blocked by) | Only real blockers: B cannot start or merge before A. No edge means they can run in parallel |
| What kind of work is it? | **Issue type** (Task, Bug, Feature) | One per issue; not repeated as a label |
| State that open/closed does not say | **Labels**, few | The repo's labels. In the owner's repos, `needs-owner` and `ready-for-agent` are useful; area labels only where the repo uses them |
| Everything across milestones and repos; priorities, a board, a timeline | **Project** | One long-lived Project per product, never one per plan. A view over issues: it holds no scope the issues do not |
| How is it going? | **Run report** | A Project status update; without a Project, a comment on the parent issue or the milestone's last issue |

Milestone = scope and finish line; sub-issue = shape; dependency = order; Project = view. One fact
lives in one place: no field that repeats the milestone, no label that repeats the type.

**Choose per piece of work.** With `tracking` `github`, the kind of object is not a setting. Use what
the owner named. Otherwise propose the smallest fit, in one line with one reason, and wait:

- "This is one change: one issue, no milestone."
- "This is 4 issues that ship together: a milestone `Session resume`, done when a resumed session
  keeps its mode? Reason: one finish line and a progress bar."
- "Two milestones are open on this product and you asked twice what is next: a Project with a
  board? Reason: one view over both."

Propose a milestone for 2 or more issues that ship together, a Project when a product has 2 or more
milestones in flight, spans repos, or the owner wants a board. Size alone never picks: a long plan
can be one issue, and a two-line fix in a shared repo can need one. With `tracking` `none` or
`local`, propose GitHub tracking the same way when the work calls for it.

## Read before you add

Read the open milestones, labels, issue types, linked Projects, the templates, and the open issues
near your topic (recipe "Read the state"). Search for a duplicate before you open an issue. Reuse
before you create: a milestone that fits, the product's Project, an existing label. Never create a
second label or Project for one that exists under another name.

## Writing the objects

- **Issue**: a contract another agent may build from weeks later, without this conversation. Title:
  the outcome, in the repo's style. Body: what must be true when it is done (behaviour, not steps);
  acceptance lines (`- [ ] V1: … Check: <command>`, the format of the `work-planning` skill); what is
  out of scope; the spec or parent link. Interfaces and behaviour, not file paths or line numbers.
  The repo's issue template when it has one.
- **Decision ticket**: an open question that blocks work. The question, the options with their
  cost, your recommendation, and how it is resolved (a comment that starts `Decision:`, then
  close). It blocks the issues that wait for it.
- **Milestone**: named for the outcome (`Session resume`) or a phase. Description: one line of scope
  and the done-check. Every issue and PR of the scope goes in it (`--milestone "<title>"`: `gh` takes
  the title, the REST API the number). A changed scope: move an issue out with one comment that says
  why; close an issue that will not be done as "not planned", with a reason.
- **Sub-issues and dependencies**: `--parent` and `--blocked-by` at creation, or `gh issue edit`. One
  level unless the work really nests. Check the edges with the owner as part of the plan.
- **The frontier** is every open issue with no open blocker and no open sub-issue: what can start now.
  Compute it from the dependency data (recipe "Frontier"), never from the search term `is:blocked`
  (that matches a label).
- **Project**: create it once per product, when the owner agrees; link it to the repos. Fields before
  items have values: `Status` with `Todo`, `In Progress`, `In review`, `Done` (add `In review` with the
  existing option ids, so items keep their values); `Priority` and `Target` only if the owner will use
  them. A table grouped by milestone and a board by status are enough. Workflows (auto-add,
  auto-archive) are set in the web UI only: tell the owner once which to turn on. A Project needs the
  token's `project` scope; without it, say so and keep to issues and milestones.

Each object costs a `gh` call or two and upkeep. A stale milestone or an unread Project misleads more
than none: prefer fewer objects that stay true.

## Delivery

### 1. The contract

With `tracking` `github`: work from an issue. Use the one you were given; otherwise search for a
duplicate, then open one. Read it with all comments: its acceptance lines are the contract. A
conflict between the issue and the code is a question for the owner or, with nobody to ask, a
labelled assumption in the PR. With `tracking` `none` or `local`: the request or the plan's slice is
the contract.

### 2. Branch and worktree

- Branch name: the repo's convention; else `<issue>-<slug>` (`42-session-resume`), or `<slug>`.
- One worktree per piece of work, next to the main checkout, from the current default branch:

  ```bash
  git fetch origin && git worktree add -b 42-session-resume ../<repo>.wt/42-session-resume origin/main
  ```

  `gh issue develop 42 --name 42-session-resume --base main --worktree ../<repo>.wt/42-session-resume`
  also links the branch to the issue.
- A one-line fix in a session that already sits on a clean branch needs no new worktree. Never work
  on the default branch.

### 3. Build

Test first where it pays (the `tdd` skill); the smallest complete change (the global rules). Commits
in the repo's style, small and coherent; `Refs #42` when the repo links commits to issues. No
unrelated changes. A choice the issue does not settle: take the reversible option and note it for
the PR (`Decision: … Why: …`).

### 4. Verify

Run the repo's verify command on the final tree as a plain command (`npm run check`, no pipe after
it, so its exit code counts). The merge rule accepts a head whose tree passed such a run in this
session, or a receipt of the verify gate. Run each `Check:` of the acceptance lines. Run `pitcrew
check` (size, test-to-code ratio, `shortcut:` markers): at `leanCode` `warn` fix what you can and say
the rest in the PR; at `block` the PR waits until it passes or the owner agrees. Collect `Evidence:`
items. Never weaken a test or a check to get green.

### 5. Review

When the session mode message says a fresh reviewer checks the change, or the owner asks: follow
the `code-review` skill on the diff against the base, with the issue as the intent. Fix what is
confirmed, verify again. A reviewer that failed or said nothing is not a clean review.

**`stop` `local` ends here**: report the branch, the commits and the checks that ran.

### 6. Push and open the PR

- Push the branch (never the default branch, never with force).
- Open the PR against the default branch, as a draft while CI runs. Title: the outcome, in the repo's
  style. Body: the repo's PR template if it has one, filled honestly; else
  [references/pr-body.md](references/pr-body.md): the smallest picture of the change, evidence
  before and after, merge danger, limits, and `Closes #42` (only a PR into the default branch closes
  its issue).
- Wait for the required checks on the current head: `gh pr checks <n> --required --watch
  --fail-fast`. A red check: fix with a new commit, verify, push. Checks of an older head do not count.
- Mark it ready (`gh pr ready`). With a Project that has these states, the item goes to `In Progress`
  when work starts and to `In review` now; a merge moves it to `Done`.

**`stop` `pr` ends here**: report the PR link, the checks, and what the owner must decide.

### 7. Merge

Only at `stop` `merge` or `milestone`, never in a repo you do not own, and only the head that was
verified and reviewed:

```bash
git rev-parse HEAD                  # the verified, reviewed, pushed head
gh pr merge 57 --squash --match-head-commit 3f2a1c0e…   # that sha written out (not "$sha"); the repo's merge method if it has another
gh issue view 42 --json state,closedByPullRequestsReferences
```

If the merge is refused (a rule, a check, a new commit), find out why; do not retry with other flags.

### 8. Tidy

```bash
pitcrew tidy 57        # from the main checkout, not from inside the worktree it removes
```

It removes the worktree, the local and the remote branch when its evidence says the work is merged.
Put its `check:` lines in your report; if it kept something, say why. Run `pitcrew tidy
--all-merged` when you see leftovers of earlier work.

### 9. The whole milestone (`stop` `milestone`)

Take the next issue from the milestone's frontier and repeat from step 1. When the frontier is
empty, do all of these, in this order:

1. Run the milestone's done-check. Close the milestone only when it passes: all issues closed is
   not enough by itself.
2. Close the milestone.
3. Release: `gh release list`. If the repo has `v0.x` releases, cut the next one
   (`gh release create v0.<next>.0 --target <default branch> --generate-notes`, notes edited to say
   what changed for the user). No releases yet: none, unless the owner asks.
4. Write the run report: status, done (with PR links), in review, blocked and why, the next step.
5. Stop with a short demo for the owner: what now works, how to see it, what is left.

A long milestone that should run unattended goes to `pitcrew run <milestone>` instead: the same
steps, driven by code, resumable after a stop.

## No human present

When nobody can answer (a print-mode run, a `worker` agent, `pitcrew run`): ask nothing. Turn open
points into labelled assumptions in the PR body. A step that needs the owner (a decision, a guard
ask, a merge outside the dial) ends the work in a recoverable state, as below.

## Blocked

- the branch pushed (when `stop` allows a push), or the worktree path;
- a comment on the issue: `Blocked: <one line>. Tried: <what, with the result>. Next: <the exact
  action that unblocks it, and who must do it>.`, with the last lines of the failing check;
- label `needs-owner` when the next action is the owner's (in the owner's repos).
