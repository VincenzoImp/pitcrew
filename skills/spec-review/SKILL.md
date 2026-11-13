---
name: spec-review
description: Review a plan or spec with fresh reviewer agents, each with its own mandate, in rounds until no blocking finding is left.
disable-model-invocation: true
---

# Spec review

A plan is written by the agent that holds the whole conversation. That memory is also its blind
spot: it reads the plan with everything it knows, and cannot see what the plan does not say. So the
plan is reviewed by fresh `reviewer` agents that see only the plan and the repo, never the
conversation. Each one reads with a different mandate, because one generic reviewer finds the
obvious gaps and misses the rest: a reader who knows nothing finds undefined terms; the engineer
who must build it finds decisions left open; a skeptic finds what should not be built at all.

You (the author, with the memory) then resolve each finding: fix it, contest it with evidence, or
take it to the owner. Rounds repeat until no blocking finding is left.

## Cost

Each reviewer reads the plan and the code it touches: about 20–50K tokens per reviewer per round
(about 20K for one reviewer on a one-page plan). Four reviewers over two rounds are 150–400K
tokens. Scale the panel to the plan and say the cost before you start.

The owner starts it: `/skill:spec-review <path to the plan>`. It pays for a plan that is costly or
hard to undo (a data migration, a public API, security, a multi-session build).

## 1. Pin the target

- **The plan**: a file (a local plan from the `work-planning` skill, a spec in the repo) or a
  GitHub issue body (save it with `gh issue view <n> --json body --jq .body > <file>`). Reviewers
  read files.
- **The kind**: a short plan (one slice), a spec with slices, a design or proposal without an
  implementation part, or documentation of existing code. The kind picks the standards in
  [references/standards.md](references/standards.md).
- **The reading list**: the files the plan links or depends on, the code it changes, the repo's
  AGENTS.md and README. Links inside the repo are included; URLs are saved to files first (a
  reviewer has no web tools). Do not add context only a reviewer would need: if a human reader
  needs it, it belongs in the plan.
- **Where the report goes**: outside the repo, always (the repo's tree is not for the harness's
  bookkeeping): `<plan name>.review.md` in the harness plans folder (`node <the work-planning skill's
  folder>/scripts/plans-dir.mjs` prints it), also when the plan itself is a file in the repo. Only the
  owner moves it into the repo.

## 2. The panel

The reviewers and their mandates are in [references/personas.md](references/personas.md). Pick by
the size of the plan:

| Plan | Reviewers | Rounds to converge |
| --- | --- | --- |
| Short (one slice, under a page) | `zoom-out`, `readiness` | one clean round |
| Spec with slices | `zoom-out` first; then `comprehension`, `readiness`, `codebase` | one clean round; two in a row at rigor `strict` |
| Large, costly or one-way (several sessions, migration, public API, security) | `zoom-out` + `alternatives` first; then `comprehension`, `design-critic`, `readiness`, `codebase`, `style`; plus `design-critic` again on the `second` role when the profile has one | two clean rounds in a row |
| A design or proposal with no implementation part | `zoom-out`, `comprehension`, `design-critic` | one clean round |
| Documentation of existing code | `codebase`, `comprehension` | one clean round |

The order matters. `zoom-out` (and `alternatives`) run first, alone: a plan that solves the wrong
problem or should not be built does not need a readiness review. If they report a blocker, stop and
take it to the owner before you spend the rest of the panel.

Later rounds re-run only the reviewers whose last round had an open blocker or major finding, plus
`comprehension` when the plan changed a lot (a fresh reader catches what the fixes broke).

## 3. Run a round

Start each reviewer with `agent start {agent: "reviewer", task}`, all in one turn so they run in
parallel (add `role: "second"` for a second-vendor reviewer). The task must carry the persona's mandate in full,
because the reviewer has no other access to it:

