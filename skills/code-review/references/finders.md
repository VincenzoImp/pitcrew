# Finder tasks

Copy the task for each finder and fill in the brackets. A normal review uses one finder with the
whole text (all three axes). A risky review uses two: the defects task, and the spec + standards +
lean task. The reviewer sees only the task, so the checklists below go in with it.

## Shared header (every finder)

```
Review a change in the repo at <path>. You did not write it. Assume it has problems.
Read <$R/intent.md> and <$R/diff> fully. Then read the code the diff touches: the callers of every
changed function (grep every caller when a signature, return value or behaviour changes), the
functions it calls, the tests, the README. Trace the real flow: where data comes in, what is
stored, what goes out.
Expected load: <one person running a script | many users and processes | from README: ...>.
Judge scale against it.

Rules for every finding:
- No concrete case, no finding: name the input or situation and the wrong outcome, or, for
  needless code, the code and why nothing needs it. Re-read the lines and confirm before you
  report: the caller exists, the value can be empty, the code is unused.
- Only what this change introduced or touches. A problem that was already there goes under
  "Pre-existing", one line each, only if it matters.
- Provable impact: name the code that is affected; "may break something" is not a finding.
- A `shortcut:` comment that names its limit is a decision, not a finding, unless the expected load
  already crosses that limit.
- Propose the smallest fix that works; prefer fixes that delete code. Never propose new layers,
  frameworks or options the problem does not need.
- Not findings: what a linter, formatter or type checker in this repo enforces; naming taste;
  "consider"; defence in depth with no reachable failure; vague worries.

Format of each finding (short; every part one line or two):
F<n> [blocker|major|minor] <axis>: <title> (<path:line-range>)
- Case: <input or situation → wrong outcome; or the needless code and why>
- Fix: <smallest fix>
- If we skip it: <consequence>
(lean findings add "Lean: -<N> lines")

Severity: blocker = wrong result, crash, data loss, security hole, breaks at the expected load.
major = risky logic without a test, a real slowdown, a spec gap, code that should not exist.
minor = small speed-up, shorter form.

Your report: the status line, one line "What this change does", the findings, "Pre-existing" (if
any), what you covered and what you did not. No findings is a valid result: say what you checked.
```

## Defects axis

```
Axis: defects. Look for:
1. Bug: wrong result, crash, missed edge case (empty, zero, negative, last item, duplicate,
   rounding, time zones, encoding), off-by-one, a caller broken by the change, a fix applied in one
   caller while the shared function stays broken, state left half-updated on an error path.
2. Risk: security holes (injection into SQL, shell, paths, HTML, templates, URLs; missing checks
   on input from users or other systems; secrets in code, logs or errors; weak randomness for
   tokens; an open redirect; a server-side fetch of a user URL without a block on local
   addresses), data loss (errors swallowed, writes in the wrong order, no transaction, a delete
   without a scope).
3. Error handling that hides failures: a new try/catch that returns null, [] or false, logs and
   goes on, or parses "best effort"; a fallback that masks a programming error the caller already
   rules out. Errors checked by message text instead of a code. A catch that exists only to
   satisfy a linter is a bug.
4. Scale, against the expected load: check-then-write races, the same work done by every process,
   memory, caches or lists that only grow, a query or a request per item (N+1), O(n^2) on input
   that can be large, unbounded reads with no limit or pagination, per-process state that must be
   shared, a retry with no ceiling, a lock held across I/O, no back-pressure on a queue.
5. Compatibility: a changed public signature, schema, config key, file format or CLI flag that
   breaks a caller outside the diff; a migration without a way back.
6. Tests: risky new logic (a branch, a parser, money, security, permissions, data writes, a bug
   fix) with no test that fails when it breaks. Read the tests against the conditions the change
   adds: if inverting one of them (drop a negation, swap `<` for `<=`) would leave every test
   green, report the missing case and name that condition, so the parent can confirm it by
   running the mutation. Report it as a test gap, not a bug.
7. Weakened checks: skipped or deleted tests, new lint suppressions, lowered thresholds, assertions
   loosened to pass.
8. Speed: big slowdowns are findings; small wins in a hot loop are minor.
```

