---
name: code-review
description: Review a change (diff, branch, commit range or PR) with fresh reviewer agents for defects, spec gaps and needless code. Use when asked to review a change, even a small one you could read yourself, and before merging.
---

# Code review

This is the lead's procedure. The author's context is the reviewer's blind spot: the author reads
what they meant, not what they wrote. So the review runs in fresh `reviewer` children that see only the change, the code around it,
and the intent. A finder reports candidate findings; a separate fresh refuter tries to disprove
each serious one; you act only on what survives. Precision matters more than volume: an agent fixes
every comment it gets, so a false finding costs a wrong change.

A review checks three things, kept apart so one cannot hide another:

- **Defects**: the change is wrong, unsafe, or breaks under its expected load.
- **Spec**: the change does not do what was asked (missing, unasked, or wrong).
- **Standards and lean code**: the change breaks the repo's own rules, or adds code, options,
  layers or tests it does not need.

Code that follows every rule can implement the wrong thing; code that does exactly what was asked
can break the conventions or double the code. Report each axis on its own.

## When

When the owner asks, and when the session mode message says a fresh reviewer checks the change
(the `review` switch: `auto` reviews before you merge by yourself, at `stop` `merge` or
`milestone`; `on` always). At rigor `strict` a risky change also gets a finder on the `second`
role. A one-line, obviously local change (a typo, a version bump of a dev tool, docs only) needs no
children: check it yourself and say so.

## Cost

Each child reads the diff, the surrounding code and its callers. On a 70-line diff: one finder
about 45K tokens, each refuter about 30K, the lead's own turns 100–350K. Two finders and three
refuters are about 200K tokens of children. Scale the review with the risk, and say the depth and
the cost in one line before you start.

## 1. Pin what is reviewed

1. **Checks first.** Run the repo's own checks (its verify command: AGENTS.md, CONTRIBUTING, else
   `npm run check|test`, `make check`, `pytest`). Do not review code that does not build or pass its
   tests; fix that first. If the harness's lean-code check is installed (`pitcrew check --help`
   works), run it too and keep its output for the standards finder.
2. **The target.** What the owner named: uncommitted changes, a branch, a commit range, a PR
   (`gh pr diff <n>`; `gh pr checkout <n>` only with a clean tree), or paths (a snapshot review,
   no diff). Nothing named: the uncommitted changes, else the branch against its merge-base with
   the default branch.
3. **The diff, once.** Resolve the base (`git rev-parse`), stop on a bad ref or an empty diff.
   Write the review files outside the repo:

   ```bash
   R=$(mktemp -d /tmp/review.XXXXXX)
   git diff <base>...HEAD > $R/diff        # three dots: against the merge-base
   git log --oneline <base>..HEAD > $R/commits
   ```

4. **The intent** in `$R/intent.md`, 3–15 lines: what the change must do, its acceptance checks,
   and what is out of scope. Find the spec in this order: issues named in the commits or the PR
   body (`gh issue view`), the plan (the harness plans folder, or a path the owner gave), the
   owner's words in this session. Quote the spec; do not summarise it into something it does not
   say. No spec: write that, and the spec axis reports only "no spec".
5. **The standards sources**: AGENTS.md, CONTRIBUTING, a `REVIEW_GUIDELINES.md` or
   `CODING_STANDARDS.md`, linter and formatter configs (what they enforce is not a finding), and the
   style of the code next to the change. List the paths for the standards finder.
6. **The expected load**: from the README, deploy config, the issue. One person running a script,
   or many users and processes at once. Scale findings are judged against it.

## 2. Depth

Always at least one finder agent for a change with logic in it, however small, and even when you
have already seen the bug: a review you write alone from your own reading is the failure this
skill exists to prevent (in a live run the lead found the bug itself and then skipped the finder;
the finder would also have checked the parts it did not look at). Your own probes add to the
finders; they do not replace them. Only the trivial changes named above need no agent.

| Change | Finders | Refuters |
| --- | --- | --- |
| Small, low risk (under ~100 changed lines, no risky path) | 1, all three axes | none; check each finding yourself against the code |
| Normal | 1, all three axes | 1 per blocker or major finding |
| Risky path (auth, money, data writes or migrations, public API, security, concurrency, CI, agent instructions) or over ~400 lines | 2 in parallel: defects; spec + standards + lean | 1 per blocker or major finding |
| As above, at rigor `strict` | add a third: defects, on the `second` role | 1 per blocker or major; a finding only `second` saw gets its refuter on `reviewer` |

Over ~400 lines, also split by area: one finder per part, all started in the same turn. A diff of
over ~1,000 lines is too large to review well: say so, and propose a split (by slice, not by
layer).

## 3. Finders

Start each finder with `agent start {agent: "reviewer", task}`, all in one turn so they run in
parallel (add `role: "second"` for the second-vendor finder). The
task must stand alone; the reviewer does not see this conversation. Copy the task for each axis
from [references/finders.md](references/finders.md): it carries the checklists the reviewer needs
(the smell baseline, the lean list, the load and scale list, the test checks), because the
reviewer has no other access to them.