```
You review a plan as <persona name>. You have no history of this work: read it as someone who
joins the project today. Do not fix anything; report findings.

Mandate:
<the persona's mandate from references/personas.md, pasted in full>

Standard to check against:
<the standard from references/standards.md, pasted in full; or "none">

Plan: <path> (<the whole file | lines or section>).
Reading list: <paths>. Read the plan fully first, then what you need from the list and the repo.

For each finding:
- Severity: blocker | major | minor
- Scope: section heading or lines
- Finding: the gap, contradiction or risk, and why it matters
- Recommendation: what the plan should say instead (one or two lines)
Report only what you can point to in the text or the code. No finding is a valid result.
```

A reviewer that fails, times out or returns no report did not review. Start it again once. If it
fails again, its status is **not run**. A reviewer that did not run is never a reviewer with zero
findings: a round with a reviewer not run is not a clean round.

Give each finding a stable id (`<persona>-<round>-<n>`) and keep a list across rounds: id,
severity, scope, finding, status.

## 4. Resolve

You wrote the plan, so a wish to contest is not evidence that the reviewer is wrong. Give each
finding exactly one decision:

- **Fix**: the finding is right. Write the exact change to the plan.
- **Contest**: the finding is wrong, and you can cite evidence the reviewer could read: a file and
  symbol, or a decision recorded in the plan. "This was intentional" is not evidence.
- **Escalate**: the finding is wrong, but the evidence is outside every file the reviewer could
  read (a decision the owner made out loud, a team convention). Do not fix; give it to the owner,
  and if a human reader would need the fact too, add it to the plan.
- **Decline**: a minor finding not worth changing. Record it.

Rules:

- Do not contest a comprehension gap. If a fresh reader could not follow the plan, the plan is
  missing context.
- Do not change a severity. If you think a blocker is minor, contest it and say why.
- Do not add context only to satisfy a reviewer.

Write the review report (format below), then the owner decides:

- **Owner present**: list escalated findings first, then the rest; ask once whether to apply all
  fixes, go through them one by one, or stop. Apply what the owner accepts.
- **No owner** (a worker, a print-mode run): apply the fixes, record contests and escalations in
  the report, and do not approve the plan: approval stays with the owner.

## 5. Converge

- **Settled**: a finding that was contested, escalated and answered, or declined. Keep the settled
  list across rounds; a later reviewer raising the same issue at the same scope does not reopen it.
- **Fixed is not settled**: if a later reviewer raises the same issue at the same scope, the fix
  failed or a later edit undid it. Reopen it.
- **Clean round**: no reviewer raises a blocker or major finding that is not settled, and every
  reviewer ran. Nits do not block. Decide this from the results, before you apply the round's
  fixes.
- **Converged**: the number of clean rounds the table in step 2 asks for. Fresh reviewers sample
  differently, so one clean round is weaker than two; the table trades that against cost.
- **Cap**: 3 rounds (`optional`), 5 rounds (`on`).
- **Churn**: a new finding sits exactly where you applied a fix, and undoing the fix would resolve
  it. Stop.

On cap or churn, list the open findings by severity and ask the owner one question: accept and
approve, run more rounds, or return the plan to planning.

## Report

```
# Spec review: <plan>

Rounds: <n> (<converged | cap | churn | stopped by owner>). Reviewers: <n> agents, ~<tokens> tokens.

| Reviewer | Round 1 | Round 2 |
| --- | --- | --- |
| zoom-out | completed, 1 major | completed, clean |
| readiness | not run (failed twice) | completed, clean |

## Findings
### readiness-1-2 [blocker] <title>
- Scope: <section or lines>
- Finding: <copied from the reviewer>
- Decision: fix | contest | escalate | decline: <reason, with evidence for a contest>
- Change: <the exact edit, if fixed>
- Status: fixed in round 1 | settled | open
```

The plan records the review in its status line ("reviewed: 2 rounds, converged, report at
<path>"). Approval stays the owner's (the `work-planning` skill).
