---
name: writing-for-agents
description: Write, edit, trim or test text an agent reads, such as skills, AGENTS.md, agent prompts, prompt templates and tool descriptions, by the rules of this harness.
disable-model-invocation: true
---

# Writing for agents

One reference for every document an agent reads: a skill, a rules file, an agent prompt, a prompt
template, a tool description, a doc reached by a pointer. The packaging differs; the writing does
not. The aim is a **predictable process**: the agent takes the same path every run, even when the
output differs.

The first half is the rules of this harness: they are checked, and a document that breaks one
fails a test or fails silently. The second half is how to write well. The procedures (edit, full
diet, new skill, test) come last.

## The documents and their cost

| Document | Where | Read by the model |
| --- | --- | --- |
| Global rules | `AGENTS.global.md`, linked as `~/.pi/agent/AGENTS.md` | every request, every session |
| Repo rules | `AGENTS.md` at a repo's root | every request in that repo |
| Skill description (model-picked) | `skills/<name>/SKILL.md` frontmatter | every request |
| Skill body and references | `SKILL.md`, `references/` | when the skill is used |
| Agent prompt | `agents/<name>.md` | every time a child of that agent starts |
| Prompt template | `prompts/<name>.md`, run as `/<name>` | when the owner runs it |
| Tool description | the tool's `description` in an extension | every request while the tool is active |
| Tool result and error text | the extension's code | when the tool is called |

The top rows are **standing cost**: paid on every request whether they help or not.

## Rules of this harness

### Channels that reach every model

Some sessions reach their model through a subscription bridge that runs another agent CLI under
pi. The bridge does not pass everything pi builds. Measured (`tests/live/fidelity.sh`, pi 1.5.2):

- **Reach every model**: global and repo rules, skill descriptions, tool descriptions, tool
  results, messages an extension adds to the conversation, custom prompt sections,
  `--append-system-prompt` (agent prompts use it).
- **Lost on the bridge**: a tool's `promptGuidelines` and `promptSnippet`, and a whole system
  prompt returned from `before_agent_start` (dropped silently).

Put instructions only in the first group. What a tool needs the model to know goes in its
description, or in its result and error text. After an upgrade of pi or the bridge, run the
fidelity test again before you rely on a channel.

### Standing cost

- The global rules plus every model-picked description: a target of about 6,000 characters (about
  1,500 tokens), reported by `tests/skills.test.mjs`, not enforced; the global rules alone have a
  limit in `tests/package.test.mjs` (raise it rather than cut a needed line). Report the new total
  when you change either. A new model-picked skill needs a line in the
  global rules' "Skills" section (a test checks it) and an eval case in `tests/live/evals/`.
- A model-picked description: at most 240 characters.
- An owner-invoked skill (`disable-model-invocation: true`) costs nothing until `/skill:<name>`.
  Make a skill model-picked only when the model must find it alone.

### Frontmatter that pi silently drops

pi parses the frontmatter as YAML. A description that YAML cannot read drops the skill **with
only a start-up warning**: the skill is simply not there.

