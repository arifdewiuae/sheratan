# Using a component library

Sheratan ships no components, and will not. What it ships instead is a renderer
that speaks the platform's own component format, so the component libraries that
already exist work here with **no adapter, no wrapper and no plugin**.

That format is custom elements. `<sl-select>`, `<md-filled-button>`,
`<sp-picker>` are elements; Sheratan renders elements; there is nothing in
between to write.

## The three things that usually need an adapter

Every framework's "how do I use web components" page is about the same three
problems. Here is where each one lands.

**Passing data that is not a string.** An attribute can only hold text, so
frameworks need an escape hatch for arrays and objects. Sheratan already has
one, and it is the same one used for native properties:

```ts
// `.prop` sets the property, not the attribute — and it is reactive.
html`<x-chart .series=${points} .options=${chartOptions}></x-chart>`
```

`points` can be a signal or a computed. When it changes, the property is written
again on the next frame. Nothing is serialised, nothing is parsed.

**Listening to the library's own events.** A component library announces changes
under its own name — `sl-change`, `md-input`. `@` is a plain
`addEventListener`, so a namespaced name binds like any other:

```ts
// view
html`<sl-select .value=${state.sort} @sl-change=${intents.sortBy}>
  <sl-option value="value">Value</sl-option>
  <sl-option value="name">Name</sl-option>
</sl-select>`

// effects
sortBy: (value) => { state.sorted(value === 'name' ? SortKey.Name : SortKey.Value); }
```

The intent receives the element's `value`, because a payload is read from the
element rather than looked up by event name (SPEC §9 Intents). A library's
control is a control.

The listener is removed when the owning module unmounts, like every other
binding — there is no cleanup to write.

**Theming.** This one is free, and it is worth knowing why. Design tokens are
custom properties on `:root` in `@layer tokens`, and **custom properties inherit
through a shadow boundary**. A component styles itself from the same tokens the
app uses, without piercing anything:

```css
/* styles/global.css — @layer tokens */
:root {
  --ink: #16161a;
  --sl-color-neutral-900: var(--ink);   /* the library reads its own names */
}
```

Note the limit: **`@layer` does not reach inside a shadow root.** Layers order
the document's cascade, and a shadow root has its own. Tokens cross; rules do
not. Theme through custom properties and the library's documented parts, never
by trying to out-specify its internals.

## Where registration goes

Importing a component library is a side effect — the import statement defines
custom elements on the global registry. Side effects belong in one place:

```ts
// app.ts
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';

import { createDashboard } from './modules/dashboard/index.ts';
// …
```

**The view imports nothing.** That is the part worth pausing on: a custom
element is used by *tag name*, so a view that renders `<sl-select>` has no
import at all, and therefore nothing for the import matrix (`SHR-L001`) to
forbid. The layer rules and a third-party component library do not interact.

Import the components you use, not the whole library — every one of these ships
per-component entry points, and that is where the byte cost is decided.

## Lists

A row can be a custom element:

```ts
html`<div class="cards">
  ${each(state.visible, (item) => html`<x-card .item=${item}></x-card>`)}
</div>`
```

A **windowed** list has one wrinkle worth knowing. `each` gives its spacers the
same tag as the rows, so a spacer is legal where a row is — an `<li>` inside a
`<ul>`. It deliberately does *not* do that for custom elements: creating one
upgrades it, which runs the component's constructor and builds its shadow DOM,
and a spacer that renders a component is not a spacer. Custom-element rows get
plain `<div>` spacers instead.

If the parent needs specific children — a library's `<x-menu>` that only lays
out `<x-menu-item>` — window a wrapper rather than the component:

```ts
html`<ul>${each(items, (item) => html`<li><x-menu-item .item=${item}></x-menu-item></li>`, window)}</ul>`
```

## Forms

A `submit` payload comes from `FormData`, which only sees controls that
participate in form submission. Component libraries do this with
`ElementInternals`, and most modern ones do it correctly — but it is the thing
to check before choosing one, because a control that does not participate is
invisible to the payload.

Where a library's control does not participate, bind its value to state and read
state in the transition instead of relying on the form.

## What this does not solve

- **It is a dependency of your app, not of Sheratan.** A4 forbids runtime
  dependencies in `packages/core`; it says nothing about what an application
  installs. Your `package.json` grows, and the number in
  [COMPARISON.md](../COMPARISON.md) does not.
- **Bundle size is the library's, not ours.** Per-component imports matter.
- **Server rendering** of declarative shadow DOM is not a thing Sheratan does,
  because Sheratan does not render on the server at all (SPEC §13).
- **No checker rules apply to a component library's API.** The checker enforces
  your architecture, not the library's correct use. `<sl-select>` with a typo in
  an attribute fails the way it would anywhere.

## Libraries worth a look

Framework-agnostic by construction, in rough order of breadth:

| | |
|---|---|
| Broad component sets | Shoelace / Web Awesome, Material Web, Spectrum Web Components, Carbon, Fluent UI, Vaadin |
| Headless logic | Zag.js — state machines with no rendering of their own; Floating UI for positioning |
| CSS only | Open Props, Pico |

The headless option deserves more attention than it usually gets here: a state
machine that owns keyboard handling and ARIA, with markup left to you, fits a
`ui/` component better than a styled black box does — and `ui/` is exactly where
SPEC §4 puts a stateless reusable component.
