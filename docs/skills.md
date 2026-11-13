# Skills

A skill is method for one kind of work, written for this harness: it uses its roles, session mode,
tools and words ([glossary.md](glossary.md)). A skill says how to work well; it fixes a file name or
a step only when another agent or the code must find the result later. No line cap; no padding. A
skill does not say where its text comes from: copied text and its licence are in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## How skills are picked

- **Model-picked**: the description is always in context (about 60 tokens each), and the model
  loads the skill when the work matches. Only for skills whose trigger is clear from the task
  itself. The global rules (`AGENTS.global.md`, section "Skills") also map each kind of work to its
  model-picked skill in one line; that line raised the loading rate on every model measured
  ([TESTS.md](TESTS.md), Skills). `npm run check` fails when the list and the skills disagree.
- **Owner-invoked** (`/skill:<name>`): steps the owner chooses to start. They cost nothing until
  used.

## The catalogue (14 skills)

| Family | Skill | Picked by | What it is for |
| --- | --- | --- | --- |
| Plan | `work-planning` | owner | from one line to a spec with slices or a map of decision tickets; questions the owner first (relentless by default; `grill` for the questions only, `few` for a short pass) |
| Plan | `spec-review` | owner | review a plan with distinct reviewer personas on fresh `reviewer` children; rounds until clean |
| Build | `diagnosing-bugs` | model | reproduce first, shrink, ranked hypotheses, fix the cause |
| Build | `tdd` | model | agree the seams, vertical slices, no tautological tests, when to mock; one test per risky logic, not more |
| Build | `codebase-design` | model | deep modules, the deletion test, design it twice, a glossary when the domain is unclear |
| Build | `frontend-design` | model | UI work that does not look generated; accessibility checklist |
| Build | `prototype` | owner | a throwaway to answer one question; demo and hackathon mode |
| Check | `code-review` | model | fresh finder, one refuter per finding, depth by risk; axes: defects, spec, standards, needless code |
| Check | `browser-check` | model | prove a UI change in a real browser |
| Check | `security-audit` | owner | shard, hunt by attack class, validate, report with a checked schema |
| Deliver | `github` | model | which GitHub object holds what, chosen per piece of work; one procedure: issue → branch → verify → review → PR → merge → `pitcrew tidy`, as far as the stop dial allows; a whole milestone in a session |
| Deliver | `repo-setup` | owner | enter an existing repo by its rules, or bootstrap a new one |
| Know | `web-research` | model | lookup order, trust order, researcher fan-out, cited notes, citation check |
| Know | `writing-for-agents` | owner | write and trim skills, AGENTS.md and prompts |

Already commands, not skills: `/handoff`, `/mode`, `/profile`, `/role`, `/agents`. A whole
milestone that should run unattended goes to `pitcrew run`, not to a skill.

## Left out, and why

| Left out | Why |
| --- | --- |
| `explain` (visual explainers), `teach` | not needed to build software; add when a real need shows |
| `retro`, session mining, snippets | need weeks of real sessions first ("nothing ships without use") |
| team triage flows, setup wizards, generic coding advice | team flows, or text a strong model does not need |

## Quality check

- **Lint** (`tests/skills.test.mjs`, in `npm run check`): pi's loader loads every skill without a
  warning; model-picked descriptions have at most 240 characters; no model, vendor or effort level in
  a skill; every relative link resolves; no provenance text; the global rules name exactly the
  model-picked skills; the standing cost is printed.
- **Behaviour** (`tests/live/eval.mjs`, not in `npm run check`: it calls a model): cases in
  `tests/live/evals/<case>/` (a setup script that builds a small scratch repo, the prompts, and
  checks on tool calls, the final message, the transcript, or a command in the repo). A case is
  named after its skill; a second case of a skill adds a suffix (`github-plan`).

  ```
  node tests/live/eval.mjs --list
  node tests/live/eval.mjs code-review                      # local profile, no subscription quota
  node tests/live/eval.mjs code-review --profile claude-bridge   # the profile's lead and children
  node tests/live/eval.mjs code-review --load-only          # only: is the skill loaded? (cheap)
  node tests/live/eval.mjs code-review --keep               # keep the repo and agent dir
  ```

  It prints pass or fail per check, minutes, and tokens (lead and children). Results go in
  `docs/TESTS.md` with the model that ran each case. Run every case of a changed model-picked skill
  on the lead at least once.
- **Standing cost**: global rules plus the descriptions of the model-picked skills, printed by
  `npm run check`. Target about 1,500 tokens (6,000 characters); reported, not enforced. Hard
  limits: 240 characters per description, 4,200 characters for the global rules.

A lexical routing test (TF-IDF of the descriptions against sample prompts) was removed: it passed
while the small models still did not load the skills, and every new skill needed new sample prompts.
The loading measure is `eval.mjs --load-only` on real models.
