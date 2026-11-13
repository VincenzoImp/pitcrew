---
name: prototype
description: Build throwaway code that answers one question fast, such as a clickable logic demo, UI variants of one page, a spike, or a demo or hackathon build.
disable-model-invocation: true
---

# Prototype

A prototype is **throwaway code that answers a question**. The answer is the result; the code is
not. Speed matters more than polish, and the question decides the shape.

## State the question

Write the question in one line before any code ("Can one trip be split across two invoices?",
"Which of three layouts makes the queue easiest to scan?", "Can the parser handle 50 MB in under a
second?"). Say who will judge the answer. Put the question where the person who runs the
prototype sees it first: the intro of the page, the top of the script, the demo notes. A prototype
that answers the wrong question is pure waste, and a written question can be checked later, by the
owner now or by anyone who comes back to it.

## Pick the shape

| Question | Shape |
| --- | --- |
| Does this logic, state model or data shape feel right? | A **logic demo**: one HTML file a person drives with buttons. [references/logic.md](references/logic.md) |
| What should this look like? | **UI variants**: several very different versions of one screen, switched in the browser. [references/ui.md](references/ui.md) |
| Is this possible, or fast enough? | A **spike**: the smallest script that tries it and measures it |
| Can we show it working? | A **demo or hackathon build**: one thin path, end to end. See [Demos and hackathons](#demos-and-hackathons) |

The shapes produce very different things, so a wrong pick wastes the whole prototype. Take the
shape from the request and the code around it. If it is still ambiguous, ask when the owner is
there; when no one can answer, take the shape the surrounding code suggests (a backend module →
logic demo; a page or component → UI variants) and state that assumption next to the question.

## Rules for every shape

- **Throwaway from the start, and marked as one.** Put the prototype next to the code it is for,
  so its context is clear, and name it so a reader sees it is a prototype (`prototype` in the file
  or route name). Follow the project's conventions for routes and folders; do not invent a new
  top-level structure. Work on a throwaway branch, never on the main branch. A prototype that
  belongs to no repo goes in a scratch folder the owner can find, and you give them its path.
- **Trivial to run.** One command from the project's task runner, or one file that opens with a
  double-click. Write that command next to the question.
- **No persistence by default.** State lives in memory. Persistence is something a prototype
  checks, not something it depends on. When the question is about storage, use a scratch database
  or a local file with a clear "prototype, wipe me" name.
- **Skip the polish.** No tests, no error handling beyond what makes it run, no abstractions, no
  options for later. A prototype that needs tests is no longer a prototype.
- **Show the state.** After every action (logic) or on every variant switch (UI), show the full
  relevant state, so the person sees what changed.
- **The repo's checks still pass.** Prototype code sits outside the project's quality bar, but it
  must not break the build, the type check or the verify gate for the rest of the repo. Keep it
  out of what they scan, or make it pass them.

## Spikes

A spike answers "is it possible?" or "is it fast enough?". Write the smallest script that tries
the hard part against real inputs (a real file, the real library version, a realistic data size).
State the threshold before you run it ("under one second for 50 MB"). Report numbers with how
they were measured: input size, machine, runs. One run is an anecdote; run it a few times. A spike
that cannot reach the threshold is a good answer too: report what limits it.

## Demos and hackathons

The session mode for this is the `fast` rigor: the verify gate stays on, review and lean-code
checks are off. A demo repo often also sets `tracking` to `none` and `stop` to `local`. The owner
sets the mode; follow it.

- **Write the demo script first**: the three to five steps the audience will see, in order. Build
  only what those steps need.
- **One path that works end to end** beats several half paths. Make the first version run end to
  end early, however thin, then thicken it.
- **Fake what the demo does not show**, and list every fake (hard-coded data, a stubbed payment, a
  canned model answer). The list is part of the deliverable: nobody should mistake a fake for a
  feature.
- **Commit often**, so a broken change is one step to undo.
- **Rehearse from a cold start**: a fresh checkout, the start command, the whole script. Check the
  UI steps in a real browser (the `browser-check` skill). Fix what breaks in the rehearsal before
  anything new.
- **Have a fallback**: screenshots or a short recording of the working run, for when the network
  or a service fails on stage.
- **Keep demo notes** where the team looks (in a demo repo, the README is the product's own doc):
  how to start it, the script, the fakes, the known failures.

A hackathon build is still a prototype: its code is not promoted as it is. If the idea goes on, it
is rebuilt inside the real design.

## Hand it over

Give the owner the command, the file or the URL, and the question. The useful moments are "that
should not be possible" and "I expected X": those are bugs in the idea, which is the point. When
the owner asks for another action, scenario or variant, add it. Prototypes change.

## Capture the answer

When the prototype has answered its question:

1. **Write the answer down** where the project keeps decisions (the issue, the plan, the PR):
   the question, the verdict and why. When a decision ticket or a planning question was waiting on
   this prototype, answer it there.
2. **Fold the validated decision into the real code**, rewritten under the project's quality bar
   (with tests, see the `tdd` skill). Never promote prototype code as it is: it was written without
   tests and error handling.
3. **Keep the prototype as a primary source**: commit it on its throwaway branch, out of the main
   branch, and put a pointer to that branch next to the answer. The main branch keeps only the
   decision.

Committing and pushing follow the session mode's `stop` dial. If the owner reacted to the
prototype with taste rather than rules ("B's header, C's list"), turn each reaction into an
explicit criterion; when it cannot be tested, it goes into a short rubric that becomes the
acceptance check.

If the way you built this prototype worked well and will repeat, tell the owner it could become a
skill (`/skill:writing-for-agents`).
