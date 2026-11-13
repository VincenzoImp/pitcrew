# Testing documents for agents

Cheap to expensive. Every change gets the first; a new or changed skill gets the second; a large
change or a full diet gets the third.

## 1. Lint (free, every change)

`npm run check` runs `tests/skills.test.mjs`, which checks:

- pi's own loader loads every skill folder without a warning, under the folder's name;
- model-picked descriptions have at most 240 characters;
- no skill names a model, a vendor or a reasoning setting;
- every relative link in a skill's Markdown resolves;
- the global rules name every model-picked skill, and only those;
- it reports the global rules plus all model-picked descriptions (target 6,000 characters).

A failure here is never fixed by loosening the test.

## 2. Live run (tokens of the local model)

On the development machine, with a throwaway agent dir and the RPC driver of the harness repo:

```sh
eval "$(tests/live/agent-dir.sh)"     # loads this checkout, local profile, no subscription quota
cd <a scratch repo made for the case>
node <harness>/tests/live/drive.mjs '{"args": ["--stop", "local"], "prompts": ["<request>"]}'
```

- **Listed and loads**: the skill appears at start-up, and `/skill:<name>` loads it.
- **Fires** (model-picked skills): a request in the owner's words that does **not** name the skill
  loads it. Also try one or two neighbouring requests that must **not** load it.
- **Behaves**: one small, realistic task per skill, with the behaviour that must show written down
  before the run. The driver prints each tool call and message; compare them with the list.

Record the date, pi version, model, the expected behaviour and what you saw in `docs/TESTS.md` of
the harness repo, as a short table. Say what did not show, and why. Remove the throwaway agent dir,
the scratch repo and any process you started.

One run per case shows that a skill can work, not how often it does. Firing is stochastic and
changes with the model and the pi version.

## 3. Before / after / none (for a large change or a diet)

**Versions**: **before** (the old skill), **after** (the new one), **none** (no skill). A task
**none** passes shows rules the model follows anyway: their lines can go.

**Tasks**: 10 to 15 one-line requests from real sessions (pi keeps them under
`~/.pi/agent/sessions/`), including any case the owner names. Each task points at a small fixture
and has a **check command** that asserts the end state (exit 0 = pass). Cover every pointer in
`SKILL.md`, one task per ban, and each risky area. Run each ban's bad command once on this machine
first: a rule that cannot fail here gets no task, and its line is a cut candidate.

**Runs**: each task three times per version, the same model, a fresh session each time (the live
run above, with the skill folder swapped per version). Run two tasks first to check the checks.

**Reading results**:

- Read every failing output before you touch the skill: the check is often wrong (it accepts one
  valid shape and rejects another). Before you loosen a check, show only the task and the answer to
  a fresh agent, and loosen it only if that agent says the answer does the job. Then rerun that
  task in every version.
- Count every tool call in a run, not only the first: rules about waiting or stopping show later.
- For quality output (a page, a design, prose), a fresh `reviewer` judges before/after pairs
  blind, in random order.

**Ship** when **after** never fails a task **before** always passed, is not worse beyond chance
(with three runs, a drop of one run in one task is noise; a pattern across tasks is not), and uses
fewer tokens per run or fixes drift. Record the table, the token counts and the model in the commit
message and `docs/TESTS.md`.

This harness has no eval runner yet: the runs are made with the driver by hand. If before/after
tests become frequent, a runner is a separate issue.
