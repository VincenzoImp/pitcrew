# Document standards

Paste the standard that fits the plan into each reviewer's task. Each one states when a document
passes. The readiness standard matches the `work-planning` skill.

Modified in 2026 from google/elephant-goldfish-model `resources/document_standards/` (Apache-2.0); see THIRD_PARTY_NOTICES.md.

| Plan kind | Standard | For |
| --- | --- | --- |
| Short plan, spec with slices | readiness | `readiness`, `codebase` |
| Spec, design, proposal | feature spec | `design-critic` |
| Every plan | zoom-out | `zoom-out` |
| A proposal that asks for time or money | proposal | `design-critic` |
| Documentation of existing code | re-implementation | `codebase`, `comprehension` |

## Readiness

A plan passes if a competent engineer, or a fresh agent, who does not know the codebase can build
it right the first time without guessing, asking, or making a design decision.

- **No open decisions.** Every design or architecture choice is made in the plan: data shapes,
  interfaces the user or other code sees, the dependency to use, the behaviour of each edge case
  that matters. A choice left to the builder fails the standard.
- **Slices.** The work is split into vertical slices; each leaves the code building and its checks
  green; blocking edges are stated.
- **Checks.** Each slice has acceptance checks a person or agent can run, and the plan has one
  done-check.
- **Scope.** What is out of scope is stated. The modules or areas that change are named; exact
  file paths only where they will not go stale (the `work-planning` skill leaves them out so the
  plan survives refactors).
- **Deviation policy.** What the builder does when the code contradicts the plan.

## Feature spec

A spec passes if a competent engineer, or a fresh agent, who does not know the codebase can
understand the feature, why it is needed and the design trade-offs, and can confirm that the major
risks and alternatives were considered.

- **Alternatives.** It names other viable designs and why each was rejected, with a concrete
  technical or scope reason. A single path with no alternatives fails. A rejection is not
  attributed to a person without a link to where they said it.
- **Risks and limits.** Failure modes, security, scaling limits, and how each is handled.
- **Covered where they apply**: the problem, goals and non-goals, the proposed architecture (parts,
  data flow, how it fits the system), alternatives considered, risks and mitigations.

## Zoom-out

A design passes if it solves the root problem in the simplest way, uses what exists, avoids
speculative features and premature optimisation, and keeps the right level of detail.

0. **Context.** The document says what it wants to achieve and why. If not, the review stops here
   with a request for context.
1. **Root problem.** It solves the cause, not a symptom, and fits the project's stated goals.
2. **Simplicity.** No abstraction, path or feature for a speculative need. No caching, sharding or
   queues before a measured bottleneck. Data passes through as few parts as possible. No design
   that blocks the obvious next step, and no speculative interface built now to avoid one.
3. **Altitude.** High-level sections describe architecture, interfaces and data flow, not helper
   functions. A structural fix in the right component beats a complex local workaround. New logic
   sits in the layer where it belongs.
4. **Use what exists.** Reuse code in the repo (stable, maintained, not crossing a dependency
   boundary), follow its patterns, use the platform and standard library before custom code.
   Known anti-patterns (bypassing authentication, hard-coded deployment config) are flagged.

## Proposal

A proposal passes if a reader new to the project can answer, from the text alone:

- What is being attempted, with no jargon?
- How is it done today, and what are the limits of that?
- What is new in the approach, and why will it work?
- Who cares, and what changes if it succeeds?
- What are the risks and the payoffs?
- What does it cost (time, compute, money)?
- How long will it take?
- What are the mid-term and final checks of success?

## Re-implementation

Documentation of existing code passes if a competent engineer, or a fresh agent, can write code
that behaves the same using only the document, without guessing defaults, error handling, patterns
or output shapes.

- **Include**: external contracts (APIs, formats, side effects), behaviour (logic, state, errors),
  performance limits.
- **Exclude**: syntax, private helpers, internal structures nobody can observe.
- **Covered where they apply**: interfaces and types; control flow and validation; data shapes,
  serialisation and state changes; side effects (writes, network, logs, metrics); dependencies;
  configuration; hard limits and assumptions; edge cases, empty states, retries; test helpers.
