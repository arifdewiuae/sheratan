# What it takes to match one import

**Size measured 2026-09-16, speed 2026-09-24.** Reproduce with
[`comparison/`](comparison/README.md).

Sheratan is one package. The question this answers is what another stack has to
install, and ship, to reach the same feature set — not "which framework is
smaller", which is a question about nothing.

Size is the least interesting axis here, and it is first only because it is the
easiest to verify. [Speed](#how-fast-a-reorder-is) comes next because a small
runtime that reconciles badly is worth nothing. The axis the project exists for
is [authorability by an agent](#the-axis-nobody-else-competes-on), last.

Every row is bundled by the same esbuild call, minified the same way and gzipped
at the same level, importing only the APIs that stack needs for the capabilities
in the matrix below. Nothing imports a package's whole surface, including ours.

| Stack | Packages | gzip | vs Sheratan |
|---|---|---|---|
| **Sheratan** | **1** — `sheratan` | **7.0 kB** | — |
| Solid 1.9 | 3 — `solid-js`, `@tanstack/solid-query`, `@tanstack/solid-virtual` | 25.6 kB | 3.7× |
| Svelte 5 | 3 — `svelte`, `@tanstack/svelte-query`, `@tanstack/svelte-virtual` | 37.0 kB | 5.3× |
| Vue 3 | 3 — `vue`, `@tanstack/vue-query`, `@tanstack/vue-virtual` | 41.8 kB | 6.0× |
| React 19 | 4 — `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-virtual` | 84.1 kB | 12.0× |
| Angular 19 | 5 — `@angular/core`, `@angular/common`, `@angular/platform-browser`, `@angular/cdk`, `rxjs` | 145.5 kB | 20.8× |

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

## How fast a reorder is

**The Week 1 gate** (`Docs/EVAL.md`): a 500-row list, reordered, within **2× of
Solid**. Solid is the baseline because it is the fastest of the five at exactly
this — fine-grained, compiled, no virtual DOM — so clearing it is a claim worth
making and failing it is a reason to stop and fix reconciliation.

Both arms render the same 500 rows, apply the same 20 swaps per frame from the
same seeded sequence, and commit once. The sample is the work inside one
animation frame: apply the swaps, commit, and force style and layout, because a
runtime that only queues DOM writes has not paid for them until the page is laid
out again. 600 frames per run, 5 runs, the first 120 frames discarded.

Five sessions, each of them 5 runs, on the same machine:

| Session | Sheratan p95 | Solid p95 | ratio | Sheratan median frame | Solid median frame |
|---|---|---|---|---|---|
| 1 | 3.1 ms | 2.6 ms | 1.19× | 1.2 ms | 1.0 ms |
| 2 | 3.3 ms | 2.6 ms | 1.27× | 1.2 ms | 1.0 ms |
| 3 | 3.1 ms | 2.3 ms | 1.35× | 1.2 ms | 1.0 ms |
| 4 | 3.1 ms | 2.6 ms | 1.19× | 1.2 ms | 1.0 ms |
| 5 | 1.6 ms | 2.3 ms | 0.70× | 1.1 ms | 1.0 ms |

**The gate is met in every session, with margin.** The honest summary is that on
this workload the two are at parity: **1.1–1.2× of Solid on the median frame**,
and anywhere from **0.70× to 1.35×** on p95 — a spread wider than the gap
between the arms, which is what it looks like when the number is bounded by the
machine rather than by the runtime.

Quote the median frame. p95 is the thirtieth-worst frame out of six hundred, so
it picks up whatever else the machine was doing; the median moved by 0.1 ms
across five sessions while p95 moved by 1.7 ms.

Neither arm drops a frame in any session. At this size both finish a reorder in
under a fifth of the budget, so the multiple is the interesting part, not the
milliseconds.

**The instrument was checked against a deliberately broken reconciler.** With
`longestIncreasing()` stubbed to return nothing — so every row moves instead of
the minimum — Sheratan reads **3.9 ms on the median frame against Solid's 1.0,
and 4.6 ms p95**. That is what the benchmark is for: a 3.9× median where the
working reconciler sits at 1.1–1.2× is a reconciler doing 500 moves where 40
would do, and the number says so immediately.

It is also a fair warning about the gate as written: on p95 that same broken
reconciler reads 1.77×, so it would still clear a 2× bar on this workload. The
median frame separates them; p95 does not.

Why not measure the interval between frames: at 60 Hz a runtime that finishes in
2 ms and one that finishes in 12 ms both produce 16.7 ms frames, and the number
says nothing until one of them falls behind the display. What a reorder costs is
the work inside the frame.

**Machine and build.** Apple M2 Pro, macOS 26.6.2, Node 24.18.0, headless
Chromium 153.0.8010.12 with background throttling off. Sheratan is its published
production bundle, not `src`; Solid is compiled by `babel-preset-solid`, because
measuring it through a runtime template engine would understate the baseline and
the gate is stated against Solid at its best.

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
   add later for state, data or lists. Routing landed after this table was
   recorded and is not in it: `location`, `routes()` and `navigate()` cost
   558 B brotli, and no other stack's row carries a router either, so adding
   one is a change to every row rather than to ours.
7. **The speed table is one workload on one machine.** Reordering is the
   operation the gate names; it is not a benchmark suite, and nothing here says
   anything about first paint, memory or a hundred-thousand-row table.
8. **Bytes are the easy axis, not the important one.** Every row here would be
   unchanged if one of these frameworks shipped a checker and machine-readable
   fixes tomorrow, and that would matter far more than the kilobytes.

## Versions

React 19.3.0 · React DOM 19.3.0 · Vue 3.5.42 · Svelte 5.57.0 · Solid 1.9.15 ·
Angular 19.2.25 (`@angular/cdk` 19.2.19) · RxJS 7.8.2 · TanStack Query 5.103.0
(Svelte 6.2.0) · TanStack Virtual 3.13–3.14 · esbuild 0.28.2 · Playwright
1.63.0 · babel-preset-solid 1.9.9
