---
name: codebase-design
description: Shape modules and interfaces with deep modules, seams, the deletion test and design-it-twice. Use when designing or changing an interface, refactoring, deciding where a seam goes, or surveying code for structural improvements.
---

# Codebase design

Design **deep modules**: much behaviour behind a small interface, placed at a clean seam, tested
through that interface. Callers get leverage, maintainers get locality, and tests get one surface.

This skill has a vocabulary, a few principles, and three ways to use them:

- **Design one change**: the usual case; an interface to add, change or split.
- **Design it twice**: several very different interfaces, compared, when the shape is hard.
- **Survey**: find the places where deepening pays off, when nobody named one.

Domain words (what the product calls things) matter as much as the design words: see
[Domain language](#domain-language).

## Vocabulary

Use these words exactly in plans, reviews, commits and replies. Do not swap in "component",
"service", "API" or "boundary": one meaning per word is the point.

- **Module**: anything with an interface and an implementation. Any scale: a function, a class, a
  package, a slice across tiers.
- **Interface**: everything a caller must know to use the module correctly: the types, and also the
  invariants, the order of calls, the error modes, the configuration it needs, its performance.
  Not only the signature.
- **Implementation**: the code inside the module.
- **Depth**: leverage at the interface: how much behaviour a caller (or a test) can use per unit of
  interface it must learn. **Deep**: much behaviour behind a small interface. **Shallow**: the
  interface is nearly as complex as the implementation.
- **Seam** (Michael Feathers): a place where behaviour can change without editing that place. The
  interface lives at a seam. Where to put the seam is its own decision, apart from what goes behind
  it.
- **Adapter**: a concrete thing that fills a seam. The word names a role (which slot it fills), not
  the size of what is inside: a database repository is a small adapter with a large implementation.
- **Leverage**: what callers get from depth. One implementation pays back across many callers and
  many tests.
- **Locality**: what maintainers get from depth. Changes, bugs, knowledge and checks stay in one
  place. Fix once, fixed everywhere.

```
Deep module                     Shallow module
┌──────────────────┐            ┌──────────────────────────────┐
│ small interface  │            │ large interface              │
├──────────────────┤            ├──────────────────────────────┤
│                  │            │ thin implementation          │
│ much behaviour   │            └──────────────────────────────┘
│                  │
└──────────────────┘
```

## Principles

- **The deletion test.** Imagine deleting the module. If the complexity goes away, it was a
  pass-through. If the complexity comes back in many callers, it earns its place.
- **The interface is the test surface.** Callers and tests cross the same seam. If a test must
  reach past the interface, the module has the wrong shape.
- **One adapter is a hypothetical seam; two adapters make a real one.** Add a seam only when
  something varies across it (production and a test fake count as two). Otherwise it is
  indirection.
- **Depth belongs to the interface, not the implementation.** A deep module can be built from
  small parts inside; they are just not part of its interface. It can have **internal seams** for
  its own tests as well as the **external seam** at its interface. Do not expose an internal seam
  because a test uses it.
- **Accept dependencies; do not create them.** Pass the payment client in; do not construct it
  inside.
- **Return results; avoid hidden side effects.** A function that returns a discount is easier to
  test and reuse than one that changes the cart.
- **A small surface.** Fewer entry points and fewer parameters mean fewer tests and simpler setup.
  When you design an interface, ask: can I remove a method, simplify a parameter, hide more inside?
- **Split by job, never by line count.** One module doing several unrelated jobs is hard to test;
  split it by job. Helpers that only make a function shorter make it shallower.
- **Smallest complete change.** A deeper module is worth it when the code will change again. Do not
  restructure stable code nobody touches, and do not add layers, options or abstractions "for later".

Rejected framings, so they do not come back:

- **Depth as a ratio of implementation lines to interface lines** (Ousterhout's measure): it rewards
  padding the implementation. Depth here is leverage.
- **"Interface" as a language keyword** or a class's public methods: too narrow; the interface is
  every fact a caller must know.
- **"Boundary"**: overloaded with "bounded context" in domain-driven design. Say seam or interface.

## Design one change

1. **Read first.** The module, its callers (`grep` every one), its tests, and what the repo
   records about the area: README, decision records, a glossary if it has one.
2. **Classify the dependencies** of the code you are shaping. The category decides how the result
   is tested across its seam: in-process, local stand-in, owned remote service, or true external
   service. See [references/deepening.md](references/deepening.md).
3. **Write the target**: the interface (types plus invariants, order, errors), what moves behind it,
   which tests move to the new interface and which old tests are deleted, and how callers migrate.
4. **Hard interface?** Design it twice before you choose: [references/design-it-twice.md](references/design-it-twice.md).
5. **Big change?** When one mechanical change fans out over the codebase (a rename, a retyped shared
   symbol), sequence it as **expand → migrate in batches → contract**: add the new form beside the
   old, move callers over in batches that each keep the build green, then delete the old form when
   no caller is left.
6. **Each step ends with a passing check**: the existing tests, plus tests at the new interface (the
   `tdd` skill says how many).

When the owner is present and the change is not small, show the target (step 3) before you build.

## Design it twice

Your first idea for an interface is rarely the best. When the shape is hard or contested, start
three or four agents with the `agent` tool, each with a fresh context and a different constraint
(smallest interface; most flexible; easiest common case; ports and adapters), then compare the
designs on depth, locality and seam placement, and recommend one. The briefs, the output format
and the comparison: [references/design-it-twice.md](references/design-it-twice.md).

## Survey for deepening

When the owner asks where the structure hurts, or a bug had no correct seam for a test, look for
**deepening opportunities**: places where shallow modules can become one deep module. Scope it to
where change happens (recent history), explore with `scout` agents, apply the deletion test, and
report candidates with a strength rating. **Do not propose interfaces in the survey**; ask which
candidate to explore, then design that one. Method and report format:
[references/survey.md](references/survey.md).

## Domain language

Good seams get their names from the domain. Use the project's own words for the things the
product deals with (Order, Invoice, Customer), and the vocabulary above for the structure.

- **Challenge a term that conflicts** with the words the project already uses: "The glossary says
  'cancellation' means X, but you seem to mean Y. Which is it?"
- **Sharpen fuzzy words**: "By 'account', do you mean the Customer or the User? They are different."
- **Test the terms with concrete scenarios**, especially edge cases that force a precise line
  between two concepts.
- **Check the code**: when the owner says how something works and the code disagrees, show both
  and ask which is right.

Where a term or a decision is written down follows the repo, not this skill. Formats for a glossary
and for decision records, when to offer a decision record, and what to do in a repo that has
neither: [references/domain-language.md](references/domain-language.md).
