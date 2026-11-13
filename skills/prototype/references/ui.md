# UI variants

Several **very different** versions of one screen on one route, switched from a small floating
bar. The owner flips between them in the browser, picks one or takes parts from several, and the
rest are thrown away.

If the question is about logic or state rather than looks, use [logic.md](logic.md) instead.

Right shape for:

- "What should this page look like?"
- "Show me a few options for this dashboard before we commit."
- "Try a different layout for the settings screen."
- Any time the owner would otherwise choose between three vague mockups in their head.

## Where the variants live: prefer an existing page

A UI is much easier to judge against the rest of the app: the real header, sidebar, data and
density. On an empty route every variant looks fine.

- **On an existing page (the default).** The route exists. The variants render on that route,
  chosen by a `?variant=` URL parameter. Data loading, parameters and auth stay as they are; only
  the rendered part changes. A feature that has no page yet but would live inside one (a new
  section of a dashboard, a new card on the settings screen, a new step in a flow) is still this
  case: mount the variants inside the host page.
- **On a new page (last resort).** Only when the thing has no page it could live in (a new
  top-level surface, a flow that fits nowhere). Make a throwaway route that follows the project's
  routing convention, with `prototype` in its path or file name, and the same `?variant=` switch.
  Check first: is there really no page to embed it in?

The switcher bar is the same in both cases.

## 1. Question and count

Default to **three** variants; at most five. Past five they stop being very different and turn
into noise. Write the plan in one line at the top of the switcher file: "Three variants of the
settings page, switched by `?variant=`, on the existing settings route."

## 2. Make them really different

Each variant keeps the page's purpose, the data it has, and the project's component library and
styling system (whatever it uses), and exports a clear name (`VariantA`, `VariantB`, `VariantC`).

Variants differ in **structure**: layout, information order, the main action. Not colour or copy.
Three slightly changed card grids is wallpaper, not a prototype.

Ways to get real spread:

- Name the three most obvious designs for this screen, drop them, and design from what is left.
- Give each variant a direction a different designer would take (dense and tabular; one focused
  task at a time; visual and spatial), not a variation of one direction.
- Draft each variant in its own `worker` agent (the `agent` tool) with its own brief, so no draft
  copies another. Or draft more than you need and have a fresh agent pick the most different
  three.
- If two drafts come out alike, redo one with an explicit constraint ("no card grid", "no
  sidebar").

## 3. Wire them

One switcher on the route reads the parameter and renders one variant. Adapt to the framework:

```tsx
// sketch: adapt to the project's framework
const variant = searchParams.get("variant") ?? "A";
return (
  <>
    {variant === "A" && <VariantA {...data} />}
    {variant === "B" && <VariantB {...data} />}
    {variant === "C" && <VariantC {...data} />}
    <PrototypeSwitcher variants={["A", "B", "C"]} current={variant} />
  </>
);
```

On an existing page, all data loading stays above the switcher; only the rendered subtree changes.

## 4. The floating switcher

A small fixed bar at the bottom centre:

- **Left arrow**: the previous variant (wraps around).
- **Label**: the current key and, when the variant has one, its name: `B (sidebar layout)`.
- **Right arrow**: the next variant (wraps around).

Behaviour:

- An arrow updates the URL parameter through the framework's router, so a variant can be shared
  and survives a reload.
- The `←` and `→` keys also switch, except when an `<input>`, `<textarea>` or `[contenteditable]`
  has focus.
- It is visibly not part of the design under review (a high-contrast pill, a light shadow).
- It is hidden in production builds (gate it on the framework's production flag), so a stray
  merge cannot ship it.

Put it in one shared component where the project keeps shared UI.

## 5. Check before you hand over

Open every variant at a phone width and a laptop width in a real browser (the `browser-check`
skill), read the console, and fix broken layout. A variant that does not render is not an option.

## 6. Hand it over

Give the URL and the variant keys. The useful feedback is usually "the header of B with the list
of C": that is the design the owner wants.

## 7. Capture and clean up

Capture the answer (which variant, and why) and the prototype as the skill says. Then:

- **Existing page**: build the winner properly into the page (the `frontend-design` skill), and
  remove the losing variants and the switcher from the main branch.
- **New page**: turn the winner into a real route, and remove the throwaway route and the switcher
  from the main branch.

The full set of variants is a primary source: it goes on the throwaway branch, not in the bin.
Variant code and switchers left in the main branch rot fast and confuse the next reader.

## Traps

- **Variants that differ only in colour or copy.** A tweak, not a prototype.
- **Too much shared code.** A shared header is fine; a shared layout defeats the point. Each
  variant must be free to throw the layout out.
- **Real mutations.** Variants are read-only. If one must change data, point it at a stub: the
  question is how it looks, not whether the backend works.
- **Promoting a variant to production as it is.** It was written without tests and error
  handling. Rewrite it when you fold it in.
