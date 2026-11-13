# PR body

Use the repo's PR template when it has one. Otherwise this shape. Short sentences, no preamble, the
project's own words. Leave out a section that would be empty, except Limits.

```markdown
<The smallest picture of the change: a call tree, a file tree, pseudocode or a diff sketch.
One or two lines of text next to it.>

## Evidence
- Before: <failing test, wrong output, screenshot>
- After: <the same test passing, the right output, screenshot>
- `npm run check` → pass (tests 162, fail 0)

## Merge danger
Door: two-way. <Why it is cheap to roll back, or what cannot be undone.>
Blast radius: <who or what can break: callers, users, data, other repos>.

## Limits
<What is not done or not checked. "None known" if none.>

Closes #42
```

## The picture

Pick the one view that makes the change clear, and only the parts that matter:

- logic: pseudocode of the new rule;
- runtime flow: a call tree, with `+` and `-` lines for what changed;
- layout or a refactor: a shallow file tree, one comment per folder;
- interaction between parts: a short sequence diagram;
- a small change in a known shape: a diff sketch of that shape.

Show a whole block only when most of it is new or the reader needs it to copy.

## Evidence, strongest first

1. What the user sees: a screenshot or a recording, before and after, for a visible change
   (`gh pr create --attach after.png#"After"`).
2. Execution: the test that failed before and passes now (name it, or show it as pseudocode), the
   command output, the check run.
3. Reasoning only: say so, and say why nothing could run.

## Merge danger

- **Door**: two-way (a revert undoes it) or one-way (a migration, deleted data, a published
  release, an API others already call, a message sent).
- **Blast radius**: one word or line for the scope: a function, a module, every user, other repos,
  stored data.
