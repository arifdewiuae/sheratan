# What it takes to match one import

**Measured 2026-09-16.** Reproduce with [`comparison/`](comparison/README.md).

Sheratan is one package. The question this answers is what another stack has to
install, and ship, to reach the same feature set — not "which framework is
smaller", which is a question about nothing.

Size is the least interesting axis here, and it is first only because it is the
easiest to verify. The one that the project exists for is
[authorability by an agent](#the-axis-nobody-else-competes-on), below.

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

## The axis nobody else competes on

Sheratan exists because a code-generating agent does not fail for want of a
linter. It fails because there are too many legal ways to do the same thing, and
because when it gets one wrong nothing tells it what to write instead. None of
the five frameworks above is designed for that reader.

| | Sheratan | Solid · Svelte · Vue · React · Angular |
|---|---|---|
| One legal structure, so there is nothing to choose wrong | Yes — the module contract (SPEC §4) | No. Structure is convention, and every project has a different one |
| Violations as machine-readable JSON with a `fix` an agent can apply | Specified (SPEC §8); lint rules stand in today | No equivalent. ESLint reports a rule name, not the code to write instead |
| Docs shipped **for the model**, generated from the declarations and CI-checked against them | Yes — [`llms.txt`](../llms.txt), built today | No. Human docs, versioned separately from the code, drift silently |
| Why the DOM changed, as JSON | Specified (SPEC §7) | Devtools extensions — human-readable, agent-opaque |
| `--json` on every CLI command | Specified (SPEC §10) | Partial at best |
| One package decision instead of five | Yes | State, data, virtualization, routing and forms are all open choices |

**What of that is built today: `llms.txt`, the causal trace, and the lint rules
standing in for the checker.** The checker, the CLI and `SKILL.md` are specified
and unwritten.

The claim that any of it makes an agent measurably better is **half tested.**
[EVAL](EVAL.md)'s Week 0 gate has two conditions, and only one has been run:
structured boundary errors produce a correct one-turn repair 60/60 times
against a threshold of 80% ([EVAL-RESULTS](EVAL-RESULTS.md), `claude-sonnet-5`,
2026-09-16). What has **not** been run is the half this table is about — whether
any of it beats the stacks above, which needs a control arm that does not exist
yet. Nothing here is a comparative result, and the self-repair number is not
one either: it has no control framework in it.

## What Sheratan does not have

Publishing the first table without this one would be dishonest.

| | Sheratan | The others |
|---|---|---|
| Router | **Not built.** Specified in SPEC §9b — `location` as a signal, delegated `<a>` interception, `navigate()`, flat `match()` over `URLPattern`. Basic routing belongs in core; anything nested is a separate package | All five ship or bless one, in wide use |
| Server rendering / hydration | **No, by decision** (SPEC §13), and post-MVP at the earliest. The target niche is authenticated app UIs (SPEC §1), where it matters least — but it does rule out public, SEO-facing pages | All five |
| Component library ecosystem | None of its own — the answer is [a web component library](guides/web-components.md), which works with no adapter | MUI, Vuetify, shadcn, Angular Material, and the rest |
| Forms, animation, i18n | Separate packages, as they should be | Also separate packages — **except Angular**, which ships `@angular/forms`, `@angular/animations` and `@angular/localize` first-party |
| Production use | Pre-release; nothing on npm | Millions of applications |
| Browser devtools extension | Not built, and planned as a *second* surface: the causal trace is JSON first, because an extension is readable by a human and opaque to an agent (TASKS "Devtools surface") | React, Vue, Svelte, Angular |

One line in that table is not a gap at all, and it is worth separating. Forms,
animation and i18n are third-party in React, Vue, Svelte and Solid too, so
counting them against a core is a category error. What is genuinely missing is
the **ecosystem** — the component libraries, and the years of answers on the
internet.

The other direction, where the comparison has no column because nobody else has
one: **no build step** — the same app runs from any static file server as plain
ESM, with type stripping and no bundler (SPEC §10c) — alongside the checker and
the trace above. None of those costs a byte in production.

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
   add later for state, data or lists. There is also no router yet: SPEC §9b
   budgets `match()` at roughly thirty lines over `URLPattern`, but until it is
   written that is an estimate, and it will move this number.
7. **Bytes are the easy axis, not the important one.** Every row here would be
   unchanged if one of these frameworks shipped a checker and machine-readable
   fixes tomorrow, and that would matter far more than the kilobytes.

## Versions

React 19.3.0 · React DOM 19.3.0 · Vue 3.5.42 · Svelte 5.57.0 · Solid 1.9.15 ·
Angular 19.2.25 (`@angular/cdk` 19.2.19) · RxJS 7.8.2 · TanStack Query 5.103.0
(Svelte 6.2.0) · TanStack Virtual 3.13–3.14 · esbuild 0.28.2
