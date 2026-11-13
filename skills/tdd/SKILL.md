---
name: tdd
description: Test-first work with few, meaningful tests. Agree the seams, build in red-green vertical slices, mock only at system boundaries. Use when building behaviour test-first, writing or judging tests, or deciding what to test or mock.
---

# Test-driven development

TDD is the red → green loop: a failing test, then the least code that makes it pass. This skill
is about making that loop produce **few tests that are worth keeping**: what a good test is, how
many to write, where they go, and the traps. Use every section on every cycle, not after.

## How many tests

Tests are code. Each one must be read, run and fixed later. A suite two or three times the size of
the code it tests is a cost, not a safety net.

- **One test per risky behaviour.** Risky means: a branch or a loop with edge cases, a parser,
  money, security, permissions, data writes, concurrency, time zones, a bug that was fixed.
- **No test for trivial code**: getters, plain wiring, constants, configuration, code that only
  passes values through, behaviour of the framework or a library.
- **No tautological tests.** The expected value must come from an independent source: a literal
  you worked out by hand, a worked example, the spec. Never recompute it the way the code does
  (`expect(add(a, b)).toBe(a + b)`), and never assert that a constant equals itself.
- **No tests that repeat the implementation**: asserting which internal function was called, in
  what order, with which arguments. They break on every refactor and catch no bug.
- **No duplicates across levels.** If an integration test covers a path, do not add unit tests for
  each step of that path.
- **Never write tests for a coverage number.**
- When a new test at a deeper interface covers what old tests covered, **delete the old ones**.

The `leanCode` switch of the session mode checks the test-to-code ratio of a change: it warns in
`standard` and blocks in `strict`. Aim well below its bound, not at it.

## What a good test is

A good test checks **behaviour through a public interface**. The code behind it can change
completely; the test should not. It reads like a line of a spec: "a user can check out with a valid
cart" says what the system can do, and it survives refactors because it does not care how.

- It uses the public interface only.
- It names **what** happens, not **how**.
- It checks one behaviour (one logical assertion, possibly several `expect` lines about one result).
- It tells its whole story in the test body. Repeat a little setup rather than hide it in shared
  helpers the reader must trace.
- It is deterministic: no real time, randomness or network unless the test is about them.

Examples of good and bad tests, and a table of anti-patterns: [references/tests.md](references/tests.md).

## Find the stack first

The loop is the same everywhere; the commands are not. Before the first test, find how this repo
tests:

- the language and build files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
  `pom.xml`, a `Makefile`), and wrapper scripts it checks in;
- the test framework, how it runs **one focused test**, and how it runs the **whole suite**;
- where tests live, how they are named, and what the neighbouring tests look like;
- the commands the README, CONTRIBUTING and CI use.

Use the focused command inside the loop and the full suite before you call the work done. Never
assume a default command such as `npm test`.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you can observe behaviour
without reaching inside. Tests live at seams, never against internals. The `codebase-design` skill
holds the full vocabulary (module, interface, depth, seam, adapter); read it when the shape of the
interface itself is in question.

**Agree the seams before you write a test.** You cannot test everything; agreeing the seams first
puts the testing effort on the critical paths and the complex logic, not on every edge case.

- Prefer seams that already exist. Use the **highest** seam that still runs the behaviour fast and
  deterministically. The fewer seams, the better; one is ideal.
- For each proposed seam, write one line: what a test there catches and what it misses.
- If a plan exists, its seams are already agreed (the `work-planning` skill does this): use them.
- When there is only one sensible seam (a single pure function, one command), state it and go on.
- Otherwise propose them to the owner in one short message and wait. A request to "build it
  test-first" is not agreement on the seams. When no one can answer (a print-mode run, a `worker`
  agent) or the owner said to choose, choose them yourself and state them in the report.

## The loop

Work in **vertical slices**: one test, then the code for it, then the next test. Each test is a
**tracer bullet**: a thin path through the real code that teaches you something for the next one.

1. **Red.** Write one failing test for the next behaviour at an agreed seam.
2. **Watch it fail, for the right reason.** Run the focused command. The failure must be the
   missing behaviour (a wrong value, a missing function), not a typo, an import error or a broken
   fixture. A test that passes on its first run proves nothing: find out why before you go on.
3. **Green.** Write only enough code to make it pass. Do not prepare for the next tests and do not
   add features nobody asked for.
4. **Run it again** and see it pass. Then run the tests near the change.
5. Next slice.

Do not write all the tests first and the code after (horizontal slicing). Tests written in bulk
check behaviour you imagined, not behaviour you learned. They test the shape of things, they miss
real changes, and they fix a test structure before you understand the code.

Do not run the same command twice on unchanged code: it adds no information.

**Restructuring is not part of the loop.** When all slices are green, restructure as a separate
step, with the tests as the safety net, and only if it makes the code simpler. A change in
structure that needs a change in tests is a sign the tests reach past the interface.

## Bugs

For a bug, the first slice is a test that reproduces it. It must fail before the fix and pass
after. For a bug that resists a first look (no clear repro, flaky, slow), use the
`diagnosing-bugs` skill: it builds the feedback loop first.

## Mocks

Mock only at **system boundaries**: external APIs, time, randomness, sometimes the database or the
file system. Do not mock your own modules or anything you control. Prefer the real thing, then a
fake, then a stub; a mock that checks calls is the last choice. Details and how to design code so
boundaries are easy to replace: [references/mocking.md](references/mocking.md).

## Done

- [ ] Every risky behaviour of the change has one test; trivial code has none.
- [ ] Each new test failed first, for the right reason.
- [ ] Expected values are independent of the code.
- [ ] The full suite passes with the repo's own command. No test was skipped, disabled or weakened.
- [ ] Test names say what the behaviour is.
- [ ] The report says which seams you tested, and which risky behaviour, if any, has no test and why.
