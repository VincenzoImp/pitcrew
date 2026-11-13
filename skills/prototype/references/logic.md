# Logic demo

One self-contained HTML file that lets anyone drive a state model by clicking buttons. Use it when
the question is about **business logic, state transitions or data shape**: things that look right
on paper and feel wrong only when you push them through real cases.

Because it is one file with nothing to install, the owner can hand it to someone who does not
write code (a designer, a domain expert) and let them feel the model. So it speaks their language,
not the code's.

Right shape for:

- "I am not sure the state machine handles X followed by Y."
- "Can this data model represent the case where…?"
- "I want to feel out the API before I write it."
- Anything where someone wants to press buttons and watch the state change.

If the question is "what should this look like?", use [ui.md](ui.md) instead.

## 1. State the question

Before code, write which state model and which question the demo explores: one paragraph, in a
visible intro at the top of the page (not only in a comment).

## 2. Put the logic in a portable module

The part that answers the question goes in one `<script>` block, written as a small **pure
module** that could be lifted into the real codebase later. The page around it is throwaway; the
module is not.

Pick the form that fits the question, not the one that is easiest to wire to a page:

- **A pure reducer**, `(state, action) => state`: actions are discrete events and the state is one
  value.
- **A state machine** with explicit states and transitions: "which actions are legal now?" is part
  of the question.
- **A few pure functions** over a plain data type: there is no current state, only
  transformations.
- **A class or module with a clear method surface**: the logic really owns ongoing internal state.

Keep it pure: no DOM, no `document`, no button handlers inside it. The page calls the module;
nothing flows the other way. That is what makes the module worth keeping after the question is
answered.

## 3. Build the page

One file, plain HTML, CSS and JavaScript, everything inline: no framework, no bundler, no server.
It opens with a double-click and still works when sent by mail.

Every label is in **domain words**: buttons and fields read like the business, not like the
reducer. Explain in plain words what happens. From top to bottom:

1. **Title and one line** on what the demo lets you explore (the question).
2. **Current state**: the full relevant state as a readable panel of labelled fields (not a raw
   JSON dump), shown again after every click. Mark what just changed when that helps a reader
   follow.
3. **Free-play buttons**: one per action, always there, so anyone can try the model in any order.
4. **Guided scenarios**, one tab each. A tab holds a short description (the situation and what to
   watch for) and below it the ordered buttons to press. Each step is a real button that performs
   the action and moves to the next step. Starting a scenario resets to a known state, so it runs
   the same way every time.

Pick scenarios that show the awkward cases: the happy path, a hard edge case, and an attempt at
something that must be refused.

Clean type, generous spacing, one accent colour. No animation and nothing that competes with the
state and the buttons.

## 4. Hand it over

Send the file, or open it for the owner. They will click through when they have time. Listen for
"that should not be possible" and "I expected X": those are bugs in the idea. Add actions or
scenarios when asked.

## 5. Capture

Capture the answer and the prototype as the skill says. For a logic demo: the validated reducer,
machine or functions move into the real module (rewritten with tests), and the HTML file stays on
the throwaway branch, where it is still one file that opens with a double-click.

## Traps

- **Tests.** A prototype that needs tests is no longer a prototype.
- **The real database.** In-memory state, unless persistence is the question.
- **Generalising.** No "what if we later need X". One question.
- **Logic mixed into the page.** A module that touches the DOM or button handlers cannot be lifted
  out. Keep the page a thin shell over a pure module.
- **A framework, a bundler or a server.** They break "one file anyone can open".
- **Shipping the page.** It is built to be clicked through by hand. The module behind it is what
  is worth keeping.
