# Full diet

Rewrite a whole skill (or a rules file, or an agent prompt) onto the levels, then show that agents do
not do worse with it. Use it when a skill is large, loads detail most tasks never use, has grown
more than 10 % since its last diet, holds one idea in two places, or has drifted from the tool it
teaches.

## The levels

Put each fact on the lowest level that still reaches the agent before it needs it.

| Level | Holds | Loaded |
| --- | --- | --- |
| Description | one trigger per case | every request (model-picked skills) |
| `SKILL.md` | what every task needs | when the skill is used |
| `references/` | what only some tasks need, behind a pointer that says when to read it | when that case comes |
| The tool's help | exact names, flags, values | when the agent asks for it |
| The tool's results and errors | what to do next, how to fix a wrong call | when the tool is called |

A check on the skill's output (a linter, a test, a renderer) can replace a rule, unless one miss
costs a slow cycle.

## 1. Baseline

- Copy the skill aside as **before**. Record its size per level: description, `SKILL.md`, each
  reference, and what a typical task loads.
- List every consumer: skills that point to it, code that embeds it, tests that assert its text,
  tool descriptions or agent prompts that name it. Confirm pi loads this copy (`npm run check`, and
  the skill listed at start-up).
- Flag any file over pi's read limit (50 KB): its tail never arrives in one read.

## 2. Tools

If the skill teaches a tool (a CLI, an API, a script it ships, a pi tool), do [Tool skills](#tool-skills)
before step 3.

## 3. Place

Write the test tasks first ([testing.md](testing.md)), while **before** is the only version, so the
tasks cannot be shaped around the new one.

Sort every piece onto a level. A reference most tasks read belongs in `SKILL.md`. Scripts,
templates and assets are run or copied, never read. If only the owner ever starts the skill, make
it owner-invoked with a one-line description for the owner.

## 4. Cut and write

Cut:

- what the model already knows: definitions, standard notation, common practice, examples of an
  obvious idea;
- what only a person needs: motivation, history, measurements. It goes in the commit message or
  the harness docs;
- every word a sentence can lose without changing what the agent does.

Write:

- Name each rule with a short phrase the model already understands (a leading word).
- Where a known standard covers many rules, name it and how far to follow it ("about 80 % of the
  way to ASD-STE100").
- Replace a list of cases with the idea that produces them, and a list of bans with one positive
  test. Keep a ban only for safety with no positive form.
- Keep two or three safety lines inline for each risky area (writes, data leaving the machine,
  paid quota), even when the model knows them.
- End `SKILL.md` with its pointers: one line per case, saying where to look.

**Done when** every line changes what the agent does, and no meaning appears twice.

## 5. Verify

- **Behaviour**: before/after runs ([testing.md](testing.md)).
- **Rules and facts**: a fresh `reviewer` agent confirms that each rule in **before** still has a
  home in **after**, or was cut under step 4 for a stated reason, and checks each claim in
  **after** against its source. For anything **after** no longer says that no task covers, the
  reviewer writes a one-line case and runs it three times with **after**. The piece goes back
  unless every run gets it right.
- `npm run check` passes.

Ship when **after** passes every task **before** always passed, is not worse beyond chance, and
uses fewer tokens per run or fixes drift. When a task fails, the logs show what the agent was
missing: move that piece up a level before you add prose back. Report the size per level before
and after, the test table, what moved where and what was cut.

Afterwards, fold anything this diet showed was wrong, missing or slow into this procedure.

## Tool skills

A skill that teaches a tool keeps only what the tool cannot say for itself. `SKILL.md` keeps three
tool parts next to its rules:

- **Cheat sheet**: the most-used operations, one full call each, plus the rules models get wrong
  about them.
- **Hard shapes**: one example of each call shape models get wrong (JSON payloads, quoting,
  repeated `key=value`), with the working alternative.
- **Index**: every other public operation, names only, grouped. The agent can only look up what it
  knows exists.

Extra steps, before step 3:

1. **Inventory.** List the public operations from the tool itself (its `--help`, its schema),
   without internal ones. Find every other copy of its docs: README, bundled skill, help topics.
2. **Drift.** List names the skill uses that the tool rejects, parameters the tool accepts and
   ignores, public operations the skill never mentions, and documented behaviour that is broken.
   Prove each by calling the tool or citing its source line; a matching name says nothing about an
   ignored parameter.
3. **Most-used calls.** Count real calls in past sessions (pi keeps them under
   `~/.pi/agent/sessions/`) and group errors by message: a recurring error names a missing rule or
   an error message to fix. The operations behind about 90 % of calls form the cheat sheet.
   Without logs, take what every task needs, and say so. For a pi tool, also count how often agents
   open the skill before they call the tool; when they rarely do, the tool description should say
   to read the skill first, and what the skill adds.
4. **The tool's help and errors.** The help can replace skill text only when every public
   operation has an entry, one entry covers one decision (about 100 to 300 tokens), an unknown name
   returns the closest valid ones, an unknown parameter is reported, and common failures say how to
   fix them. If the tool is ours, fix each gap in the tool first; otherwise the material stays in
   the skill.

When writing a tool skill:

- Write calls in the syntax the agent types, with allowed values and defaults inline:

  | The agent calls the tool through | Write |
  | --- | --- |
  | a shell (a CLI, or `curl` for an HTTP API) | the usage line: `select <ref> <value>… [--by value\|label\|index]` |
  | code (an SDK) | a signature: `select(ref: string, values: string[], opts?: { by?: "value" \| "label" })` |
  | a pi tool call | the call's JSON shape: `{action: "start", agent, task, role?}` |

  Usage lines use standard notation, plus `<ms>=20000` for a default and `# note` for what the line
  cannot show. Prefer them to tables (about 1.5 times the tokens) and to JSON Schema (about 3
  times).
- Leave out what a schema already says. A rule agents break with only the schema in view goes into
  the tool's results or errors. Put a rule in a tool description only when it must stop a call
  before it happens.
- Point to the tool's help instead of copying a value it can print.

When verifying a tool skill:

- **Coverage**: every name in the skill resolves in the tool, every public operation is named, and
  every flag and value in the cheat sheet exists. Zero misses. For a tool we pin, a test that runs
  the tool's `--version` and checks it against the pinned version catches an upgrade that needs a
  new coverage pass.
- **Test**: add a **none** version with only the tool's own help, give every hard shape a task,
  and count valid first calls and wrong guesses.
