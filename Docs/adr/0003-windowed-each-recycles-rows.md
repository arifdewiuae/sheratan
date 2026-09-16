# 0003 — A windowed `each` recycles rows, and the caller supplies the window

**Status:** accepted, 2026-09-16 · implements SPEC §9 "Templates and rendering"

## Context

SPEC §12's definition of done asks for a 500-row virtualized table, and SPEC §9
specifies the mechanism: "instead of creating and destroying nodes on scroll,
it keeps a fixed set of rows and rewrites values in place… mechanism in core,
policy outside". Two questions were left open, and both have a real trade-off.

**Where the numbers come from.** Every userland virtualizer measures the
scroll container itself. `each` cannot, for two reasons that are not going
away. `watchFrame` runs its body immediately on creation, so the list's first
reconcile happens while its rows are still inside a detached
`DocumentFragment` — there is no ancestor to measure and nothing for
`getComputedStyle` to answer about. And the test host has no layout at all:
happy-dom pins `clientHeight` to 0, ships `ResizeObserver` as an empty stub and
treats `scrollTop` as plain storage. A measurement inside `each` would be wrong
at mount and untestable against a 100% coverage gate.

**What a row is.** Keeping rows keyed while windowing means a scroll both
creates and destroys nodes, which is the cost virtualization exists to avoid.

## Decision

`each(list, row, window)` takes `window` as an `Accessor<EachWindow>` —
`{ start, count, rowHeight }` — and the windowed list is **positional**:

- `count` rows are built once. Slot *i* shows `list[start + i]` by writing the
  row's existing item signal, so moving the window allocates nothing and the
  cells' computeds rewrite the text nodes they own. `count` changing grows or
  shrinks the pool; `start` changing is pure writes.
- Two spacers, above and below, hold the scrollbar open for the rows that are
  not in the DOM. A spacer takes its tag from the first row's first element, so
  it is an `<li>` inside a `<ul>` and a `<tr>` inside a `<tbody>`, and carries
  `role="presentation"` and `aria-hidden` so the list stays valid to a screen
  reader.
- A list change touches only the `count` visible slots. This is the actual win:
  a batch that reconciled 500 rows now touches about 32.
- An out-of-range window is clamped, not rejected. The window is a
  measurement, and measurements run off the ends of a list: a rubber-banding
  scroll reports a negative offset, and a container taller than the data asks
  for more rows than exist.

Without a `window` argument the keyed path is unchanged, byte for byte.

## Trade-off accepted

- **A windowed row is not keyed.** A slot is recycled, so a row's DOM node no
  longer follows its item when the list reorders — focus, text selection,
  playing media and CSS animation stay with the screen position rather than
  with the data. That is precisely what makes scrolling allocation-free, but it
  is a genuine semantic difference between `each(list, row)` and
  `each(list, row, window)`, and it is why the two are separate call shapes
  rather than a flag.
- **Key validation does not run on the windowed path.** An item without `id`
  (`SHR-R006`) or a duplicate key (`SHR-R007`) is an error in a keyed list and
  silent in a windowed one, because a positional list never reads a key.
- **The caller owns a measurement it can get wrong.** A `rowHeight` that does
  not match the stylesheet makes the scrollbar lie. `examples/hello` keeps the
  number in one place and pushes it to CSS as a custom property; a
  `windowBy(element, rowHeight, overscan)` helper that does the measuring is a
  follow-up, once element refs exist (TASKS).
- **485 bytes brotli**, about 10% of the runtime, paid by every app rather than
  only by the ones that window — the published `dist/prod` is a single
  flattened file, so a consumer's bundler cannot shake out what it does not
  import (TASKS "Spec gaps").

## Revisit if

- Per-row DOM state turns out to matter inside a window in practice. The answer
  is a keyed window mode — the pool keyed by `item.id` with a free list — not a
  change to this one, because the allocation-free guarantee is the point.
- Element refs land and the measurement can move into a `windowBy` helper
  without `each` itself reaching for layout. The window stays an input; the
  helper is what stops every app writing the same scroll listener.
