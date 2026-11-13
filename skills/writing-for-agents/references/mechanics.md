# Mechanics: skills, agent prompts, templates, tools

What changes with the packaging. The writing rules in the skill apply to all of them.

## Skills in pi (1.5.2)

```yaml
---
name: kebab-case-name             # = the folder name; a-z, 0-9, single hyphens; at most 64
description: What it does. Use when <case>, <case>.   # see the budget and the YAML traps
disable-model-invocation: true    # only for owner-invoked skills
---
```

pi also accepts `license`, `compatibility`, `metadata` and `allowed-tools` (experimental) from the
Agent Skills specification. A skill without a description, or with frontmatter YAML cannot parse,
is not loaded.

How a skill loads:

- At start-up pi lists each model-picked skill in the system prompt: name, description and the
  path of its `SKILL.md`. Nothing more.
- When the task matches, the model reads `SKILL.md` with the read tool, and reads a reference only
  when a pointer in it fires. Paths in a skill are relative to the skill's folder; pi tells the
  model where the folder is.
- `/skill:<name> <text>` loads the skill and appends the text as the owner's request. This works
  for every skill, model-picked or not.
- After an edit, `/reload` in a running session. A model may fail to load a relevant skill; the
  owner can always force it with `/skill:<name>`.

A skill can carry `references/` (read on demand), `scripts/` (run, never read: call them by
path relative to the skill folder), and assets (copied, never read).

## Model-picked or owner-invoked

The choice trades the two loads.

- **Model-picked**: the description is in context on every request, so the model can fire the
  skill on its own, and other skills can point to it by name. The owner can still start it with
  `/skill:<name>`. Pay this only when the model must reach the skill alone: the trigger is clear
  from the task itself (a bug report, a UI change).
- **Owner-invoked** (`disable-model-invocation: true`): no context cost; the description becomes a
  one-line note for the owner, with no trigger list. The owner is its index. Use it for process
  steps the owner chooses: planning, grilling, an audit, writing skills.

This harness makes process skills owner-invoked by default: in v1, model-picked process flows did
not fire reliably.

**Shared reference.** Material that several skills need lives in one place. A model-picked skill
can hold it, because others can name it. Two owner-invoked skills cannot reach each other: put
shared material in a plain file both point to.

**Splitting by invocation.** Split off a model-picked skill only when it has its own leading word
that should trigger it alone (a word the owner really uses) or another skill must reach it. The new
description is standing cost; the separate reach must be worth it.

**Router skill.** When owner-invoked skills grow past what the owner can remember, one
owner-invoked skill can list the others and when to use each. It can only point; it cannot start
them.

## Descriptions that trigger

- Lead with what the skill does, then "Use when" with one trigger per distinct case, in the
  owner's words, including short ones ("fix this", "make it nicer").
- When the model would do the task itself without the skill, say that the skill applies anyway
  ("even for one component", "even when the code is pasted inline"). In one published eval set that
  one clause took a review skill from 7 to 21 fires out of 27, with no false fires on nine neighbouring prompts. Firing rates change with the model and the agent
  version, so measure again after a change of either.
- Give each skill a border with its neighbours ("to check the page in a browser, use `browser-check`").
  Descriptions that share many words take triggers from each other.
- No workflow steps in a description: it is a pointer, not a summary.
- No `: ` and no ` #` (see the YAML traps in the skill). At most 240 characters.

## Agent prompts

`agents/<name>.md` defines an agent: frontmatter `name`, `description`, `tools`, `role`
(default: the name), `spawns`, `skills`; the body is appended to pi's system prompt with
`--append-system-prompt`, which reaches every model. A file in `~/.pi/agent/agents/` adds an agent
or replaces one of the same name. Never a model or a reasoning setting: the profile decides.

An agent prompt is read by a child with **no history**: it sees only its task and this prompt.
Write it for that reader:

- what the role is and the one kind of job it does;
- its limits (read-only, scope, when to ask the parent);
- the exact shape of its final report, because the parent sees only that message.

The brief a lead writes when it starts a child is the same kind of document: goal, what is already
ruled out, where to look, scope, and what to report.

## Prompt templates

`prompts/<name>.md` (listed in the package's `pi.prompts`) becomes `/<name>`. Frontmatter:
`description`, optional `argument-hint`. Arguments: `$1`, `$@`, `${1:-default}`. Use a template for
a fixed prompt with no files and no judgement about when to use it. Use a skill when it needs
references, scripts or model triggering.

## Tool descriptions and errors

A tool's description is standing cost while the tool is active, and the one channel that carries
guidance to every model. Keep in it what must stop a wrong call **before** it happens: what the
tool is for, when to use another tool, the parameters models get wrong. Everything else goes in the
tool's results and error messages, read only when the tool is called: an unknown parameter is
reported, an error says how to fix it, a result says what to do next. A unit test in this harness
keeps extensions off the channels that do not reach every model.

## Where things live

| Kind | Place |
| --- | --- |
| Harness skill, every repo | this package's `skills/<name>/` |
| A personal skill outside the package | `~/.agents/skills/<name>/` |
| One repo's skill | `<repo>/.agents/skills/<name>/` or `<repo>/.pi/skills/<name>/` (needs project trust) |
| A third-party skill | never installed directly: read it, then rewrite it here, or pin it as a package with its licence |
