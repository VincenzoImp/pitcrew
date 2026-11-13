---
name: work-planning
description: Plan work with the owner before building, from a one-line plan to a spec with slices or a map of decision tickets, questioning the owner until nothing is silently assumed. Say "grill" for the questions only, "few" for a short pass.
disable-model-invocation: true
---

# Work planning

A plan moves the owner's effort from writing code to deciding. Decide the things that are expensive
to get wrong before anything is built, and write them down so that another agent can build from
the plan **without this conversation**. Facts are your job; decisions are the owner's.

The words after `/skill:work-planning` choose the shape. The owner can change it at any time:

- **Plan** (the default): facts, questions, then a written plan at the right scale.
- **Grill** ("grill", "grill me"): the questions only. Walk the design to a shared understanding,
  summarise it, and stop. Write no plan and build nothing.
- **Few** ("few", "quick", "light"): ask only the questions whose answer would change the plan; the
  rest become labelled assumptions. It combines with either of the above.

"Wrap up" means: turn every open question into a labelled assumption, summarise, and go on to the
next step.

## The session mode here

The session mode message in the conversation gives the values.

- **`tracking`**: where the plan lives.
  - `none`: in the conversation. Write it to a file only if it must outlive the session (a
    handoff, another agent).
  - `local`: a Markdown file outside the repo. Run `node <this skill's folder>/scripts/plans-dir.mjs`
    from inside the repo: it prints the plans folder and creates it. Name the file
    `<YYYY-MM-DD>-<slug>.md`.
  - `github`: the plan becomes GitHub objects. The `github` skill says which object holds what and
    how to choose them for this piece of work; hand over to it once the content is agreed.
- **`stop`**: `plan` means stop when the plan is approved. Any other value: after approval, build up
  to that point.

The owner can name another home for one plan ("put it in an issue"); that wins for that plan. Never
put the plan, the ledger or a review in the repo's tracked tree unless the owner asks.

## Scale

| Work | Plan |
| --- | --- |
| Small, clear, one session | A few lines: outcome, the check that proves it, the steps if not obvious |
| Several slices or sessions, decisions mostly known | A **spec** with slices: [references/spec.md](references/spec.md) |
| Large and foggy: the route is not visible, more than one session can hold | A **map of decision tickets**: [references/decision-map.md](references/decision-map.md); it ends in a spec |

Say which scale you chose and why, in one line. Planning depth is the owner's choice: some plans
take one message, some a long joint session in which you explain every choice and its early
consequences. Say when you think a plan is too thin or too heavy for the work.

## 1. Facts first, yourself

The **map** is what is in the conversation: the request, the plan, your assumptions. The
**territory** is what is real: the code, its tests and configuration, the README and contribution
rules, the issues and PRs, the docs of the libraries involved, the deployment. The unknowns are the
gap between the two.

Read the territory before you ask. Use `scout` agents (the `agent` tool) to read wide areas or
external docs in parallel. When you cannot reach a source, say so and mark the claim unverified.
Restate the request in a few lines: the goal, what is known, what you checked. Never ask the owner a
fact you can look up.

Also question the request itself. Does it need to exist? Does the codebase, the platform or an
installed dependency already do it? Agents rarely push back; the owner wants you to.

## 2. Decisions with the owner

Decisions (scope, behaviour, names the user sees, trade-offs) belong to the owner. Ask only what
changes the work and what you cannot find out yourself. Turn low-risk unknowns into labelled
assumptions instead of questions (`A2: amounts are in one currency. Wrong if: an invoice mixes
currencies.`).

### Relentless (the default): the design tree

Map the topic as a **design tree**: every decision branches into the decisions that depend on it.
Work in **rounds**. The **frontier** is every decision whose prerequisites are settled. Ask **the
whole frontier** in one round, each question numbered, with your recommended answer, worded so that
"yes" accepts it:

```
**Q1. <short title>**: <the question; several paragraphs or options if needed>

→ Recommended: <your answer, and why in one line>
```

Then stop and wait. Each round of answers moves the frontier: recompute it and ask the next round. A
question whose answer depends on another question still open belongs to a later round. When a
question needs a fact, start a `scout` agent and do not block on it: only the questions that depend
on it wait.

There is no question limit; the fix for a low-value question is to not ask it. The questioning is
done when the frontier is empty: every branch visited, nothing silently assumed.

### Few questions: priced by evidence

Ask only questions that are all three:

- **Material**: the answer could change the architecture, the scope, what the user sees, the data
  model, security, permissions, cost, or the acceptance checks.
- **Grounded**: it points at something you found in the code or the docs, or a concrete uncertainty.
- **Answerable**: the owner can pick an option, accept a default, or point to an example.

Ask **one blocking question at a time**, the one most likely to change the plan:

```
Blocking question: <question>
Why it matters: <what changes between answer A and answer B>
Evidence: <file, doc, test or issue it rests on>
Recommended: <default and reason>
If you don't mind: I will go with <default>.
```

Say the count as it shrinks ("2 material unknowns left"). After about five, ask whether to go on.
When answers get short ("just pick"), stop asking and show the rest as one list of labelled
assumptions to veto.

### Both styles: find the unknowns