- **`: ` (colon and space) inside a description** makes YAML read a second key. Rephrase ("such as
  …", a comma, a dash), or quote the whole value.
- **` #` (space and hash)** starts a comment: the rest of the line is lost without any warning.
- A value that starts with `[`, `{`, `&`, `*`, `!`, `|`, `>`, `%`, `@`, a quote or a backtick
  needs quotes.
- `name` is the folder name: lowercase letters, digits and single hyphens, at most 64 characters.

`npm run check` loads every skill with pi's own loader and fails on any warning. Run it after
every frontmatter change.

### Roles, never models

Name roles (`lead`, `worker`, `scout`, `reviewer`, `second`) and the `agent` tool. Never a model
id, a vendor or a reasoning setting: the owner decides which model answers for each role, and a
skill must work on every model. A test rejects model and vendor names in skills.

### Method, not choreography

A document says how to work well: what done means, what to check, what to avoid. It fixes a file
name, a step order or a format only when another agent or the code must find the result later.
Each fixed detail must pass the question: **who needs this to be the same every time?** If the
answer is nobody, describe the goal and let the agent choose the route.

### The repo comes first

- A repo's own conventions (layout, naming, branches, commit style, docs) win over every harness
  default. A skill says "where the project keeps it", not a path.
- The harness never adds files to a repo's tracked tree for its own bookkeeping. Its working files
  (plans, handoffs, reports, run ledgers) live outside the repo, in the work folder of the
  footprint doc (`docs/footprint.md` in the harness repo); scratch files go in the temp folder.
- Agents edit rules files, skills, extensions and settings only when the owner asks.

### Simple Technical English

All harness text is English, written about 80 % of the way to ASD-STE100:

- One instruction per sentence, in the imperative. Instructions at most about 20 words,
  descriptions about 25.
- Present tense, active voice. Say who does what.
- **One word for one meaning, and one meaning per word.** Use the same word for the same thing
  every time; a synonym for variety makes the reader look for a second meaning.
- Common words; technical names exactly as the tool writes them. No idioms.
- Keep the articles ("the", "a"): telegram style saves few tokens and loses meaning.
- Lists for parallel items, tables for comparisons, code blocks for anything typed.
- No padding, no hedging, no capitals or exclamation marks for emphasis.

### Code enforces, prose guides

A mechanical rule (a limit, a format, a forbidden call, a cleanup) belongs in code: a check, a
test, a guard rule, a clearer error message. Prose is for judgement. Anything that must always
happen goes in a hook, the verify gate or CI, never only in a skill.

### Outside text and licences

- A skill does not say where its lines come from. Text or code copied closely from another
  project is recorded once, with its licence, in `THIRD_PARTY_NOTICES.md` at the harness repo
  root. Projects that only gave ideas go in its References list.
- MIT and Apache-2.0 text may be copied where it fits; add its notice to that file in the same
  change. A file modified from Apache-2.0 text keeps one line that says so. From a repo with no
  licence, take ideas only and write your own text. Never take text or code from AGPL sources.
- A source is input, not a payload. Read every file of it in full, decide what this harness needs,
  and write one coherent document in its terms. Copy a passage only where it fits as it is.

## How to write well

### Context pointers

A **context pointer** is text in the agent's context that names material outside it and says when
to reach for it. A skill description is one; a line in `AGENTS.md` that names a doc is the same
thing; so is a link in `SKILL.md` to a reference file. The **wording** of the pointer, not the
material behind it, decides when and how reliably the agent reaches the material. A must-have
target behind a weak pointer is a variance bug: sharpen the wording first, and move the material
up only if that fails.

A pointer does two jobs: it says what the material is, and it lists the **branches** that should
trigger it (a branch is a distinct case the material handles). An always-loaded pointer is paid
on every request, so prune it harder than the body:

- Put the **leading word** first: the pointer does its triggering there.
- **One trigger per branch.** Synonyms that rename one branch are that branch written twice.
- Cut what the body already says about itself.
- Write triggers in the words the owner really types ("make it nicer", "this is broken").
- Give each skill a border with its neighbours ("to check the page in a browser, use `browser-check`").

### The two loads

- **Context load**: the cost of always-loaded text on the model's window, in tokens and attention,
  whether it fires or not.
- **Cognitive load**: the cost on the owner, who must remember which documents exist and when to
  use them. The owner is the index of every owner-invoked skill. This is the price of the owner's
  control: spend it where the owner's judgement matters.

Material behind a pointer escapes context load at the price of the pointer's line. Material with
no pointer at all rests entirely on the owner's memory.

### Information hierarchy

A document holds **steps** (actions in order) and **reference** (definitions, rules, facts to look
up). The core decision is where each piece sits on the ladder, ranked by how soon the agent needs
it:

1. **Step in the file**: what the agent does, in order.
2. **Reference in the file**: looked up when needed. A flat list of peers (every rule of a review
   at one level) is fine.
3. **Disclosed reference**: a separate file behind a pointer, loaded only when the pointer fires.

**Progressive disclosure** moves material down the ladder so the top stays readable. The test is
branching: keep in the file what every branch needs; disclose what only some branches reach.
Reference that should be disclosed but sits between the steps buries them, and attention to each
step becomes a coin toss.

**Co-location**: once a piece has its rung, keep a concept's definition, rules and exceptions under
one heading, so reading one part brings its neighbours. The document should read like
documentation written for the agent.

**Sprawl** is a document that is simply too long, even when every line is live. Attention thins
across the excess. The cure is the ladder: disclose reference, split by branch or by sequence.

### Steps and completion criteria

Every step ends on a **completion criterion**: the condition that tells the agent the step is done.

- **Clarity**: can the agent tell done from not done? A vague end ("understand the code") invites
  **premature completion**: the agent ends the step early because the next steps pull at it.
  Sharpen the criterion first. Only if it cannot be sharpened, and you see the rush, hide the later
  steps by a real context boundary: a hand-off or a child. Text later in the same file is not
  hidden.
- **Demand**: how much the criterion asks. "Every caller accounted for" forces the digging that
  "list the callers" does not. Demand also binds flat reference: "every rule applied".

The strongest criteria are both checkable and exhaustive: "you can name one command you already
ran that goes red on this bug".

### When to split

Splitting one document in two spends one of the two loads, so split only when the cut earns it:

- **By sequence**: when the later steps tempt the agent to rush the current one. Merging sequences
  does the reverse.
- **By invocation**: when a part needs its own trigger (model-picked) or the owner wants to start
  it alone. See [references/mechanics.md](references/mechanics.md).

### Leading words

A **leading word** is a compact concept the model already knows that it thinks with while it runs
the document: *tight* loop, *red* signal, *tracer bullet*, *seam*, *fog of war*, *relentless*.
Used as one word, repeated, it anchors a whole region of behaviour in a few tokens. Prefer a word
the model knows to one you coin: a coined word must be defined, a known one comes free.

A leading word works twice: in the body (the agent reaches for the same behaviour every time the
word appears) and in a pointer (when the same word lives in the owner's prompts, the docs and the
code, the agent links them). Look for passages that spell out one idea in a sentence or a triad,
and fold them into one word: "fast, deterministic, low overhead" is *tight*; "a loop you believe
in" is *red*.

### State the target, not the ban

A prohibition puts the forbidden behaviour into context and makes it **more** available: the
negation is a weak modifier on a strong concept. State the behaviour you want ("write one-line
comments"), so the unwanted one is never named. Keep a prohibition only for a hard guardrail with
no positive form (safety, secrets, data loss), and pair it with the target.

### Pruning

- **One source of truth**: each meaning lives in one place, so a change is a one-place edit.
  Duplication costs tokens and maintenance, and raises a meaning's weight past its real rank.
  (A leading word repeats a token on purpose, never a meaning.)
- **The environment is a source of truth too**: `package.json` scripts, configuration files, the
  folder layout, `--help` output. A document that repeats them is a cache that goes stale. Keep
  only what looking cannot find: the unwritten convention, the reason for a choice, the trap no
  file mentions.
- **Relevance**: does each line still bear on what the document does? Lines lose relevance by
  never applying (exposition, a branch that should be disclosed) or by going stale. Without
  pruning, documents collect **sediment**: old layers that stay because adding feels safe and
  removing feels risky.
- **No-ops**: a sentence the model already obeys by default costs tokens and says nothing ("be
  thorough", "think step by step", "double-check your work"). The test is the model's behaviour,
  not the reader's opinion: settle a disagreement by running the document. Delete the whole
  sentence. A leading word too weak to beat the default is also a no-op: the fix is a stronger
  word (*relentless*, not *thorough*).

## Procedures

### Edit an existing document

Stop at the first step that handles the change.

1. **Fix it below the document.** A mechanical mistake gets a check, a test or a clearer error,
   not prose.
2. **Check the model needs it.** If a fresh session does the right thing without the line, add
   nothing.
3. **Edit, do not append.** Change the line that already covers the idea. Each meaning lives in
   one place across the skill, its references and the tool's own docs.
4. **Pick its level** on the information hierarchy.
5. **Write the rule, not the story.** One positive rule under a short name. The incident that
   caused it goes in the commit message.

When code changes a name or a behaviour a document describes, update the document in the same
change.

**Budget.** Put the size before and after in the commit message, and pay for growth with a cut.
When a skill is more than 10 % larger than at its last full diet, or one idea appears in two
places, give it a full diet.

**Verify.** Run the case that caused the change again in a fresh session, and `npm run check`.

### Full diet

For a large, bloated or drifted document: baseline, place, cut, write, verify with a
before/after test. For a skill that teaches a tool, extra steps keep only what the tool cannot say
for itself. [references/diet.md](references/diet.md).

### A new skill

Make one only when a workflow repeated, a fact had to be found twice, or a session just succeeded
at a hard task that will come back. A one-off does not need a skill.

1. Draft while the session that did the work is still in context: the trigger, what every use
   needs, the traps found, the check for done.
2. Decide **model-picked or owner-invoked** and where it lives: [references/mechanics.md](references/mechanics.md).
3. Read the full sources it draws on, and write it by the rules above.
4. Test it: [references/testing.md](references/testing.md).

### Test

Lint with `npm run check` on every change; a live run on the local model for a new or changed
skill; a before/after comparison for a large change or a diet. [references/testing.md](references/testing.md).
