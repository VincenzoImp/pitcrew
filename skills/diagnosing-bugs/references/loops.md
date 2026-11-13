# Feedback loop recipes

Recipes for the harder loops in phase 1 of the `diagnosing-bugs` skill. Use the repo's own
commands (its test runner, its scripts); the commands below only show the shape.

## Bisection between two known states

Use it when the bug appeared between a good state and a bad state: two commits, two dependency
versions, two datasets.

1. Write one script that sets up the state and exits 0 when good, 1 when bad, and 125 when this
   state cannot be tested (it does not build). Keep it outside the tracked tree (for example in the
   OS temp folder), so the checkouts that `git bisect` makes do not change it.
2. Check the script on both ends first: it must exit 0 on the good commit and 1 on the bad one.
3. Run it:

   ```bash
   git bisect start <bad> <good>
   git bisect run /tmp/check-bug.sh
   git bisect reset
   ```

4. Read the first bad commit. It narrows the hypotheses; it is not yet the cause.

For dependency versions or datasets, the same idea works by hand: halve the range, test the middle,
repeat. Write down each step and its verdict.

Do not bisect in a worktree where other work is in progress. Use a separate worktree.

## Differential loop

Use it when an old version (or another configuration) is known to be right.

- Run the same input through both and diff the outputs: `diff <(old input) <(new input)`.
- Keep the input fixed and small. Shrink it as in phase 2 while the diff stays non-empty.
- If the outputs contain times, ids or ordering that change every run, normalise them first
  (sort, replace with placeholders), or the diff is noise.

## Flaky and environment-dependent bugs

When the bug does not show on demand, find which kind it is:

- **Timing**: add timestamps around the suspect area; add sleeps to widen a race window; run under
  load or with many parallel workers.
- **Environment**: compare runtime versions, OS, environment variables, locale, time zone; try a
  clean environment (a fresh container or CI).
- **State**: look for state left over between tests or requests: globals, singletons, caches,
  files, database rows. Run the failing case alone, then after the other cases, and compare.
- **Order**: run the tests in a fixed random order with a seed; when one order fails, keep the seed.
- **Truly rare**: add tagged logging where it happens, describe the observed conditions, and say
  that the loop has a low rate. Do not claim a fix you cannot show.

Then loop the trigger many times and count: "fails 47 of 100 runs" is a usable loop. After the fix,
the same count must be 0 of a number large enough to matter.

## Performance regressions

- Measure before you change anything: a timing harness that runs the slow path several times and
  reports the median, a profiler, or the query plan.
- Fix the input size and the machine. Note both with the numbers.
- Bisect on the measurement (a threshold in the check script), not on a feeling.
- After the fix, report the same measurement before and after.

## Human in the loop

Use it only when a step needs a person: a click in a real browser, a sign-in, a physical device.

pi's `bash` tool has no terminal for questions, so the script cannot ask through the agent. Do this:

1. Copy [../scripts/hitl-loop.template.sh](../scripts/hitl-loop.template.sh) to a path outside the
   repo (the OS temp folder), and edit the steps between the markers.
2. Tell the owner the path and ask them to run it in their own terminal:
   `bash /tmp/hitl-<name>.sh`.
3. They paste back the block printed after `--- Captured ---`. Parse its `KEY=VALUE` lines.
4. Keep each run identical, so the answers compare across runs.

The script prints what it captures. So capture observations only. Put sign-in and anything secret
as a `step` the person does, never as a `capture`.