| Kind | Meaning | How to expose it |
| --- | --- | --- |
| Known knowns | stated or proven by docs or code | restate, with the source |
| Known unknowns | a decision everyone knows is open | ask, or choose a labelled default |
| Unknown knowns | the owner will recognise the right result when shown, but has not said the rule | prototypes, sketches, examples |
| Unknown unknowns | constraints or options nobody has thought of yet | a blindspot pass |

- **Unknown knowns**: show instead of asking: a cheap prototype with fake data, two or three
  directions with real contrast, or similar code in the repo plus one outside reference. Turn each
  reaction into a criterion. When a test cannot check quality, the criteria become a short rubric,
  and the rubric is the acceptance check.
- **Blindspot pass**: in an unfamiliar domain or code area, or a high-stakes integration, search
  the docs, code and tests for what could change the plan, including the limits and known failure
  modes of its dependencies: [references/blindspot-pass.md](references/blindspot-pass.md).
- **Domain words**: challenge a term that conflicts with the project's words, sharpen fuzzy ones,
  test them with edge-case scenarios. When the owner says how something works and the code
  disagrees, show both and ask. Where terms are written down follows the repo (the
  `codebase-design` skill, "Domain language").
- A long questioning can keep a working ledger (map, territory, unknowns, design tree, queue):
  [references/ledger.md](references/ledger.md).

### When no one can answer

In a print-mode run or a `worker` agent, ask nothing: write each question with its recommended
answer as a labelled assumption, and continue.

### The shared understanding

Before anything is written or built, summarise: the decisions with their answers, the assumptions
with how each would show itself wrong, what is out of scope, what is still open. Ask the owner to
confirm it, unless they told you to go ahead with the assumptions. **Grill ends here.**

## 3. Agree the test seams and the acceptance checks

Before any code, agree with the owner **where the work will be tested** and **what proves each
part done**. This makes the plan buildable by an agent and checkable by the owner.

- **Seams**: the public interfaces where tests observe behaviour (the `tdd` skill). Prefer seams
  that exist. Use the highest seam that is still fast and deterministic; the fewer, the better. For
  each seam, one line on what a test there catches and misses.
- **Acceptance checks**: each slice ends in lines a person or an agent can tick:

  ```
  - [ ] V3: an expired token is rejected after 15 minutes. Check: `npm test -- auth.expiry`
  - [ ] V4: the login page shows the error text. Evidence: screenshot of the page
  ```

  `Check:` with a command when one exists; `Evidence:` for a screenshot, a recording or a manual
  flow. A slice with no check is not specified yet.
- The whole plan has one **done-check**: the command, test or demo flow that proves the outcome.

## 4. Slice vertically

- Each slice cuts a narrow but **complete** path through every layer it needs (data, logic,
  interface, tests), and can be shown or checked on its own.
- Each slice fits one fresh session of a `worker` agent. The first is the thinnest path end to end.
  Later improvements must not become hidden prerequisites of earlier slices.
- **Prefactor first**: if a change to the existing code makes the work easy, that is the first slice.
- Each slice lists the slices that **block** it; mark slices that can run in parallel.
- **Wide refactors** (a rename, a retyped shared symbol) cannot land green as one slice. Sequence
  them **expand → migrate in batches → contract**: add the new form beside the old; move callers in
  batches, each its own slice, each green; delete the old form last.

Then check the breakdown with the owner as a numbered list (title, blocked by, what it delivers):
is the granularity right, are the blocking edges real, should any slices merge or split?

## 5. Unknowns that block slices

An open question that blocks part of the plan and cannot be settled now becomes a **decision
ticket**: a question whose answer is a decision, not code. The slices it blocks list it. It is
resolved by research, a prototype, a questioning session, or a task that must happen first. When
most of the effort is still fog, plan it as a map of decision tickets first:
[references/decision-map.md](references/decision-map.md).

## 6. Write the plan for someone else

Test it with one question: could a `worker` with no access to this conversation build every slice
from the plan alone, and a fresh `reviewer` check it?

- State decisions, not only results: what was chosen, and what was rejected and why, when that is
  not obvious.
- No file paths or code snippets that will go stale, except a prototype snippet that states a
  decision more precisely than prose (a state machine, a schema, a type).
- Use the project's domain words.
- Include a **deviation policy**. Default: a low-risk local difference: take the conservative
  option, note it, continue. A change to architecture, data migration, security, cost or
  user-facing behaviour: stop and ask. Docs or code that contradict the plan win; update the plan.

The spec format is in [references/spec.md](references/spec.md).

## Review and approval

For a costly or one-way plan, offer a review by fresh agents: the owner runs `/skill:spec-review`.
The owner approves the plan; record it in the plan (a status line: approved, and the date). A change
after approval needs a new approval. Then, at `stop` `plan`, stop and give the plan's location;
otherwise build slice by slice, blockers first, up to the `stop` point.

## While building

- Keep the plan true. When the territory changes the plan (a decision, an assumption proven wrong,
  a new unknown), update it. A change to scope or an agreed decision goes back to the owner.
- A slice is done when its acceptance checks ran and passed on the final code.
- At the end, report what changed and why, which assumptions remain, and which checks ran.

## Context hygiene

Keep the facts, the questions, the plan and the slicing in **one unbroken session** when you can: a
summary loses the why. Once the plan is written, each slice can start in a fresh session from the
plan alone. If the session fills up before the plan is written, end the current step, then use
`/handoff` with the next step as its goal.
