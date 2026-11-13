# Survey for deepening opportunities

Find where the structure causes friction and where turning shallow modules into deep ones pays off.
The aim: code that is easy to change and test, and easy for an agent to find its way in.

## 1. Scope before you scan

Deepening pays off by making future changes easier. Look where change happens, not everywhere.

- If the owner named an area, a module or a pain point, take it and skip the rest of this step.
- Otherwise read the history for hot spots, for example:
  `git log --since=6.months --name-only --format= | sort | uniq -c | sort -rn | head -30`.
  Let the files and areas that keep changing pull your attention first. If changes are scattered
  with no clear hot spot, widen the net.
- Read what the repo records about the area: README, decision records, a glossary. A decision
  record that rejected a design is not reopened lightly (see step 3).

## 2. Explore

Start `scout` agents (the `agent` tool) to walk the scoped area in parallel, one area each. Ask
them to report friction, with file paths, not to follow a fixed checklist:

- Where does understanding one concept mean jumping between many small modules?
- Where is a module **shallow**, its interface nearly as complex as its implementation?
- Where were pure functions pulled out only to be tested, while the real bugs hide in how they are
  called (no **locality**)?
- Where do tightly coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?
- Where did a recent bug fix find no correct seam for a regression test?

Apply the **deletion test** to every suspect yourself: would deleting it concentrate complexity, or
only move it? "Concentrates" is the signal you want.

## 3. Report the candidates

Three to six candidates, strongest first. For each:

- **Title**: names the deepening ("Collapse the order intake pipeline").
- **Files**: the modules involved.
- **Problem**: one sentence: what hurts.
- **Change**: one sentence in plain words: what would change.
- **Gains**: in the vocabulary: locality, leverage, how tests improve ("tests hit one interface",
  "delete four shallow wrappers"). Not "cleaner code" or "easier to maintain".
- **Dependency category**: in-process, local stand-in, ports and adapters, or external
  (see [deepening.md](deepening.md)).
- **Strength**: `strong`, `worth exploring` or `speculative`.
- **Decision record conflict**, if any: one line, and only when the friction is real enough to
  reopen it ("contradicts the decision on X, but worth reopening because …"). Do not list every
  refactor a decision record forbids.

End with the **top recommendation**: which candidate to take first, and why, in one or two lines.

Use the project's domain words for the things ("the Order intake module", not "the FooHandler")
and the `codebase-design` vocabulary for the structure.

**Do not propose interfaces yet.** Ask the owner which candidate to explore. Then design it with
the "Design one change" steps of the skill, and design it twice if the shape is hard.

## Format

The report goes in the reply as Markdown by default.

When there are many candidates, or the owner asks for a visual, write one self-contained HTML page
in the OS temp folder (`${TMPDIR:-/tmp}/architecture-review-<timestamp>.html`), never in the repo,
and give the owner its absolute path. Each candidate is one card with the fields above and a
**before / after diagram** side by side, which carries most of the weight:

- a graph (for example Mermaid) for call flow or dependencies, with leaking edges in red;
- stacked bands for layers a call passes through: six thin layers before, one thick band after;
- a mass diagram: interface height against implementation height, shallow before, deep after;
- a collapsed call tree: the tree before, one box with the faded internal calls after.

Keep prose short; if a diagram needs a paragraph, redraw it. Use one accent colour, red for
leakage, amber for warnings. The page loads at most a styling library and a diagram library and
has no other scripts.

## After the owner picks

- If the owner rejects a candidate for a lasting reason, offer to record it where the project
  keeps decisions, so the next survey does not suggest it again. Skip passing reasons ("not now").
- New domain terms that come up while designing follow
  [domain-language.md](domain-language.md).
