# What it takes to match one import

**Measured 2026-09-16.** Reproduce with [`comparison/`](comparison/README.md).

Sheratan is one package. The question this answers is what another stack has to
install, and ship, to reach the same feature set — not "which framework is
smaller", which is a question about nothing.

Every row is bundled by the same esbuild call, minified the same way and gzipped
at the same level, importing only the APIs that stack needs for the capabilities
in the matrix below. Nothing imports a package's whole surface, including ours.

| Stack | Packages | gzip | vs Sheratan |
|---|---|---|---|
| **Sheratan** | **1** — `sheratan` | **6.9 kB** | — |
| Solid 1.9 | 3 — `solid-js`, `@tanstack/solid-query`, `@tanstack/solid-virtual` | 25.6 kB | 3.7× |
| Svelte 5 | 3 — `svelte`, `@tanstack/svelte-query`, `@tanstack/svelte-virtual` | 37.0 kB | 5.4× |
| Vue 3 | 3 — `vue`, `@tanstack/vue-query`, `@tanstack/vue-virtual` | 41.8 kB | 6.1× |
| React 19 | 4 — `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-virtual` | 84.1 kB | 12.2× |
| Angular 19 | 5 — `@angular/core`, `@angular/common`, `@angular/platform-browser`, `@angular/cdk`, `rxjs` | 145.5 kB | 21.1× |

The headline is not the multiple. It is that **the whole of Sheratan is smaller
than the smallest single piece of any of the others**, and that reaching parity
takes one install rather than three to five.

## What is being matched

| Capability | Sheratan | Solid 1.9 | Svelte 5 | Vue 3 | React 19 | Angular 19 |
|---|---|---|---|---|---|---|
| Signals | `signal` | `createSignal` | `$state` | `ref` | — re-render + `useMemo`; signals need a package | `signal` |
| Derived values | `computed` | `createMemo` | `$derived` | `computed` | `useMemo` | `computed` |
| Effects, disposed with the owner | `watch`, `onDispose` | `createEffect`, `onCleanup` | `$effect` | `watchEffect`, `onScopeDispose` | `useEffect` | `effect`, `DestroyRef` |
| Batched writes | `batch` | `batch` | automatic | automatic | automatic | automatic |
| Rendering without a virtual DOM | `html` + `render` | JSX, compiled | compiled | — virtual DOM | — virtual DOM | compiled |
| Keyed lists, minimum DOM moves | `each` | `<For>` | `{#each … (key)}` | `v-for` + `:key` | `key` prop | `@for` + `track` |
| **Windowed lists** | `each(list, row, window)` | `@tanstack/solid-virtual` | `@tanstack/svelte-virtual` | `@tanstack/vue-virtual` | `@tanstack/react-virtual` | `@angular/cdk/scrolling` |
| **Async lifecycle** — cancel on key change, dedupe, out-of-order discard, retry with backoff, stale-while-revalidate | `resource` | `@tanstack/solid-query` | `@tanstack/svelte-query` | `@tanstack/vue-query` | `@tanstack/react-query` | `rxjs` + `HttpClient`, assembled by hand |
| **Push data, folded once per frame** | `stream` | by hand | by hand | by hand | `useSyncExternalStore`, no folding | `rxjs`, folding by hand |

The three bold rows are where the package count comes from. Every other stack
treats virtualization and the async request lifecycle as somebody else's
problem, which is defensible — and which is why "React is 3 kB" is a number
about `createElement`, not about an application.

## What Sheratan does not have

Publishing the first table without this one would be dishonest.

| | Sheratan | The others |
|---|---|---|
| Server rendering / hydration | **No**, and not planned for v0 (SPEC §13 keeps the door open) | All five |
| Router | Specified, not built (SPEC §9b) | All five, in wide use |
| Forms, animation, i18n, component libraries | None | Years of ecosystem |
| Production use | Pre-release; nothing on npm | Millions of applications |
| Browser devtools extension | No — the causal trace is JSON from the dev build (SPEC §7) | React, Vue, Svelte, Angular |

And the other direction, where the comparison has no column because nobody else
has one: an **architecture checker** that fails the build on a layering
violation and returns a machine-readable `fix` (SPEC §8), a **causal trace**
from write to DOM patch (SPEC §7), and **no build step** — the same app runs
from any static file server as plain ESM (SPEC §10c). None of those three cost a
byte in production.

## Caveats

Read these before quoting the table.

1. **Tree-shaking is per-app.** Each row imports what a parity app needs, but a
   real app imports less or more. Treat the ratios as indicative.
2. **Svelte is compiled for real.** `comparison/app.svelte` goes through
   `svelte/compiler`, so Svelte's row is the runtime a component actually pulls
   in. A larger app pulls in more of `svelte/internal/client`, so Svelte's true
   number rises with app size in a way the others' do not.
3. **Angular is an upper bound.** Without AOT and its own optimizer, more of
   `@angular/core` survives than an `ng build` would ship.
4. **Vue is measured runtime-only** — `vue.runtime.esm-bundler.js`, no template
   compiler, which is the fair build.
5. **React's row is honest about CJS.** `react` and `react-dom` ship CommonJS,
   which shakes far worse than ESM. That is a real cost of using them, not a
   measurement artefact.
6. **Sheratan's own number is its whole runtime.** There is no second package to
   add later for state, data or lists; there is also no router yet, and adding
   one will move this number.

## Versions

React 19.3.0 · React DOM 19.3.0 · Vue 3.5.42 · Svelte 5.57.0 · Solid 1.9.15 ·
Angular 19.2.25 (`@angular/cdk` 19.2.19) · RxJS 7.8.2 · TanStack Query 5.103.0
(Svelte 6.2.0) · TanStack Virtual 3.13–3.14 · esbuild 0.28.2
