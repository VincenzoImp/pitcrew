# Design it twice

When an interface is hard to shape, design it several radically different ways in parallel and
compare. After John Ousterhout's "design it twice": the first idea is rarely the best.

Uses the vocabulary of the `codebase-design` skill: module, interface, seam, adapter, leverage,
locality.

## 1. Frame the problem

Before you start any agent, write a short explanation of the problem for the owner:

- the constraints any new interface must meet;
- the dependencies it relies on, and their category (see [deepening.md](deepening.md));
- a rough code sketch that makes the constraints concrete. It is not a proposal.

Show it, then go straight to step 2. The owner reads while the agents work.

## 2. Start the designers

Start **three or four agents at once** with the `agent` tool, each with a fresh context. Use the
`worker` role: this is design judgment, not search. For a costly or one-way decision, one of them
can be the `second` role, for a view from another vendor's model.

Each agent gets the same technical brief, written for an agent, not for the owner:

- the files involved and how they are coupled;
- the dependency category of each dependency, and what sits behind the seam;
- the vocabulary of the `codebase-design` skill, and the project's own domain terms, so all designs
  name things the same way;
- what the result must contain (below).

And each gets **one different constraint**:

1. "Minimise the interface: one to three entry points. Maximise leverage per entry point."
2. "Maximise flexibility: support many uses and extension."
3. "Optimise for the most common caller: make the default case trivial."
4. If cross-seam dependencies matter: "Design around ports and adapters."

Each agent returns:

1. the interface: types, methods, parameters, plus invariants, order of calls and error modes;
2. a usage example from a real caller's point of view;
3. what the implementation hides behind the seam;
4. the dependency strategy and the adapters;
5. the trade-offs: where leverage is high, where it is thin.

The agents design; they do not edit the repo.

## 3. Compare and recommend

Present the designs one after another, so each can be read on its own. Then compare them in prose
on:

- **depth**: leverage at the interface;
- **locality**: where future changes concentrate;
- **seam placement**: where the interface lives and what varies across it.

Then give your recommendation: which design is strongest and why. If parts of several designs
combine well, propose the hybrid. Be opinionated; the owner wants a strong read, not a menu.

## Cost

Three or four design agents cost several times one design. Use this for interfaces that many
callers will depend on, or that are hard to change later. For a small internal helper, sketch two
options yourself in a few lines instead.
