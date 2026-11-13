# Accessibility checklist

WCAG 2.1 AA, for any stack. Go through it for every screen you build or change. The
`browser-check` skill shows how to check most items in a real browser (the snapshot is the
accessibility tree).

## Keyboard

- [ ] Every interactive element can be reached with Tab and used with the keyboard.
- [ ] Focus order follows the visual and logical order. Never `tabindex` above 0.
- [ ] Focus is visible on every element. Style the outline; never remove it.
- [ ] Custom widgets support their keys: Enter or Space to activate, Escape to close, arrows in
      menus, lists and tabs.
- [ ] No keyboard trap: the user can always Tab away.
- [ ] A dialog keeps focus inside while open, and returns focus to what opened it when closed.
- [ ] A "skip to content" link at the top, visible at least when focused, on pages with long
      navigation.

## Screen readers

- [ ] Images have `alt` text; decorative images have `alt=""`.
- [ ] Every form input has a label: a `<label>` tied to it, else `aria-label`.
- [ ] Buttons and links say what they do ("Delete order", not "Click here"). Icon-only buttons
      have an `aria-label`.
- [ ] One `h1` per page; heading levels are not skipped.
- [ ] Messages that appear after an action are announced (see live regions below).
- [ ] Data tables have `<th>` headers with `scope`.
- [ ] The page language is declared (`<html lang="en">`) and the page has a descriptive `<title>`.

## Visual

- [ ] Text contrast at least 4.5:1; large text (24 px, or 18.67 px bold) at least 3:1. Do not
      round a failing ratio up to the threshold.
- [ ] Contrast of UI parts (input borders, icons, focus rings) at least 3:1 against their
      background.
- [ ] Colour is never the only carrier of meaning: add text, an icon or a pattern.
- [ ] Text can grow to 200 % without breaking the layout.
- [ ] Nothing flashes more than three times per second. Motion respects the reduced-motion
      preference.

## Forms

- [ ] Every input has a visible label (a placeholder is not a label).
- [ ] Required fields are marked by more than colour.
- [ ] Error messages are specific, sit next to their field and are tied to it
      (`aria-describedby`).
- [ ] An error state shows by more than colour (text, icon, border).
- [ ] After a failed submit, a summary of the errors is shown and receives focus.
- [ ] Known fields use `autocomplete` (`type="email" autocomplete="email"`).

## Content and layout

- [ ] Links stand out from the text around them by more than colour.
- [ ] Touch targets at least 44 by 44 px on touch screens.
- [ ] Empty states say what the area is for and offer the next action.

## Patterns

**Button or link.** A `<button>` performs an action; an `<a href>` goes somewhere. A `div` or
`span` with a click handler is neither: it cannot be focused and has no keyboard support. Use the
native element; a custom `role="button"` needs `tabindex="0"` and both Enter and Space handling,
which the native element gives for free.

**Labels.**

```html
<label for="email">Email address</label>
<input id="email" type="email" autocomplete="email" required />

<button aria-label="Close dialog"><svg aria-hidden="true">…</svg></button>
```

**Landmarks and roles.**

```html
<nav aria-label="Main">…</nav>
<div role="status" aria-live="polite">Order saved</div>
<div role="alert">Title is required</div>
<dialog aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Delete order?</h2>
</dialog>
<div role="status" aria-busy="true" aria-label="Loading orders">…</div>
```

**Live regions.**

| Markup | Announced | For |
| --- | --- | --- |
| `aria-live="polite"`, `role="status"` | at the next pause | saved, updated, results counts |
| `aria-live="assertive"`, `role="alert"` | at once | errors, time-critical alerts |

The live region must exist in the page before its text changes; a region inserted together with
its message is often not read.

## Common mistakes

| Mistake | Problem | Fix |
| --- | --- | --- |
| `div` as a button | no focus, no keyboard | `<button>` |
| Missing `alt` | the image does not exist for a screen reader | descriptive `alt`, or `alt=""` if decorative |
| State by colour only | invisible to colour-blind users | add text or an icon |
| Autoplaying media | disorienting, hard to stop | controls; no autoplay |
| Custom dropdown with no ARIA | unusable by keyboard and screen reader | native `<select>`, or a full listbox pattern |
| Focus outline removed | the user cannot see where they are | style it |
| Empty link or button | announced as "link" or "button" only | text or `aria-label` |
| Positive `tabindex` | breaks the natural order | `0` or `-1` only |

## Tools

- The browser's accessibility tree (the `browser-check` snapshot).
- An automated checker the project uses (axe, pa11y, a lint plugin for the framework). It finds
  part of the problems, never all: the keyboard pass and the look at the screenshot stay.
- A screen reader pass for important flows (VoiceOver on macOS, NVDA on Windows, Orca on Linux)
  when the owner asks for it; an agent cannot listen.