## Spec axis

```
Axis: spec. The spec is in <$R/intent.md> (quoted from <source>). Report:
(a) requirements the spec asks for that are missing or partial;
(b) behaviour in the diff that was not asked for (scope creep: options, flags, endpoints,
    "while I was here" changes);
(c) requirements that look implemented but are implemented wrong.
Quote the spec line for each finding. If the spec is silent on something the change decides,
report it as a question for the owner, not as a defect. If there is no spec, report only
"no spec available".
```

## Standards and lean axis

```
Axis: standards and lean code.
Standards sources (read them): <AGENTS.md, CONTRIBUTING, REVIEW_GUIDELINES.md, ... paths>.
Lean-code check output, if any: <output of pitcrew check, or "none">.

(a) Documented standards: every place the diff breaks a rule in those files. Cite the file and
    the rule. These can be hard findings.
(b) Lean: code that should not exist or should be smaller. Every extra line is read, tested and
    fixed later.
    - delete: dead code, unused parameters, options, flags, config, speculative features, no-op
      variables, compatibility shims nothing uses
    - reuse: the repo already has this helper (name the path)
    - standard library or platform: it already does this; a new dependency for a few lines
    - YAGNI: an abstraction with one implementation, a factory with one product, a wrapper that
      only passes calls through, config nobody sets, hooks for needs nobody has
    - one-off helpers that add a name without clarity or reuse (`isRecord`, `asString`)
    - merge: near-copies that must change together
    - split: one function doing several unrelated jobs, so it is hard to read or test. Split by
      job, never by line count, and never into helpers that exist only to shorten a function
    - a refactor that relocates complexity: count the concepts a reader must hold; if the count did
      not drop, it is not simpler
    - a new conditional bolted onto an unrelated flow
(c) Tests in proportion: tests that repeat the implementation (which function was called, in which
    order), tautological expected values (recomputed the way the code does), tests of trivial code
    (getters, wiring, constants, library behaviour), duplicates across levels, mocks of the repo's
    own modules, tests for behaviour nobody asked for. Count lines: new test lines against new code
    lines; more than about two to one needs a reason.
(d) Smell baseline (applies even when the repo documents nothing). The repo overrides: where a
    documented standard endorses something below, do not flag it. Each smell is a judgement call:
    write "possible <smell>", never a hard violation. Skip anything tooling enforces.
    - Mysterious Name: a name that does not reveal what it does or holds → rename; if no honest
      name comes, the design is murky.
    - Duplicated Code: the same logic shape in more than one hunk or file → extract the shared
      shape, call it from both.
    - Feature Envy: a method that reaches into another object's data more than its own → move it
      onto the data it envies.
    - Data Clumps: the same few fields or parameters keep travelling together → bundle them into
      one type.
    - Primitive Obsession: a primitive or string standing in for a domain concept → give the concept
      its own small type.
    - Repeated Switches: the same switch or if-cascade on the same type in several places → one
      map both share, or polymorphism.
    - Shotgun Surgery: one logical change forces scattered edits across many files → gather what
      changes together into one module.
    - Divergent Change: one module edited for several unrelated reasons → split so each changes for
      one reason.
    - Speculative Generality: abstraction, parameters or hooks for needs the spec does not have →
      delete it; inline back until a real need shows.
    - Message Chains: long `a.b().c().d()` navigation the caller should not depend on → hide the
      walk behind one method.
    - Middle Man: a class or function that mostly delegates onward → cut it, call the target.
    - Refused Bequest: a subclass that ignores or overrides most of what it inherits → use
      composition.
Lean and smell findings say how many lines the fix removes ("Lean: -40 lines").
```

## Severity of lean findings

Needless code is `major` when it adds a moving part someone must maintain: an option, a layer, a
dependency, a second implementation, tests for behaviour nobody asked for. It is `minor` when it is
a few lines of local noise. It is never `blocker` alone.