Every finding must be **short and checkable**:

```
F2 [major] defect: orders land on the wrong day (billing/close_day.py:40-52)
- Case: an order at 00:30 in Berlin is billed on the day before; "today" comes from the UTC server clock.
- Fix: compute the day once in the shop's time zone; one line.
- If we skip it: late orders show the wrong date and accounting fixes them by hand.
```

- **Id, severity, axis, title, place** on one line. Severity: `blocker` (wrong result, data loss,
  security hole, breaks at the expected load), `major` (risky code without a test, a real
  slowdown, a spec gap, needless code that should go), `minor` (small speed-ups, shorter forms).
- **Case**: the input or situation and the wrong outcome, or for lean findings the code that is
  not needed and why. **No concrete case, no finding.**
- **Fix**: the smallest fix that works. Prefer a fix that deletes code.
- **If we skip it**: the consequence, in one line.
- Lean findings end with the lines they save: `Lean: -40 lines`.

Not findings: style a linter enforces, naming taste, "consider", defence in depth with no reachable
failure, pre-existing problems the change does not touch (list those separately, one line each, if
they matter), anything with no case.

## 4. Refuters

One fresh refuter per blocker or major finding, all started in one turn. Give it only the finding,
the diff path and the intent, never the finder's other findings or its reasoning:

```
You did not write this finding, and you did not write the code. Try to refute it.
Finding: <the finding, as reported>
Diff: <$R/diff>. Intent: <$R/intent.md>. Repo: <path>.
Check: the file and lines exist; the case can happen (the input is reachable, no caller, guard,
type or test prevents it); the outcome is really wrong under the intent; for a lean finding, grep
every caller and use (tests, config, string and dynamic references): is the code really unused or
needless, and does any concrete caller need it? You cannot run code: if only a run settles it,
answer unsure and name the command or test that would.
Answer on the first line after the status: confirmed, refuted, or unsure; then the evidence
(path:line), and for confirmed the smallest fix.
```

A refuter that fails or returns no verdict counts as unsure, never as refuted.

In code mode (`pi --tools +codemode`), the finder and the refuters can run as one script with
`agent run` and a schema (`docs/agent.md`, "Code mode and the one-shot form"). That pays when there
are many findings with long evidence; for a few it costs more.

## 5. Act

- **Confirmed blocker or major**: write a failing test first where a correct seam exists (the
  `tdd` skill), fix, run the checks. A lean finding: delete or simplify, then run the checks.
- **Unsure**: settle it yourself with a probe or a test; it becomes confirmed or refuted.
  Reviewers are read-only; running code is your part.
- **A test gap** a finder names with a condition: confirm it by mutation. Copy the file, invert
  the condition, run the narrowest test command, restore the copy (`cp f /tmp/f.orig` before,
  `cp /tmp/f.orig f` after; `git diff` must show nothing left). Green suite: the gap is confirmed;
  add the one missing test.
- **Refuted**: one line in the report. Minors: fix only when trivial; otherwise list them.
- **Spec findings** that are a decision (an unasked feature you think is right, a requirement
  you think is wrong) go to the owner; do not decide scope alone.

After fixes, review only the fix diff: a new round, a fresh finder. A finding refuted or settled
with the owner is not reopened by a later round unless the code it is about changed. Stop when a
round has no confirmed blocker or major. Cap: 3 rounds. If a new finding appears exactly where you
just fixed (churn), or a blocker survives round 3, stop and ask the owner.

## 6. Report

```
Review of <target> (<base>..<head>), depth: <row of the table>, <N> agents, ~<tokens> tokens.
Checks: <commands run, pass/fail>.
What this change does: <two or three sentences>.

Must fix:  F1 …, F3 …        (confirmed blockers)
Should fix: F2 …              (confirmed majors)
Nice to have: F5 …            (minors)
Refuted: F4 (<one line why>).
Spec: <missing / unasked / wrong, or "matches", or "no spec">.
Lean: -<N> lines possible.
Callouts: <only those that apply: adds a migration; adds or changes a dependency; changes auth or
permissions; breaks a public API or schema; irreversible or destructive operation; changes a
config default or a feature flag>.
Not checked: <what mattered and was not run or read, e.g. "UI not run", "load not measured">.
Verdict: ship, or fix F1 and F3 first.
```

Number the findings across groups so the owner can say "fix 1 and 3". Nothing found: "What this
change does", "No defect, spec gap or needless code found in this scope", what was checked. A
clean review means nothing found in that scope, not proof of correctness. The callouts inform the
owner; they are not findings and do not change the verdict.

Comments on someone else's PR go to GitHub only when the owner asks; your session mode's `stop`
dial decides whether you may post at all.

## Without the agent tool

When the agent extension is off, run each finder and refuter as a headless pi with the same task:

```bash
timeout 900 pi --no-session --model role/reviewer --tools read,grep,find,ls -p "$(cat $R/finder-task.md)" </dev/null > $R/finder-1.md
```
