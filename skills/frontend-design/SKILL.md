---
name: frontend-design
description: Build or restyle UI that ships, such as pages, components, forms, dashboards and charts, so it is usable, accessible and does not look generated. Use when layout, look or data display matters, even for one component.
---

# Frontend design

Good UI does not come in one shot. Work from a clear brief, steer with positive targets, look at
the real result in a browser, and change it in small steps. The goal is UI that looks as if a
design-aware engineer built it for this product: the product's own design system, every state
handled, usable by keyboard and screen reader.

For throwaway variants that help the owner choose a direction, suggest `/skill:prototype`. To
look at the result in a real browser, use the `browser-check` skill.

## 1. Use what exists

Find the project's design system before you design anything: tokens (colour, spacing, type,
radii, shadows), the theme, the component library, and the pages that already exist. Reuse
components by name and follow how the neighbouring pages are built. A new pattern needs a reason.
**The project's system wins over every default in this skill.**

When the project has no system yet, pick a small one and write it down where the code will use it
(tokens in the stylesheet or theme file): a type scale, a spacing scale, one accent colour,
neutral greys, one radius.

## 2. Brief

Before code, write a short brief. Find what you can in the repo and the request; ask the owner
only for what you cannot find:

- **Who** uses the screen, and **the main task** on it.
- **Register**: *brand* (a landing or marketing page, judged on first impression) or *product*
  (an app screen used every day, judged on speed and clarity).
- **References** the owner likes, and what it **must not** feel like.

When the product needs a new visual direction, collect evidence first: study two or three
relevant screens (references from the owner, or from products in the same domain). Note their
decisions on hierarchy, density, navigation, controls, responsive behaviour and states. Turn the
notes into a short **design contract**: the screen's job, the primary action, the required states,
the responsive rules, and the patterns to reject. Then build the useful structure with the
product's own components, tokens, content and voice. References are evidence, not templates:
never copy another product's branding, text, images or exact layout.

## 3. Direction

- **Steer with positive targets**: a reference, a type scale, a spacing scale, one accent colour,
  a density. Say what it is, not only what it is not.
- **The owner's words have meanings.** "Bolder", "quieter", "denser", "polish", "harden" map to
  concrete operations: [references/vocabulary.md](references/vocabulary.md). Use those meanings,
  and record a new word when the owner uses one.
- **A new look**: name the three most obvious designs for this screen, drop them, and design from
  what is left. Commit to one direction (stark and minimal, editorial, dense and technical, warm
  and soft) and carry it through type, spacing and colour.
- **When the owner must choose between looks**, show two or three **alternatives, not variants**:
  each could be picked or rejected for real reasons, and each looks as if a different designer
  made it (layout, type scale and spacing differ, not only the palette). In a running app, UI
  variants behind a switch are one option (`/skill:prototype` has the method). Without one, write a single static HTML page with the options
  side by side, in a scratch folder outside the repo, and give the owner its path.

### Generated-look filter

These defaults mark UI as generated. Use this table as a last filter on your own result, not as
the design:

| Generated default | Instead |
| --- | --- |
| Purple, indigo or blue-violet everywhere; decorative gradients | the project's palette; one accent used for the main action and state |
| Every corner fully rounded | the radius scale of the design system, with a hierarchy |
| Equal, generous padding everywhere | a spacing scale: more space between groups than inside them |
| A grid of identical centred cards; a generic hero | a layout ordered by what the user needs first |
| Heavy layered shadows, glass effects | flat or subtle depth, only where the system uses it |
| Lorem ipsum or "Item 1, Item 2" | realistic content, with long names, empty values and large numbers |
| Emoji as icons or bullet markers | the project's icon set, or none |
| One sans-serif at three sizes | a type scale with clear steps; for *brand*, headlines several times body size with strong weight contrast |

For *product* screens, system fonts, plain layouts and high density are often correct.

## 4. Build

**Structure.** Follow the project's component patterns. Where there are none: compose small
components rather than configure one large one with many props; one component does one job; keep
data loading apart from presentation, so the presentation can be shown with any data (and in a
prototype or a story). Hold state at the simplest level that works: local to a component, then
lifted to a shared parent, then the URL (filters, pages, anything that should survive a reload or
a shared link), then a cache of server data, then an app-wide store last.

**Layout and type.** Use the spacing scale, never one-off values. One `h1` per page, headings in
order, heading styles only on headings. Line length about 45 to 75 characters for reading text.
Semantic colour tokens (`text-primary`, `surface`, `border`) rather than raw values.

**Every state.** Design each one, not only the happy path:

- loading (a skeleton in the shape of the content, rather than a spinner, for content areas);
- empty (says what this is and offers the first action, never a blank area);
- error (says what went wrong and what to do; keeps what the user typed);
- success and saved;
- long text, many items, missing values, large numbers;
- no permission; slow network; offline when the product supports it.

**Responsive.** Start from the narrow layout and widen. Check at a phone width (320 to 390 px), a
laptop width (1280 to 1440 px), and the width where the layout changes. Touch targets at least
44 by 44 px on touch screens.

**Accessible** (WCAG 2.1 AA): native elements first (`button` for actions, `a` for navigation,
`label` for every input); every interactive element reachable and usable by keyboard, with a
visible focus; text contrast at least 4.5:1 (3:1 for large text and UI parts); no meaning by
colour alone; dynamic messages announced. The full checklist, with patterns and common mistakes:
[references/accessibility.md](references/accessibility.md).

## 5. Data views

Dashboards, charts and tables have their own rules: every number from a query you can show and
recount, unknown is not zero, the chart chosen by the question, the title states the finding:
[references/data.md](references/data.md).

## 6. Look and check

- **Look at it.** Open the page in a real browser at the phone and laptop widths (the
  `browser-check` skill): read the console, take one screenshot per width, look at it against the
  brief and the design contract, and fix what you see. Go through the states that are not the
  happy path. If no browser can run, say "not checked in a browser".
- **Run the project's checks**: lint, types, tests, and an accessibility linter if the project has
  one.
- **Finish pass.** Before you call it done, check the result once more against the
  generated-look filter, the accessibility checklist and the [vocabulary](references/vocabulary.md)
  meaning of "polish": alignment, consistent radii and icon sizes, every state.
- **Evidence.** For a UI change in a PR, include before and after screenshots at both widths.
