# Domain language: glossary and decision records

Keep the project's language precise while you design: challenge terms, invent edge-case scenarios,
and write down terms and decisions when they settle.

## Where they live

The repo decides. Look before you write:

- a glossary: `GLOSSARY.md`, `CONTEXT.md`, a "Glossary" or "Terms" section in the docs; several
  of them in a repo with several contexts (often listed in a map file at the root);
- decision records: `docs/adr/`, `docs/decisions/`, `doc/architecture/decisions/`, or the issues
  and PRs where the project records decisions.

If the repo has them, use them in their own format and numbering.

If the repo has neither:

- In a repo the owner controls, offer to start one when the first term or decision settles, and
  create it only after a yes. Create files lazily, only with a first entry.
- In someone else's repo (an open-source contribution), do not add these files. Use the project's
  own channels: the issue, the PR description.
- With the repo's `tracking` set to `local` or `none`, terms and decisions can live in the
  local plan instead (see the `work-planning` skill).

Never treat a glossary as a scratch pad or a spec. It holds terms, nothing else.

## Glossary format

```markdown
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
A customer's request to buy one or more products.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Rules:

- **Be opinionated.** When several words exist for one concept, pick the best and list the others
  under `_Avoid_`.
- **Tight definitions**: one or two sentences. Say what the thing **is**, not what it does.
- **Only project-specific terms.** General programming ideas (timeouts, error types, utility
  patterns) do not belong, even if the project uses them a lot. Before adding a term, ask: is this
  a concept of this domain, or a general programming concept?
- **No implementation details.**
- Group terms under subheadings when clusters appear; a flat list is fine otherwise.
- Update a term **when it settles**, in the moment. Do not batch.

With several contexts, a map file lists each context, where its glossary lives, and how the
contexts relate ("Ordering emits OrderPlaced; Fulfilment consumes it"). Infer which context the
current topic belongs to; ask if unclear.

## When to offer a decision record

All three must be true:

1. **Hard to reverse**: changing your mind later costs something real.
2. **Surprising without context**: a future reader will ask "why did they do it this way?"
3. **A real trade-off**: there were genuine alternatives, and one was chosen for reasons.

If one is missing, skip it. Easy to reverse: you will just reverse it. Not surprising: nobody will
ask. No alternative: there is nothing to record.

What qualifies:

- **Architectural shape**: "The write model is event-sourced; the read model is projected into a
  relational database."
- **Integration between contexts**: "Ordering and Billing talk through events, not synchronous
  calls."
- **Technology with lock-in**: database, message bus, auth provider, deployment target. Not every
  library; only the ones that would take months to replace.
- **Boundaries and scope**: "Customer data belongs to the Customer context; others refer to it by
  id only." The explicit no's are as useful as the yes's.
- **Deliberate deviations from the obvious path**: "Hand-written SQL instead of an ORM because X."
  These stop the next engineer from "fixing" something that was on purpose.
- **Constraints the code does not show**: "No US-hosted services, for compliance." "Responses
  under 200 ms, by contract with a partner."
- **Rejected alternatives**, when the reason is not obvious, or someone will suggest them again.

## Decision record format

```markdown
# {Short title of the decision}

{One to three sentences: the context, what was decided, and why.}
```

That is enough. A record can be one paragraph; its value is that the decision and its reason are
written down. Add only when it helps:

- a status (`proposed`, `accepted`, `deprecated`, `superseded by …`) when decisions get revisited;
- considered options, when the rejected ones are worth remembering;
- consequences, when the downstream effects are not obvious.

Numbering follows the repo; for a new folder, use `0001-slug.md` and count up from the highest
number present.
