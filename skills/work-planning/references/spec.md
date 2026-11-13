# Spec format

A spec is the plan for work of several slices or sessions. It is written for an agent that has
not seen the conversation. Use the sections that carry content; drop the empty ones. In a repo that
has its own spec or design-doc format, use that format and carry these contents in it.

```markdown
# <Title>

Status: draft | approved <date> | superseded by <link>
Tracking: <where this plan lives: a local file, or the issue / milestone / Project link>

## Problem
Who has the problem and what fails today, from the user's point of view. Evidence: an issue, a
log, a measurement.

## Outcome
What the user can do when this is done, from the user's point of view.

## Done-check
The command, test or demo flow that proves the outcome.

## Behaviour
The behaviour the work must deliver, numbered, so slices and PRs can cite it.
- B1: <observable behaviour>
- B2: …
User stories ("As a <actor>, I want <feature>, so that <benefit>") are one good form when there
are several kinds of user; list as many as the behaviour needs, no more.

## Decisions
- D1: <decision>. Why: <reason>. Rejected: <option> (<why not>), when the rejection is not obvious.
Modules built or changed, their interfaces, schema changes, API contracts, the shape of key
interactions. No file paths; they go stale.

## Test seams
- <seam>: catches <…>; misses <…>.
Similar tests already in the codebase, to follow.

## Slices
### S1: <title>
Delivers: <the end-to-end behaviour this slice makes work>.
Blocked by: none | S<n>, decision ticket <name>.
Covers: B1, B3.
- [ ] V1: <behaviour>. Check: `<command>`
- [ ] V2: <behaviour>. Evidence: <what to attach>

## Assumptions
- A1: <assumption made instead of asking>. Wrong if: <signal>.

## Deviation policy
What the builder does when the code contradicts this plan (default in the skill).

## Out of scope
Work ruled out of this effort, each with one line of why.

## Not yet specified
In scope but not sharp enough to decide now: the suspected question, and which slice or decision
ticket will settle it.
```

## Rules

- Numbers never change meaning. To drop a behaviour, strike it (`~~B3~~ dropped: D5`); do not
  renumber.
- Slices, issues and PRs cite numbers (B2, V4, D1), not section names.
- A change after approval sets the status back to draft until the owner approves again.
- When the plan moves to GitHub (`tracking` is `github`), the spec becomes the body of the parent
  issue and each slice becomes a sub-issue with its own acceptance lines; the `github` skill does
  the mechanics.
