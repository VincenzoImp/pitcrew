# Decision map

For a large effort wrapped in fog: the idea is loose, more than one session can hold, and the route
from here to the goal is not visible yet. The work here is to **find the route**, not to charge at
the goal. You chart a **map** of **decision tickets** (questions whose answer is a decision, not
slices of a build) and resolve them one at a time until the way is clear. Then the map collapses
into a spec ([spec.md](spec.md)) and the build starts.

Do not use a map for a well-scoped feature. It is slower and denser than a spec on purpose.

## Plan, do not build

Each ticket resolves a decision. The map is done when nothing is left to decide before someone
builds. The urge to start building is usually the sign that you have reached the edge of the map
and should hand over to the spec. The owner can choose otherwise for one effort and write it in the
map's notes.

## The map

The map has one home, set by the `tracking` dial:

- `none` or `local`: one Markdown file in the plans folder (see the skill), with each ticket as a
  section of the same file or one file per ticket next to it.
- `github`: a parent issue, with each ticket a sub-issue, and blocking as GitHub dependencies. The
  `github` skill holds the mechanics.

The map is an **index, not a store**. It lists the decisions made and points at the tickets that
hold the detail. A decision lives in exactly one place, its ticket.

```markdown
## Destination
What reaching the end of this map looks like: the spec, decision or change this effort is finding
its way to. One or two lines. Every session reads it before choosing a ticket.

## Notes
The domain; skills every session should use; the owner's standing preferences for this effort.

## Decisions so far
- <ticket title, linked>: <one-line gist of the answer>

## Not yet specified
The fog: questions you can tell are coming but cannot state sharply yet.

## Out of scope
Work ruled beyond the destination, each with one line of why.
```

Open tickets are not listed in the map. They are found by status: open, not blocked, not claimed.

**Refer by name.** In everything the owner reads, name a ticket by its title, with the link or
number inside the name. A wall of `#42, #43, #44` cannot be read at a glance.

## Tickets

A ticket holds one question, sized to one session:

```markdown
## Question
<the decision or investigation this ticket resolves>
```

The answer is not part of the question. It is recorded when the ticket is resolved.

Each ticket has a **type**, and is either worked **with the owner** or **alone**:

- **Research** (alone): read docs, third-party APIs or other sources to find a fact a decision
  waits on. Done by `scout` agents (the `agent` tool), several at once if there are several.
- **Prototype** (with the owner): make something cheap and rough to react to (a stub, a sketch, a
  small piece of UI or logic) when "how should it look" or "how should it behave" is the question.
  Link the prototype from the ticket; keep it out of the main branch.
- **Grilling** (with the owner): a conversation, the default type. Use the questioning of the
  skill (section 2).
- **Task** (alone where you can, else with the owner): work that must happen before a decision can
  be made: sign up for a service to judge its API, get access, move data to see its shape. The one
  type that does rather than decides. Its answer records what was done and the facts later tickets
  need (where the credential is kept, never the credential; new URLs; row counts).

A ticket worked with the owner is resolved only through that exchange. Never answer the owner's
side yourself.

**Blocking**: a ticket lists the tickets that must close before it. The **frontier** is every open
ticket whose blockers are all closed and that nobody has claimed. **Claim** a ticket before any work
on it (assign it, or mark it in the file), so a parallel session skips it.

## Fog of war

The map is incomplete on purpose. Do not chart what you cannot see yet.

**Fog or ticket?** The test is whether you can state the question precisely now, not whether you
can answer it now.

- A ticket, when the question is already sharp, even if it is blocked.
- "Not yet specified", when you cannot phrase it sharply yet. Do not cut the fog into ticket-sized
  pieces in advance: one patch may become several tickets, or none.

Resolving a ticket clears the fog ahead of it. Turn what is now specifiable into new tickets, one
question each, and remove it from "Not yet specified".

**Out of scope is not fog.** The destination fixes the scope. Work beyond it goes in "Out of scope"
and never comes back unless the destination is redrawn. When an existing ticket turns out to lie
beyond the destination, close it and add one line to "Out of scope". It does not go in "Decisions
so far", which records the route actually walked.

## Two ways to work

**Never resolve more than one ticket per session**, except research tickets. One decision per
session keeps each decision made with full attention and a clean context.

### Chart the map

1. **Name the destination** with the owner (grilling). It fixes the scope, so it comes first.
2. **Map the frontier**: grill again, breadth first. Fan out across the whole space rather than deep
   on one thread; find the open decisions and the first steps that can be taken now. If this finds
   no fog (the way is clear, the effort fits one session), you do not need a map: say so and write
   a spec instead.
3. **Write the map**: destination and notes filled in, no decisions yet, the fog sketched in "Not
   yet specified".
4. **Create the tickets** you can state now. Then add the blocking edges in a second pass (tickets
   need their ids or names before they can point at each other).
5. **Start the research**: one `scout` agent per research ticket, in parallel, each writing its
   findings to a file outside the repo and linking it from the ticket.
6. Stop. Charting is one session's work.

### Work the map

1. Load the map: the index, not every ticket.
2. Take the ticket the owner named, or the first one on the frontier. Claim it.
3. Resolve it as its type says. Read related or closed tickets in full when you need them.
4. Record the answer in the ticket, close it, and add one line to "Decisions so far".
5. Add the new tickets the answer makes possible; graduate fog that is now sharp; rule out what now
   lies beyond the destination. If the answer invalidates other tickets, update or close them.

The owner may work unblocked tickets in parallel sessions; expect the map to change under you.

## When the way is clear

When the frontier is empty and no fog is left, the map hands over: write the spec from the map's
decisions (link each decision, do not copy its detail), then slice it. Going from the map straight
to building skips that step and throws the linked detail away; do it only when the effort turned out
small.
