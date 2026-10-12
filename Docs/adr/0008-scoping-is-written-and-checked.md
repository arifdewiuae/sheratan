# 0008 — A module's root is named in its view and checked; an app's styles scope to the element it mounts into

**Status:** accepted, 2026-10-12 · amends SPEC §9a "The rule", "Common styles" and "Widget mode", §10d · Road to 0.1.0 step 4

## Context

SPEC §9a said two things about a module's root markers —
`class="module-orders" data-module="orders"` — that cannot both hold. "Set by
the runtime at mount, never written by hand", and three paragraphs later,
"`sheratan generate module` and `sheratan create` write both". The code does
the second: every view in `examples/hello` and the `create` template writes
them, and three of hello's six modules don't, because nothing checks.

The runtime version has no way to learn the name. `mount()`, `render()` and
`routes()` receive a view function; the module's directory is not a value at
run time, and `index.ts` exports `kind` and a factory, neither of which the
runtime ever sees. Setting the markers at mount needs the name handed over,
which means a new public function — `named('orders', view)` or a `name` option
on `mount()` — where the name is still typed by hand, only further from the
markup it ends up in.

Widget mode had the same gap one level up. §9a said a widget ships "its
`global.css` tokens scoped to its own root (`@scope ([data-sheratan-root])`)",
without saying what puts `data-sheratan-root` on the root, and without the
`base` layer, which styles `body` and `*` and would restyle the host page just
as surely as tokens on `:root` would.

## Decision

**A module's root markers are written in its view and checked.** The root
element of the template a `*.view.ts` returns carries `class="module-<name>"`
and `data-module="<name>"`, where `<name>` is the module's directory; a `ui/`
component's carries `class="ui-<name>"` and `data-ui="<name>"`. `create` and
`generate` write them; the checker reports a root without them, or with
another module's name, and the message is the markup to write. No runtime
code, no new export, and the source says what devtools will show.

**There is one `global.css`, and it never styles the page above the app.**
`tokens` and `base` live inside `@scope ([data-sheratan-root])`: tokens on
`:scope`, base on `:scope` and the elements under it. `:root`, `html` and
`body` do not appear. `render()` puts `data-sheratan-root` on the element it
mounts into, unless it is already there, and removes it on dispose if it put it
there.

A whole-page app is therefore a widget mounted on `document.body`. The page's
`<body data-sheratan-root>` is written in `index.html` as well, so the first
paint is already styled rather than styled once the script has run; `render()`
finds it there and leaves it alone. A widget inside somebody else's page is the
same code mounted on their element: its tokens and base reach nothing outside
it.

**A module sheet may only use tokens that exist.** `var(--name)` with no
fallback, in a module or `ui/` sheet, must name a custom property declared in
`global.css`'s tokens or in that sheet. An undeclared one resolves to the
property's initial value — a border that vanishes, text that turns black in
dark mode — with nothing logged, which is what `orders.css` in
`examples/hello` did with three names for a month.

## Trade-off accepted

- **The name is typed in two places,** the directory and the view's root, plus
  the stylesheet's `@scope`. The checker holds all three to the directory, so
  a mismatch fails `sheratan check` with the fix, rather than rendering
  unstyled.
- **A view must have one root element.** A view returning two siblings, or a
  bare text hole, has nowhere to put the markers and is reported. Every view
  in this repository already has one.
- **Two Sheratan widgets from different apps on one page share
  `[data-sheratan-root]`,** so both pages' tokens and base apply to both roots,
  and the stylesheet loaded last wins. 0.1.0 documents it. The escape hatch §9a
  already names — mounting the widget in a shadow root — is the fix when it is
  met, as a mount option.
- **Mounting on `body` appends after `index.html`'s scripts.** Harmless — a
  module script has run by then — and it is the reason `render()` appends
  rather than replacing the host's children.

## Rejected

- **The runtime sets the markers** from a name passed at mount. A new export
  (A5) to move one hand-typed name from the markup to the call site, plus a
  runtime error for views without one root element — which the checker reports
  anyway, earlier.
- **Two forms of `global.css`,** `:root` for an app and scoped for a widget,
  with the checker accepting either. That is a choice every new app makes, and
  A1 says there is one way; it is also the form that breaks the day an app is
  embedded.
- **Deriving the root attribute's value from the app,** so two widgets on one
  page differ. `render()` does not know the app's name either, and a value is
  what Gecko collapses in an `@scope` root (§9a's matrix).

## Revisit when

- Someone embeds two Sheratan widgets from different apps on one page. The
  first answer is the shadow-root mount option.
- `generate` exists and a hand-written root becomes rare — the check stays,
  since an agent edits views after generating them.
