# SHERATAN — Task Tracker

Source of truth for *what* and *why*: [SPEC.md](SPEC.md), [PLAN.md](PLAN.md), [EVAL.md](EVAL.md).
This file tracks *progress* only. If a task here disagrees with SPEC, SPEC wins or gets amended.

**Rule:** a week that doesn't close cuts scope, not the deadline. Cut `[stretch]` first, never `[must]`.

## Legend

| Tag | Meaning |
|---|---|
| `[must]` | In PLAN's must-list — survives any schedule slip |
| `[stretch]` | "If time remains" in PLAN's cut list — first to go |
| *(no tag)* | Planned for the week; cut before `[must]`, after `[stretch]` |
| `[gate]` | Go/no-go checkpoint with a pre-agreed failure action |

## Status

| Week | Focus | Status | Gate result |
|---|---|---|---|
| Pre-flight | Names, repo | 🟡 In progress | — |
| 0 | Falsification | 🟡 In progress | Self-repair ✅ 60/60 · median iterations vs React not run |
| 1 | Core | 🟡 In progress | No-build ✅ · reordering vs Solid not measured |
| 2 | Async, ownership, trace | 🟡 In progress | Correct and leak-free ✅ · trace readable ✅ |
| 3 | Checker, CLI, template | 🟡 In progress | — |
| 4 | Agent surface, reference app | ⬜ Not started | — |
| 5 | Re-measure, package, launch | 🟡 In progress | — |
| +8 wks | Outside production use | ⬜ Not started | — |

Status values: ⬜ Not started · 🟡 In progress · ✅ Done · ✂️ Cut · ⛔ Stopped

Last audited against the code on **2026-09-17**. A tick names where the work
landed, so the claim can be checked without reading the diff.

---

## Pre-flight

- [ ] Verify GitHub org handle `sheratan` is available and claim it
- [x] Verify and register `sheratan.dev` — it goes into checker `docs` links and can't change later (SPEC header, §8) — **registered 2026-09-17**, GoDaddy, expires 2027-09-17, all four client locks already on (delete/renew/transfer/update prohibited). Every `SHR-*` docs URL now resolves to a domain we own; what it resolves *to* is the Week 4 error index
- [ ] Domain durability: auto-renew on with a card valid past 2027-09-17, account 2FA via authenticator app, and a registrar contact address **not** `@sheratan.dev` — the error URL is compiled into every published bundle, so a lapse breaks error messages in apps we don't control
- [x] Reserve `sheratan` on npm — **`sheratan@0.0.1` published 2026-09-17**, then deprecated the same day ("Pre-release name reservation — not usable software. See https://sheratan.dev") so nobody installs it by accident. Published from a laptop because npm will not configure trusted publishing against a package that does not exist; `release.yml` takes over from the second release onward. The deprecation is reversible — `npm deprecate sheratan@0.0.1 ""` clears it at v0.1.0
- [x] `git init`; monorepo skeleton (SPEC §11) — pnpm workspace over `packages/*` and `examples/*`, with every root script `pnpm -r --if-present`, so a new package joins by existing. `packages/eval` proved it: nothing at the root changed to admit it. `packages/check` and `packages/cli` are Week 3 items and `examples/dashboard` is Week 4 — they are tracked there, not held open here
- [x] Commit SPEC / PLAN / EVAL / TASKS as the baseline — `0d7e8e1`

---

## Week 0 — Falsification (2–3 days, before the core)

Goal: test the central hypothesis while it costs three days. Harness timebox: 2 days (EVAL "Scope discipline").

**Setup**
- [x] `llms.txt` v0: API, import matrix, reactivity trap as the first item, canonical module (SPEC §10) — [llms.txt](../llms.txt), ~4.0–4.7k tokens estimated (recount with the evaluated model's counter before the first run); canonical module executed end to end
- [x] Small **real** signal runtime, 200–300 lines — not a stub (EVAL intro) — `packages/core`: signals, scheduler, `html`, keyed `each`, `render`; TypeScript; 2,554 non-blank lines, 141 unit tests and 6.4 KB brotli as of 2026-09-17 (it was 1,708 lines, 81 tests and 5.3 KB when Week 0 ran — `resource`, `stream`, the trace and the windowed pool landed since)
- [x] Freeze and version 12 eval tasks (EVAL §2.1) — [EVAL-TASKS.md](EVAL-TASKS.md), tag `eval-tasks-v1`, SHA-256 `7a19d6474fbcb1a417d60fb3c2be815c908d8cb68bd50a7a60a3a5a9a317f1ce`
- [x] Split: 6 headline tasks + 6 held-out (EVAL-TASKS §2)
- [x] Fix the documentation token budget for both arms **and write it down** before the first run — 8,000 tokens (EVAL-TASKS §1.5)
- [~] Eval harness skeleton — `packages/eval` runs the self-repair sub-eval (5 seeds, raw logs, seeded case list). The task-eval half (`evalkit`, 10-iteration cap, non-convergence) is not built
- [ ] Check what exactly Lit does *not* cover for `resource` and trace (PLAN risks)

**Self-repair sub-eval** (EVAL §2.3) — run 2026-09-16, [results](EVAL-RESULTS.md)
- [x] Host app: four modules in the canonical shape (T01, T03, T04 and the toast T04 asks for) — `packages/eval/hosts`, 15 behaviour assertions taken from the hidden-test bullets
- [x] Working file with injected violation: I/O inside a view — `SHR-L002`, four hosts
- [x] Working file with injected violation: direct state write from effects — `SHR-L005`, four hosts
- [x] Working file with injected violation: deep import of another module — `SHR-L001`, four hosts
- [x] Structured checker JSON (code, message, `fix`, `docs`) for each — **generated** rather than hand-written, by the same code that judges the submission, so a run cannot pass on input that was worded kindly
- [x] Every injection proved behaviour-preserving before it is used (`pnpm --filter @sheratan/eval check:cases`)
- [x] Run: agent gets only the JSON; record one-turn fix yes/no — 12 cases × 5 seeds, `--restricted` (no shell, so no second attempt), raw logs committed
- [x] **Control arm the spec did not ask for:** the same 12 cases with `fix`/`docs` stripped, and again with nothing but the file name, so the number says whether the *structured error* did the work

**Comparison** — not started
- [ ] Control arm: React 19 + TanStack Query + Zustand, pass = tests green + ESLint + tsc clean
- [ ] Run ≥ 3 tasks on both arms; record iterations to green, first-attempt pass, violations, tokens, wall-clock
- [ ] Commit raw logs

- [ ] `[gate]` One-turn self-repair **≥ 80%** AND median iterations on ≥ 3 tasks **no worse than React** → otherwise **close the project**
  - [x] **Self-repair: 60/60 (100%)** against a gate of 80%, `claude-sonnet-5`, 2026-09-16. The half EVAL §2.3 calls "the Week 0 gate" — the one whose failure closes the project — is **met**.
  - [ ] Median iterations vs React: **unmeasured.** Needs `evalkit`, the hidden Playwright suites and the React arm. The gate is half-measured until it exists, and the project stays open on that basis, not on a complete result.

---

## Week 1 — Core

**Reactivity** (SPEC §5)
- [x] `[must]` Tests written *before* implementation: glitch-freedom, diamond dependencies, batching
- [x] `[must]` `signal`, `computed`, `watch` (auto-tracked, returns disposer) — doubly-linked edges, O(1) link/unlink
- [x] `[must]` Batching; glitch-free propagation
- [x] `[must]` Scheduler: DOM writes coalesced per animation frame, last value wins; `flush()` for tests
- [ ] Structural update helper for immutable state (SPEC §5 Immutability)

**Rendering** (SPEC §9)
- [x] `[must]` `html` tagged templates: parse once into `<template>`, holes as precomputed paths (no per-mount scan)
- [x] `[must]` View update model: view runs once; one micro-watcher per hole
- [x] `[must]` Attribute (`.prop`) and event (`@event`) bindings
- [x] Holes escaped as text by default — a hole becomes a text node, never markup (`html.test.ts` "static values render once and are escaped as text")
- [ ] `unsafeHTML()` directive
- [x] `[must]` Keyed `each` (no virtualization); per-row watchers, rows not rebuilt on cell change; minimum DOM moves via LIS
- [ ] Style scoping (SPEC §9a): runtime sets `data-module` / `data-ui` on roots at mount; CSS module scripts attached via `adoptedStyleSheets`
- [ ] Verify `@scope` + `@layer` browser support matrix before templates depend on it (SPEC §9a)
- [ ] Widget mode: tokens scoped to `[data-sheratan-root]`, never `:root` of the host page
- [x] `[must]` `render()` + ownership/disposal of the subtree
- [x] `[must]` Widget mode: `render(view, el)` owns only its subtree, no `document` assumptions, disposes cleanly (SPEC §10d)
- [x] `[must]` Zero dependencies, plain ESM, runs from `index.html` via `<script type="module">`

**Measure**
- [ ] 500-row list reconciliation benchmark with constant reordering (a unit test already pins *one* DOM move per row move; the benchmark is the timing half)
- [ ] Verify `app.ts` / nested factory ergonomics on a larger module tree (SPEC §14)

- [x] `[gate]` Counter and list run from a static file server (`python3 -m http.server`) with no build step — `examples/hello/public/no-build.html`: plain JavaScript, published ESM, covered by an e2e spec
- [ ] `[gate]` 500-row reordering within **2× of Solid** → otherwise fix reconciliation before anything else (EVAL Gates)

> Fallback if the core slips: thin layer over third-party signals — emergency only, costs zero-deps and the trace hook (PLAN risks).

---

## Week 2 — Async, ownership, trace

**`resource()`** (SPEC §6)
All of the below in `packages/core/src/resource.ts`, specified by
`packages/core/test/resource.test.ts` (25 tests, 100% lines/branches/functions).

- [x] `[must]` Reactive `key`; abort in-flight request on key change and on owner disposal (unmount) — one `watch` over the key accessor; every new request cancels the one it replaced, and `onDispose` cancels the last
- [x] `[must]` De-duplication of identical keys — a key compares by contents, so a rebuilt array with the same parts is the same key; `invalidate()` during a request in flight is absorbed by it
- [x] `[must]` Out-of-order responses discarded — a generation counter per request; a response from a superseded one is dropped even when the fetcher ignored its signal
- [x] `[must]` Stale-while-revalidate (`staleAfter`, `refreshing` status, previous data retained) — a timer owned by the mount, per ADR 0004; SPEC §6 amended, since it named the option without saying what triggers it
- [x] `[must]` Retry with exponential backoff — `attempts` counts the first try; 100 ms base, doubled by `'exponential'` and flat under `'fixed'`; a cancelled request is never retried
- [x] `[must]` Errors are values; `AbortError` never becomes `error()` — a thrown non-Error is wrapped; `data()` survives a failure, so an error shows beside the value it could not replace
- [x] `[must]` `invalidate()`, `abort()` — `abort()` leaves a resource with a value `ready` and one without `idle`, which is the only way `idle` is reached
- [x] `[must]` `is(status)` type guard: `is("ready")` narrows `data()` to `T`; reads `status()` only (SPEC §6) — overloads returning `this is LoadedResource<T>` / `FailedResource<T>`; `scripts/verify-types.ts` proves it narrows for a consumer too

**`mutation()`** (SPEC §6)
- [x] Basic: `run`, `status`, `error`, `optimistic`/`rollback` as transitions, `onSuccess`, serialized by default — `packages/core/src/mutation.ts`, 19 tests in `mutation.test.ts`; SPEC §6 amended with the order of events, what `status()` and `error()` describe, and what unmounting does. Post-disposal is a no-op here by construction: the mutation owns the transitions it calls, so it can refuse to call them
- [x] `[stretch]` The opt-out from serializing SPEC §6 promised — built as `key`, not as a flag: same key serialized, different keys concurrent. EVAL-TASKS T04 ships two orders at once, and a flag would have made "parallel" mean "lost updates on one record" too
- [ ] `[stretch]` Anything further — nothing is asked for yet

**Ownership & lifecycle** (SPEC §5b)
- [x] `[must]` Owner tree; children from `mount()` disposed recursively — `OwnerNode` in `packages/core/src/owner.ts`, an intrusive linked list with O(1) add and remove
- [x] `[must]` `onDispose()` — `packages/core/src/owner.ts`; `SHR-R001` when there is no owner
- [x] `[must]` Disposal order: watchers → subscriptions → nodes — `OwnerNode.dispose()` runs `teardown()` (a watcher drops its sources) before `reset()` (children, then owned subscribers, then cleanups last-registered-first)
- [ ] `[must]` Post-disposal async is a no-op (owner flag on transitions) — **blocked:** nothing marks a transition at run time (see the spec gap below). `examples/hello` checks `signal.aborted` by hand instead, which is the pattern but not the enforcement
- [x] `[must]` Leak test: 1000 mount/unmount cycles → live subscription count returns to 0 — `reactive.test.ts:465` ('leak: 1000 root mount/dispose cycles…') and `html.test.ts:680` ('render: dispose removes its nodes…'); `resource.test.ts:552` and `stream.test.ts:495` each have one, and the windowed list has its own at `window.test.ts:304`

**Streams & windowing**
- [x] `[stretch]` `stream()`: subscribe/teardown on key change and disposal, per-frame folding, `reduceMany`, `status()` reconnect (SPEC §6) — `packages/core/src/stream.ts`, 17 tests; the fold is committed by a scheduler job on the frame queue, so a thousand messages are a thousand O(1) folds and one write; SPEC §6 amended with the shipped status values and `close(reason?)`
- [x] `[stretch]` Windowed `each`: fixed row set rewritten in place; row-height policy supplied by caller (SPEC §9) — `each(list, row, window)`, positional pool + spacers, `packages/core/test/window.test.ts`, ADR 0003
- [ ] `windowBy(element, rowHeight, overscan)`: the scroll listener every windowed list otherwise writes by hand. Needs element refs; until then the window is assembled in `*.effects.ts`, as `examples/hello` shows

**Debuggability**
- [x] `[stretch]` Causal trace: write → computed → patch, ring buffer (500), sampling, `__sheratan.trace()` JSON, absent in prod (SPEC §7) — `packages/core/src/trace.ts`, 12 tests; hooks in signal, computed, instantiate and scheduler; `trace.prod.ts` swapped in for production and the build fails if `__sheratan` survives
- [x] Structured runtime errors — `SheratanError` carries a stable `code`, every message in `messages.ts` states what to write instead, and the production build swaps the table for `sheratan.dev/errors/<code>` (`src/errors.ts`, `src/env.prod.ts`). `fix` as a separate field is the checker's JSON shape (SPEC §8), not the runtime's
- [ ] `declare()` legal-transition dev assertion (SPEC §5)

- [x] `[gate]` Correct and leak-free **first**: race tests pass, 1000 cycles leave zero live subscriptions → otherwise fix ownership before measuring anything — **passed 2026-09-19.** `test/gate.test.ts` mounts one module holding every owner-scoped primitive at once — `resource` with a stale timer armed, `stream`, `mutation` with a write in flight, `watch`, `onDispose`, keyed and windowed `each` — 1000 times, and checks what a subscription count cannot see as well: every in-flight request and write aborted, every stream torn down, every cleanup run, no timer fires afterwards, no node left. Proven to fail three ways by breaking the runtime: a stale timer kept, a mutation not aborted, owner cleanups skipped. The race tests are the per-primitive suites (`resource`, `stream`, `mutation`)
- [x] `[gate]` Trace is readable by eye (if trace not cut) — **passed.** `__sheratan.format()` renders the chain as an indented tree; checked against a real update and fixed three things it exposed (objects printed as `[object Object]`, a 90-character file URL, and an `each` row write opening a chain of its own instead of continuing one)

---

## Week 3 — Checker, CLI, `create` template

`packages/check` and `packages/cli` are **folders, not products**: one tarball
publishes, and it is `sheratan`. See the spec gap on package count below.

**Checker** (SPEC §4, §8) — `typescript/unstable/*`, devDependency, `typescript` pinned exactly as peer (ADR 0005)
- [x] `[must]` One adapter module owning every `typescript/unstable/*` import — program, checker, node→range — so an unstable-API break is one file's problem (ADR 0005) — `packages/check/src/typescript.ts`. It hands out plain data (paths, positions, booleans), never a node, symbol or type, so no rule can come to depend on the API's shapes
- [x] `[must]` Import matrix (`SHR-L001`): every cell enforced, each with a failing-case test — `packages/check/src/matrix.ts` holds SPEC §4's table as data; `test/boundary.test.ts` builds the whole matrix as one project (51 cells, allowed and forbidden) and asserts exactly the forbidden ones are flagged. Proven to fail by breaking three cells
- [x] `[must]` Messages state the allowed set, not a rule number — *"view cannot import modules/todo/todo.effects.ts; allowed: lib, ui, own state."*, with a `fix` per kind of mistake, each pinned by a test
- [ ] `SHR-L002` I/O globals in `*.view.ts`
- [x] `[must]` `SHR-L010` a `*.state.ts` public surface exposes only `Accessor` values and transitions — read the declared (or inferred) member types of the state factory's return, report each `Signal` member with the accessor-plus-transition fix; failing-case test (SPEC §4) — `packages/check/src/rules/surface.ts`. "Writable" is structural — callable, with a callable `set` — so a look-alike is caught and a `Map` is not. Declared, inferred, module-level and mapped-type surfaces each have a test
- [ ] `SHR-L005` direct state mutation from effects (static, backstop to L010) + dev-build runtime assertion via write provenance (SPEC §13)
- [ ] `SHR-L006` file set matches declared module kind (`view` / `full`)
- [ ] `SHR-L008` acyclic module import graph
- [ ] `SHR-L011` statically visible mutation of a value read from a signal — `items().push(x)`, `order().status = 'shipped'` — `fix` names the replacement write (SPEC §4, ADR 0002 layer 3)
- [ ] `SHR-L009` style scoping over `.css`: single `@scope` with lower boundary, root matches module name, `global.css` only `tokens`/`base`, no `:root` tokens in module sheets, no `!important` outside `base` — failing-case test per violation (SPEC §9a)
- [ ] `SHR-T001` missing state/effects tests — **warning only**
- [ ] `SHR-L003` banned `shared/` directory; `ui/` nesting max one level
- [ ] `SHR-L004` `resource` / `mutation` / `stream` / `onDispose` / `navigate` outside `*.effects.ts`
- [ ] `SHR-V001` inline arrow function in template → error; `SHR-V002` `unsafeHTML` with non-literal argument → warning
- [ ] `SHR-L007` contract method returning a Promise without `AbortSignal` → error (SPEC §5b)
- [ ] `SHR-V003` reactivity-trap warning where detectable (SPEC §9)
- [ ] `SHR-V004` malformed template errors in the same JSON shape (SPEC §13)

**CLI** (SPEC §10)
- [ ] `[must]` `sheratan check` — human formatter + `--json` (versioned, documented schema)
- [ ] `[must]` `sheratan generate module <name>` (scaffolds both test files and the scoped `<name>.css` wrapper)
- [ ] `[must]` `sheratan generate resource <name> --in <module>`
- [ ] `sheratan generate stream <name> --in <module>`
- [ ] `sheratan create <app>`
- [ ] `[must]` `sheratan dev` — type stripping only, on Sheratan's own minimal server (prototyped in `examples/hello/serve.ts`) (SPEC §10c)
- [ ] `[must]` `sheratan build` — strips types into a deployable directory of plain ESM; no bundler (SPEC §10c)
- [ ] Logic as plain functions (`checkProject()`, `scaffoldModule()`…); CLI is a thin wrapper
- [ ] Bun and Deno in the CI matrix alongside Node — they make `dev`/`build`'s type-stripping step a no-op, which is the case worth testing (SPEC §10c)

**`create` template** (SPEC §10b)
- [ ] `styles/global.css`: layer order `tokens, base, ui, modules`; tokens + base only, dark mode via `prefers-color-scheme` (SPEC §9a)
- [ ] `[stretch]` `ui/` primitives copied into the project (Button, Input, Select, Modal, Table, Toast) on `<dialog>` / popover / `<details>`
- [ ] Canonical module covering every rule: 4 files, contract service via factory, `resource`, `stream`, `computed` projection, atomic transition, windowed `each`, `mount()` of a `ui/` primitive, `onDispose`, a scoped stylesheet using tokens, populated tests
- [ ] Correct code only — no commented-out "wrong way"
- [ ] CI: canonical module passes `sheratan check` and exercises every rule code

- [ ] `[gate]` `sheratan create` yields a working app, and `sheratan check` catches every defined violation

---

## Week 4 — Agent surface & reference app

**Agent surface** (SPEC §10) — CLI only, no MCP server
- [ ] `sheratan explain <code> [--json]` with contrastive right/wrong examples
- [ ] `sheratan trace [--json]` pulls trace from the dev server
- [ ] `--json` on every command
- [ ] `SKILL.md`: when to use, scaffolding, reading checker output, reading a trace, "one way" table
- [ ] Final `llms.txt` ≤ ~8k tokens

**Routing in core** (SPEC §9b)
- [ ] `location` signal
- [ ] Delegated `<a>` click interception (same origin, primary button, no modifiers/`target`/`download`) — opt-in in widget mode
- [ ] `navigate()` (effects only)
- [ ] Flat `match()` over `URLPattern`
- [ ] Scroll and focus restoration on back/forward

**Reference app** (SPEC §11, §12)
- [ ] `[must]` `examples/dashboard`: modules/ + services/ + `app.ts` + `e2e/`
- [ ] **Scaffolded by `sheratan create`, not hand-written, and depending on `sheratan` from the registry** (`pnpm add sheratan`) rather than `workspace:*` — so it resolves through the published `exports` map and loads `dist/prod`, the flat minified build a real user gets. Two things come free: the Week 3 `sheratan create` gate leaves a permanent artifact instead of a one-off check, and the prod-build question in Spec gaps gets measured on a real app instead of six synthetic scenarios. `examples/hello` deliberately stays on `workspace:*` — it is the runtime's own test bed and has to break when core breaks
- [ ] Streams, 500-row virtualized table, error states, forms
- [ ] Runs from plain `index.html`, no build
- [ ] Built without `@sheratan/router` (validates routing boundary)
- [ ] Answer SPEC §14: compiler needed? nested layouts needed? `app.ts` wall? → record in Decisions log

**Performance eval** (EVAL §1.2)
- [ ] `bunx sheratan-eval perf` harness
- [ ] Scenarios: ticker flood, live table, reordering list, virtualized 100k, multi-stream
- [ ] Baselines: React 19 + TanStack Query, Vue, Svelte 5, Solid — 5 runs, median + spread
- [ ] Week 1's Solid baseline as one scenario in `Docs/comparison/`: 500 rows, 20 swaps per frame, p95 frame time, 5 runs (defined in Spec gaps)

**Docs**
- [ ] Getting started page
- [ ] Rules page
- [ ] Error code index (served at `sheratan.dev/errors/<code>`)

- [ ] `[gate]` scaffold → check → fix loop works live from Claude Code using the CLI alone
- [ ] `[gate]` 60fps under 1000 msg/sec into a 500-row table (only after keyed reconciliation is real) → otherwise scheduler/renderer is wrong, headline claim dies

---

## Week 5 — Re-measure, package, launch

**Measure** (EVAL §2, 2-day timebox)
- [ ] Re-run Week 0 agent eval unchanged on the real runtime — same tasks, same budget
- [ ] Commit raw logs of every run
- [ ] `sheratan-eval agent --arm react` reproducible by a stranger
- [ ] `--arm svelte` on the held-out 6 tasks, reported beside React and gating nothing (EVAL §2.1)
- [ ] Size: `core` < 10 KB gzipped, 0 runtime deps, 1 package in user `package.json` (EVAL §1.3)
- [ ] Video: app served as plain files with empty `node_modules`

**Package**
- [ ] README: results table (model + date), training-data confound, "no bundler, no config — type stripping only", SSR is a no, `typescript` peer dep
- [ ] MIT license
- [ ] CI
- [x] **Make the repository public** — done 2026-09-17, ahead of schedule: GitHub Pages is free only on public repos. Dependency review in CI switches itself on from here
- [ ] Configure trusted publishing on npmjs.com against `arifdewiuae/sheratan`, workflow `release.yml`, **environment field left blank** — unblocked since 0.0.1 exists. Blank is not an oversight: it has to match the workflow, which carries no `environment:` (decision 2026-09-17). Fill it in and the OIDC exchange fails with a mismatch that does not name the cause
- [ ] Publish to npm by tagging `v<version>` on `main`; `.github/workflows/release.yml` does the rest, tokenless and with provenance. Pushing the tag is the only gate — the workflow refuses a tag that is not on `main` and one that disagrees with the manifest, then runs `pnpm check`, but nothing asks a human twice

**Site** — `sheratan.dev`, brought forward with the public repository
- [x] **Live on GitHub Pages**, deployed from `main` by `pages.yml`; `site/CNAME` holds the domain and Pages rewrites the setting from it on every deploy. Apex A/AAAA and a `www` CNAME at GoDaddy
- [x] **100 / 100 / 100 / 100 on Lighthouse**, measured against the live site 2026-09-17 — fonts self-hosted so nothing renders-blocks and no third-party origin is contacted, `connect-src 'self'` so the CSP stops blocking the `robots.txt` audit, `robots.txt` + `sitemap.xml`, Open Graph and Twitter card over `site/og.png`, light-only palette
- [ ] Tick **Enforce HTTPS** — `https_enforced` is still `false`; the certificate re-reads `dns_changed` while GitHub re-provisions it to cover `www.sheratan.dev`, and the box is only tickable once it is `approved` again
- [ ] Verify the domain at account-level Settings → Pages (adds a `_github-pages-challenge-arifdewiuae` TXT record), so no other GitHub account can claim `sheratan.dev` if a DNS record is ever left dangling

**Launch**
- [ ] 5-minute demo: agent violates a layer → checker catches → agent self-repairs
- [ ] 10–12 slide deck: problem, four gaps, mechanism, measurement, demo, link
- [ ] Long-form post with reproducible numbers; GitHub, Show HN, communities
- [ ] Submit CFPs now (deadlines 3–5 months out); title: "Architectural violations as compile errors"
- [ ] Check current Dubai JS / GDG meetup list; submit a 10-minute lightning talk

- [ ] `[gate]` Self-repair ≥ 80% in one turn → otherwise ship, but lead with performance, not the AI claim

---

## Post-launch — Week 5 + 8 weeks

- [ ] `[gate]` At least one person outside your circle built a real project on Sheratan and wrote about it themselves (not stars, not likes)
      → otherwise archive the repo, keep the eval data and talk as the artifact

**Devtools** (SPEC §7, dev builds only — decided post-launch 2026-09-17)
- [ ] Chrome custom formatter so a signal prints as its value, not `ƒ read()`
- [ ] Performance-panel track for drains and frame flushes
- [ ] Debug names from the trace's write provenance
- [ ] Browser extension: a panel over `__sheratan.trace()` — the causal chain as a tree you can scrub, rather than JSON in the console. The data already exists and is already absent from production builds (`trace.prod.ts`), so this is a viewer, not new runtime surface. Post-launch for the same reason as the formatter: it cannot be covered in happy-dom against a 100% gate, and it is the piece most likely to be rewritten once someone has used the trace in anger

**Editor** (post-MVP — extends the 2026-09-16 decision, which deferred this to Week 3)
- [ ] VS Code extension surfacing `sheratan check` diagnostics inline, with the checker's `fix` as a code action — the rule set's whole premise is a machine-readable repair, and an editor is where a human collects one. Blocked on the checker existing (Week 3); before that an extension would only re-highlight what the recommended lit-html extension already does, which is why workspace recommendations were chosen instead
- [ ] Decide LSP or direct `--json` invocation once `sheratan check`'s schema is versioned — an LSP is also what a JetBrains plugin would need, so it is the choice that decides whether there is ever a second editor

---

## Not in MVP — do not start, even if it looks easy

Custom dev server · Krausest PR · nested layouts / `@sheratan/router` · ten polished `ui/` primitives · declared view transitions · SSR · MCP server · optional template compiler

---

## Spec gaps to resolve

Contradictions found between SPEC, PLAN and EVAL. Resolve by amending the docs, then log below.

- [x] **Rule numbering.** PLAN Week 3 says "L001–L006, all six violations"; SPEC defines the import matrix + L002/L005/L006/L008 + T001. L001/L003/L004/L007 are undefined (L001 appears only in the §8 JSON example). Resolved in SPEC §4: L001 = every import-matrix cell, holes filled with L003/L004/L007, template rules as `V001`–`V004`.
- [x] **`stream()` priority.** Cut list marks it "if time", but SPEC §12 DoD, the canonical module (§10b) and the dashboard all require it. Resolved: built in Week 2 rather than deferred — `packages/core/src/stream.ts`, 446 B brotli.
- [x] **Windowed `each` priority.** Marked stretch, but DoD requires a 500-row *virtualized* table and the canonical module needs `each` with a window. Resolved: built in Week 2 rather than deferred — `each(list, row, window)` in `packages/core/src/each.ts`, SPEC §9 amended to the shipped signature, ADR 0003 for the recycling trade-off.
- [x] **Causal trace priority.** Marked stretch, but DoD says "causal trace renders for the reference app" and Week 2 gate says "trace readable". Resolved: built in Week 2 rather than deferred — `packages/core/src/trace.ts`, SPEC §7 amended to the shipped shape.
- [x] **Unscheduled must-items.** Widget mode and routing have no week in PLAN — tentatively placed in Week 1 and Week 4 here. Resolved 2026-09-17: the tentative placement stands as the decision. Widget mode is Week 1 and its `[must]` item is already done (`render()` owns only its subtree); routing is Week 4, after the checker, because `navigate()` is an effects-only API (`SHR-L004`) and wants the rule that enforces it to exist first.
- [x] **Solid baseline for Week 1 gate.** "Within 2× of Solid" needs a Solid implementation, while Krausest is deferred — define the minimal comparison. Resolved 2026-09-17: **one scenario, in `Docs/comparison/`** — 500 rows, 20 swaps per frame, p95 frame time over 5 runs, median and spread, same machine and same feed. That directory already installs Solid and already bundles every stack through one esbuild call, and it is outside the workspace so it cannot become a dependency. No Krausest harness, no second app: the gate asks one question and this answers exactly it.
- [x] **`resource()` placement rule.** SPEC §6 says construction outside effects is enforced by L005, but L005 is about state mutation — needs its own code or rewording. Resolved: `SHR-L004`, effects-only APIs.
- [x] **`onDispose()` placement.** SPEC §5b says effects-only; no rule code enforces it. Resolved: `SHR-L004`.
- [x] **Week 2 gate wording.** PLAN's cut-list note refers to "Week 2 gate: correct, then 60fps"; EVAL puts 60fps at Week 2–3 — pick one. Resolved 2026-09-17: Week 2's gate is correctness and leaks, in that order — which is what "correct, then 60fps" meant. The 60fps gate moves to **Week 4 in EVAL's table too**, matching where TASKS already had it, because that is where its harness is (EVAL §1.2). It becomes *measurable* around Week 2–3 once keyed reconciliation is real, and measuring early is encouraged; a gate with no instrument is a wish, so it is not gated until there is one.
- [x] **Intent payload inside `each` rows.** SPEC §9 bans inline arrows in holes and says intents get a typed payload, not the raw `Event`, but doesn't say how a row button tells `intent.ship` *which* order. Blocks T04. Week 0 runtime passes form-derived payloads only (submit → form entries, input/change → value or `checked`, else `undefined`). Resolved in SPEC §9: a handler inside a row receives the innermost row's current item as a second argument.
- [x] **Row reactivity in `each`.** SPEC §9 says rows are not rebuilt when a cell changes, but a row receives a plain item. Week 0 runtime re-renders a row when its item object changes identity at the same key; fine-grained cells need a per-row accessor design before the 500-row benchmark. Resolved in SPEC §9: the row function runs once per key and receives an item accessor; cells are computeds in the row.
- [x] **`each` key.** Unspecified. Week 0 runtime keys objects by `id` (throws without one) and primitives by value. Resolved: `id` for objects, value for primitives, no key option.
- [x] **How transitions commit atomically.** SPEC §4 requires one transition = one commit, but no API marks a transition. Week 0 runtime exports `batch()` and runs every intent inside one. A `transition()` wrapper would also give L005 something to recognise and the owner flag (§5b rule 1) somewhere to live. Resolved in SPEC §4: plain exported functions; multi-write transitions wrap in `batch()`.
- [x] **"Runs from the filesystem".** Chrome refuses ES module scripts from `file://`, so the Week 1 gate needs either "any static server" wording or a `file://`-loadable build — the second breaks A4. Resolved: "any static file server" in SPEC §10c/§12, EVAL, TASKS.
- [ ] **Recognising a transition at run time.** With plain-function transitions (SPEC §4) nothing marks a function as a transition, so §5b rule 1 ("a transition from a dead owner does nothing") and the §13 `SHR-L005` dev assertion have no mechanism. Options: call-site provenance from the trace, or accept that late writes reach no watchers and drop the rule. Narrowed by `SHR-L010` (2026-09-17), not closed: the surface rule guarantees a write goes *through* a transition, never *when* it is called, so this and "Runtime enforcement of post-disposal no-ops" below are still the same open question.
- [ ] **Effects tests need a scope.** `onDispose()` requires an owner, and the only public way to open one is `render()`, so `examples/hello` borrows a scope from an empty mount to unit-test effects. SPEC §4 promises `*.effects.test.ts` as a normal thing to write. Decide: export `root()`, ship a `sheratan/testing` entry, or state that effects are tested through a mount.
- [ ] **Runtime enforcement of post-disposal no-ops.** Related: the effects layer currently checks `signal.aborted` by hand before committing a transition (SPEC §5b rule 1). If transitions become recognisable at run time, the runtime should do this.
- [ ] **Framework comparison benchmark.** EVAL §1.2 is the high-frequency differentiator, and the dashboard in `examples/hello` is now the workload. Build the same app in React, Vue and Svelte, measure frames dropped and values applied per second at matched update rates on one machine, and publish the method with the numbers (EVAL §2.5). Blocked on nothing; do it before the Week-1 "within 2× of Solid" gate is claimed either way. **Scope settled 2026-09-17, build still open:** three axes, not one. Size and capability is **done** for six stacks (`Docs/COMPARISON.md`). Performance keeps its four baselines — React, Vue, Svelte 5, Solid (EVAL §1.2). Agent authoring runs **React as the gating arm and Svelte 5 held-out and non-gating**, with Vue deliberately excluded — reasoning in EVAL §2.1, arms table in EVAL-TASKS §1.2.
- [x] **Bun and Deno in the test matrix.** Both run TypeScript natively, which removes the type-stripping step entirely (SPEC §10c), and both are plausible hosts for the runtime. Add them to CI alongside Node once the CLI exists, and include them in the comparison numbers. Resolved 2026-09-17: **Week 3, with the CLI, not before.** Today they would run `node:test` over the same source and prove nothing the Node job does not. The claim they actually test is `sheratan dev`/`build`'s "type stripping only" (SPEC §10c) — on a native-TypeScript host that step is a no-op, which is the interesting case.
- [x] **Devtools surface.** Dev-build-only additions that belong with the causal trace (SPEC §7), not before it: a Chrome custom formatter so a signal prints as its value rather than `ƒ read()`, a Performance-panel track for drains and frame flushes, and debug names from the trace's write provenance. Decide the shape when §7 is built. Resolved 2026-09-17, now that §7 is built: **all three are post-launch, none are MVP.** SPEC §12's definition of done does not ask for them, and the MVP surface is what shipped — `__sheratan.trace()` as JSON and `__sheratan.format()` as an indented tree, which the Week 2 gate already passed by eye. A browser-specific formatter is also the one piece that cannot be tested in happy-dom, so it would arrive with no coverage against a 100% gate.
- [x] **Public repository before v1.0.0.** Dependency review in CI switches itself on when the repository stops being private; the release checklist has to include making it public (or buying Advanced Security). Resolved 2026-09-17: on the Week 5 **Package** checklist, ordered *before* the npm publish — going public after publishing means the first release is the one nobody could review. Advanced Security is not bought; the repo goes public, which is the plan either way.
- [x] **Checker on TypeScript 7.** SPEC §8 builds `packages/check` on the TypeScript compiler API. TS 7 (native) exposes only an unstable IPC API (`typescript/unstable/*`), not the TS 5/6 JS API. Decide before Week 3: pin the checker to TS 6's API, target TS 7's API, or parse with a standalone parser. Resolved 2026-09-17 by **ADR 0005 — target `typescript/unstable/*`**, measured rather than argued: a probe implementing `SHR-L010` against `packages/eval` (772 files) found all 4 state surfaces, reported 0 violations clean and 1 at `notifications.state.ts:7:3` after one field was widened, in 56 ms to open the program plus 7 ms to walk it. TS 6 is rejected because it comes back only as a second TypeScript; a standalone parser is rejected because `SHR-L010` and `SHR-L007` need types, and without them the checker falls back to the naming conventions the Week 0 eval showed already carry `L001` and `L002` unaided.
- [ ] **One prod build cannot be right for both a small import and a whole app.** Measured (gzip, esbuild + minify, 2026-09-16), bundling the same scenario from the flattened `dist/prod/index.js` against the module-preserved `dist/dev`:

  | scenario | from `dist/prod` (flat) | from `dist/dev` (modules) |
  |---|---|---|
  | `signal` alone | 5492 B | **877 B** |
  | state only | 5642 B | **1419 B** |
  | widget | 5703 B | **5000 B** |
  | widget with lists | 5727 B | **6358 B** ✗ |
  | everything | 6600 B | **7241 B** ✗ |

  The flat bundle minifies across module boundaries, so it wins for a real app by about 10%; it cannot be shaken finely, so it loses by 6× for a small import. The crossover sits between "widget" and "widget with lists" — roughly, anything that renders pays the whole runtime either way. So the earlier reading ("something in the template modules is not shakeable") was wrong: nothing is broken, the two builds simply trade off, and today's `exports` map offers only the one that suits whole apps. Decide: ship a third module-preserved prod condition for consumers who import a subset, or accept it and keep one number for the whole runtime instead of five scenarios that mostly restate it.
- [ ] **How a module stylesheet is loaded is unspecified.** SPEC §9a says `global.css` is "linked from `index.html`" and that `ui` and `modules` "are filled by the scoped component and module sheets", but never says how those sheets arrive. `examples/hello` now links each one by hand (`<link href="/modules/dashboard/dashboard.css">`), which works with no build step and is honest, but it names every module twice — once where it is wired and once in the HTML — and a module added without its link fails silently. Options: CSS module scripts attached with `adoptedStyleSheets` (already an open Week 1 item), `sheratan build` collecting module sheets into one file, or `@import` from `global.css` and accepting the extra round trip. Decide before `sheratan create` writes the wrapper.
- [ ] **The example's page furniture is not the dashboard.** `dashboard.view.ts` also holds the lockup, the pitch and the "where to go next" guide, which are not functions of dashboard state. They pass the letter of SPEC §4 — stateless and used once, so they belong inside the module rather than in `ui/` — but they are a second feature sharing one view file. The fix is a second module composed with `mount()` (SPEC §9 "Composing modules"), which is not built. Do it when `mount()` lands; the example is also the only place `ui/` would get demonstrated.
- [ ] **May `lib/` import `lib/`?** SPEC §4's matrix says `lib/` imports *nothing*, and the checker enforces exactly that, so a utility that uses another utility is `SHR-L001`. `lib/` is "pure utilities, no app knowledge", and another pure utility has none, so the rule as written looks stricter than its reason. Every other folder row may import its own kind (`ui/` → `ui/`, `services/` → `services/`). Decide: allow `lib/` → `lib/`, or keep it and say why.
- [x] **Immutability rule code.** The checker rule for statically visible mutation of a signal's value (TASKS decision 2026-09-15) needs a code and a row in SPEC §4's table. Resolved 2026-09-17: **`SHR-L011`**, row added to SPEC §4 and to `llms.txt`; ADR 0002's layer 3 now names it instead of pointing back here. Next free code is `SHR-L012`.
- [x] **How many packages publish.** SPEC §11 lays out `packages/{core,check,cli}` and annotates only `core` as "published", but never says what happens to the other two — so "`packages/check`" reads equally as a folder and as `@sheratan/check` on npm. SPEC A4's corollary already answers it — **"one package in the user's `package.json`"** — and three tarballs break it in the way that matters: a project running `sheratan check` in CI would carry `sheratan` *and* a CLI that depends on a checker, which is two entries and a version matrix. Resolved 2026-09-17: **one published package, `sheratan`, with a `bin`.** `check` and `cli` stay workspace folders for the complexity bounds and their own test suites, and are folded into the one tarball at publish time. Two things that decision now owes Week 3: `typescript` becomes a peer dependency of `sheratan` itself, marked `peerDependenciesMeta.optional` so a runtime-only consumer is never nagged for a compiler it will not use; and `exports` must expose the checker on its own subpath and keep it out of `"."`, or a bundler following a stray import pulls the TypeScript compiler into an application bundle. Install size grows, bundle size does not — worth stating that way round in the README. ADR when the subpath layout is actually designed
- [x] **CSS scoping.** SPEC said `adoptedStyleSheets` on the component root, which is global on `document`. Resolved in SPEC §9a: native `@scope` + `@layer`, enforced by `SHR-L009`.

---

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-09-14 | Task tracker created from SPEC v0.1, PLAN, EVAL v0.1 | Single place to track progress against gates |
| 2026-09-14 | CSS scoping via native `@scope` + `@layer`, checked by `SHR-L009`; no hashes, no Shadow DOM (SPEC §9a) | Hashing needs a build step (breaks "type stripping only"); Shadow DOM breaks forms, focus and global base styles |
| 2026-09-14 | `resource()` keeps separate `status`/`data`/`error` signals; narrowing via `is()` type guard, no union accessor (SPEC §6) | Per-hole reactivity stays fine-grained; one way to read async state |
| 2026-09-14 | Eval task set v1 frozen: 7 parity / 5 differentiator, no router in either arm, T05 rate check kept as a declared advantage | Tasks written before any runtime can't flatter it; a single-page dashboard keeps the control stack unchanged |
| 2026-09-15 | Rule codes fixed (SPEC §4): one `SHR-L001` for all import-matrix cells; L003 layout, L004 effects-only APIs, L007 contract `AbortSignal`; template family `V001`–`V004`; `R` reserved for runtime; codes never reused | Self-repair JSON needs a stable code for all three violation classes; per-cell codes would add ~20 codes without adding information the message doesn't already carry |
| 2026-09-15 | Template holes take signals by reference: `${s.total}` is reactive, `${s.total()}` reads once (`SHR-V003`); expressions become named computeds (SPEC §9) | Tag arguments are evaluated before the tag runs, so `${s.total()}` cannot be reactive without a compiler; re-running the view per frame would break the 500-row claim; arrows in holes contradict `SHR-V001` |
| 2026-09-15 | `each` rows get one item accessor, run once per key; cells are computeds in the row (SPEC §9) | Rows are never rebuilt when a cell changes, without a proxy per row; the hole rule stays the same everywhere |
| 2026-09-15 | Handlers inside an `each` row receive the innermost row's current item as a second argument (SPEC §9) | A row's button can name its item without an inline arrow (`SHR-V001`) or a new directive |
| 2026-09-15 | Transitions are plain exported functions; multi-write ones use `batch()` (SPEC §4) | No new API. Cost, logged as a gap: nothing marks a transition at run time |
| 2026-09-15 | "No build" means any static file server, not `file://` (SPEC §10c, EVAL) | Browsers refuse ES module scripts from `file://`; a `file://` build would be a second way to load core |
| 2026-09-15 | Any module file may `import type` from `services/*.contract.ts`; `index.ts` row added to the matrix (SPEC §4) | Contracts are the shared domain vocabulary; type imports are erased; `lib/` types or per-module copies were worse |
| 2026-09-15 | Module wiring: `index.ts` exports `kind` and a factory returning a view function; state is a factory; view is `(state, intents)` (SPEC §4) | State and watchers are created inside `render()`'s owner and disposed with it; the view gets intents without importing effects |
| 2026-09-15 | Core source is strict TypeScript compiled to ESM + generated `.d.ts` before publish; the hand-written `index.d.ts` goes (SPEC §10c) | "No build" is a user-facing promise; hand-written declarations drift from the runtime |
| 2026-09-15 | TypeScript 7 (native compiler) for typecheck and build; TypeScript 6.0 kept only inside `tooling/eslint-config` | typescript-eslint's type-aware rules need the JS compiler API, which TS 7 does not expose; remove the TS 6 copy when typescript-eslint supports TS 7 |
| 2026-09-15 | pnpm replaces npm: dependency build scripts blocked, `minimumReleaseAge` 3 days, `trustPolicy: no-downgrade`, no exotic transitive sources | Supply chain: install scripts and freshly hijacked releases are the main npm attack vectors |
| 2026-09-15 | Quality gates in CI on every push/PR: lint (zero warnings), typecheck, build, `node:test` with coverage ≥ 100% lines/functions and 95% branches, `pnpm audit` + registry signatures, dependency review; actions pinned to commit SHAs | Rules in AGENTS.md hold only if a machine checks them |
| 2026-09-15 | Reactive core rebuilt on the alien-signals design (doubly-linked edges, flag bits, iterative propagation); own implementation, not the TC39 API shape and not a dependency | O(1) link/unlink with no per-run allocation; TC39 Signals is Stage 1; A4 forbids a runtime dependency |
| 2026-09-16 | `sheratan build` joins the CLI: type stripping into a deployable directory, no bundler; `dev` and `build` share one minimal server of our own rather than delegating to Vite | A TypeScript app had no documented way to reach production, and "no plugin pipeline" is hard to claim while requiring someone else's dev server |
| 2026-09-16 | `examples/hello`: the canonical module shape (SPEC §4) as a live dashboard — 500 rows, a synthetic 2000 values/second feed, re-sorted on every batch — with a test per layer and Playwright e2e against both builds | The claim is "one legal way to structure an app"; without an app in the repo nothing proved or enforced it, and a demo should show the differentiator (high-frequency data) on the first screen |
| 2026-09-16 | Layer boundaries enforced by lint (`no-restricted-imports` / `no-restricted-globals`, keyed by filename) until `SHR-L001` exists | The rules are the checker's, written early; a boundary nobody checks is a convention, and SPEC §3 A2 asks for early failure |
| 2026-09-16 | `SHR-R008`: an array in a hole is an error, not `[object Object]` | Found while writing the example's filter control. `each()` is the one way to render many (A1), so the other way must fail loudly |
| 2026-09-17 | `SHR-L010`: a `*.state.ts` public surface exposes only `Accessor` values and transitions; the `Signal` handles stay in the file (SPEC §4, §13). `SHR-L005` is kept as the best-effort backstop | Week 0 eval: the L005 violation could not be injected until the state interface was widened `Accessor` → `Signal`, and one repair removed the write while leaving the widening behind. L010 is one declaration per field instead of a dataflow check per call site, makes the write a type error (A2), and covers the view and `index.ts` too — no runtime change, no new API |
| 2026-09-17 | The checker targets `typescript/unstable/*`, not a second TypeScript and not a standalone parser (ADR 0005) | Measured, not argued: a probe implementing `SHR-L010` over 772 files found all 4 state surfaces and reported the injected one at `notifications.state.ts:7:3`, in 56 ms + 7 ms. TS 6 returns only as a second compiler — two versions of the truth about one codebase; a syntax-only parser cannot tell `Accessor<string>` from `Signal<string>`, which is most of the rule set |
| 2026-09-17 | `SHR-L011` assigned to statically visible mutation of a signal's value (SPEC §4, ADR 0002 layer 3) | The rule had been specified since 2026-09-15 with no code, so it could not be reported, documented or tested. Next free code is `SHR-L012` |
| 2026-09-17 | Agent-authoring eval gains Svelte 5 as a held-out, non-gating second control; React stays the gating arm; Vue stays out (EVAL §2.1) | React and Svelte answer different questions. React tests "do enforced boundaries beat a training-data advantage"; Svelte — runes, a compiler, one idiomatic shape — tests whether it is the *enforcement* at all or just fine-grained reactivity plus convention. A tie with Svelte is a finding needed before launch. Vue adds an Options/Composition confound and no new question. Cheap because EVAL-TASKS §1.1 keeps the hidden suites framework-neutral |
| 2026-09-17 | The 60fps gate is Week 4 in EVAL too, not Week 2–3; Week 2's gate is correctness and leaks | It is gated where its harness is (EVAL §1.2). Measurable earlier, and measuring early is encouraged — but a gate with no instrument is a wish |
| 2026-09-17 | `sheratan.dev` stays on GitHub Pages (`site/CNAME`), rather than moving to Cloudflare or Netlify | The site is one static page plus the Week 4 error index: no auth, no input, nothing to protect with the HTTP headers Pages cannot set, so the `<meta>` CSP is enough. Netlify and Vercel were rejected on a specific risk, not taste — their free tiers cap bandwidth, and `sheratan.dev/errors/<code>` is compiled into other people's production bundles, so traffic we don't control must never be able to throttle or suspend the host |
| 2026-09-17 | Repository made public ahead of the Week 5 checklist | GitHub Pages is free only for public repositories, and the site had to be served from somewhere. Brought forward two benefits with it: dependency review in CI switches itself on, and the eval results become checkable by a stranger, which is what `Docs/EVAL-RESULTS.md` claims for itself |
| 2026-09-17 | Releases publish from CI via npm trusted publishing (OIDC), never a stored token; `release.yml` + an `npm` environment gate; provenance is automatic — **the environment half was reversed the same day; see the "No GitHub environment on the release workflow" row below** | pnpm 12.4.1 does the OIDC exchange natively — its binary carries `ACTIONS_ID_TOKEN_REQUEST_URL`, npm's `/-/npm/v1/oidc/token/exchange/package/` endpoint and the sigstore attestation machinery — so AGENTS.md's "never npm or yarn" does not have to bend. A long-lived `NPM_TOKEN` in repo secrets is the single most attacked artifact in the npm ecosystem |
| 2026-09-17 | Devtools (Chrome formatter, Performance track, debug names) are post-launch, not MVP | SPEC §12's DoD does not ask for them, `__sheratan.trace()`/`format()` is the shipped surface, and a browser-only formatter cannot be covered in happy-dom against a 100% gate |
| 2026-09-16 | Effects skip their transition when the mount is already disposed | SPEC §5b rule 1 asks for post-disposal no-ops and the runtime cannot see a late response yet; the example shows the pattern, and a test pins it |
| 2026-09-16 | `pnpm audit signatures` moved out of the PR gate to the daily run (ADR 0001); advisories still block every PR | Signature verification needs a packument per lockfile entry, including platforms we never install, and fails a few per run for reasons unrelated to the change |
| 2026-09-16 | Editor support is workspace recommendations (lit-html for `html` templates, oxc for lint and format), not an extension of our own | A Sheratan extension is worth writing when the checker can feed it real diagnostics (Week 3); before that it would only re-highlight what lit-html already does |
| 2026-09-16 | Oxlint (type-aware, on TS 7 via tsgolint) + oxfmt replace ESLint, typescript-eslint and the second TypeScript; `@stylistic` and `eslint-plugin-jsdoc` load as JS plugins | One toolchain, one compiler; a full type-aware lint of the repo runs in about half a second |
| 2026-09-16 | Two builds behind export conditions: `dist/dev` (tsc, source + declaration maps) and `dist/prod` (esbuild, minified, message table dropped so errors carry a code and a docs URL) | Message text is the biggest byte cost in a small runtime, and A3 only requires the code |
| 2026-09-16 | Windowed `each` is positional: a recycled pool of rows plus spacers, with `{ start, count, rowHeight }` supplied by the caller (ADR 0003) | Keeping rows keyed while windowing still creates and destroys nodes on scroll, which is the cost virtualization exists to avoid; and `each` cannot measure — its first reconcile runs inside a detached fragment, and the test host has no layout |
| 2026-09-16 | Windowed `each` costs 485 B brotli (4829 → 5314, +10%) and the budget was re-recorded rather than the feature trimmed | SPEC §12's DoD requires a virtualized 500-row table; folding the pool into `EachList` to share scaffolding would save roughly 100 B and cost the one-thing-per-class rule |
| 2026-09-16 | `dist/prod/package.json` restates `sideEffects: false` | A bundler reads the package.json nearest the file it is shaking, so the root's promise never reached the shipped code |
| 2026-09-16 | Size budget in CI (`size-budget.json`, brotli, per scenario; 4.8 KB for the whole runtime today) | "Small" has to be measured on every commit or it stops being true |
| 2026-09-16 | Internal field name mangling deliberately not done | It would cost the readability the code rules ask for; revisit only if the size budget comes under pressure, and with a measurement |
| 2026-09-16 | `llms.txt`'s API table is generated from TSDoc and checked in CI | The agent-facing docs cannot drift from the declarations the package ships |
| 2026-09-16 | A windowed `each` gives custom-element rows a plain `<div>` spacer instead of copying their tag | `document.createElement('sl-card')` upgrades it, so the two spacers became live components with their own shadow DOM and visible chrome. A spacer has to be layout and nothing else |
| 2026-09-16 | `examples/hello`'s module styles move out of `global.css` into `modules/dashboard/dashboard.css`, with the `to ([data-module], [data-ui])` boundary SPEC §9a requires | `global.css` may hold only `tokens` and `base` (`SHR-L009`); the reference app was breaking the rule it exists to demonstrate, and the checker would have rejected it in Week 3 |
| 2026-09-16 | The causal trace lives in a module the production build swaps for no-ops, not behind a `DEV` branch alone (SPEC §7) | esbuild folds the branch but keeps the module: the first attempt shipped the whole trace, `__sheratan` included, about 2 KB of unreachable code. The build now fails if the bundle still contains it |
| 2026-09-16 | Previous values are kept as a short rendering, so SPEC §7's per-signal opt-in is dropped | The ring buffer already bounds retention to 500 entries, and storing text rather than the value retains nothing at all — the opt-in guarded a cost that no longer exists |
| 2026-09-16 | `DEV` is typed `boolean` rather than a literal in both env modules | A type-aware linter reads `const DEV = true` as always truthy and rejects every `if (DEV)` guard; the type should say what is true of both builds |
| 2026-09-16 | An intent's payload is read from the element the handler is on, not chosen by the event's name (SPEC §9 Intents) | A component library announces changes under its own name (`sl-change`, `md-input`), and a table of event types silently handed every one of them `undefined`. One rule instead of a list that is always incomplete; the cost is that a plain `<button>` now reports `""` rather than `undefined` |
| 2026-09-16 | Platform APIs instead of code where they exist: `Element.moveBefore` for row moves (falls back to `insertBefore`), `Symbol.dispose` on every disposer (`using stop = watch(…)`) | A moved row keeps focus, selection and media state; `using` removes a class of forgotten teardown |
| 2026-09-16 | `resource()` holds its own value: no cache shared between resources, and data shared between modules goes through a state module (ADR 0004) | A cache is a second place state lives, which A1 does not allow, and it is the part of a query library an app can least often use unchanged |
| 2026-09-16 | `staleAfter` revalidates on a timer owned by the mount (ADR 0004); SPEC §6 amended, which named the option without saying what triggers it | Core has no remount or window-focus trigger to hang freshness on, and a read that starts a request would fire inside `flush()` |
| 2026-09-16 | `Error` added to `DeepReadonly`'s opaque list | It matches what `freeze()` already declines to freeze: an `Error` mapped member by member stops being an `Error`, which broke `resource.error()` |
| 2026-09-16 | `resource()` costs 766 B brotli (5306 → 6072 for the `everything` scenario, +14%) and the budget was re-recorded | SPEC §6 calls it the single most important differentiator, and the whole runtime is still 6.1 KB |
| 2026-09-16 | Tracker audited against the code: Week 1's `[must]` items and Week 2's ownership block were built but never ticked, and the status table still read "Not started" for both | A tracker that understates the work is as useless as one that overstates it — the next decision is which week to work on, and it was being made from wrong numbers |
| 2026-09-15 | Immutability enforced, not requested: `DeepReadonly` reads in types, incremental deep freeze of plain objects/arrays on `set()`, checker rule for visible mutation (SPEC §5) | A rule an agent must remember is a rule an agent breaks; freezing only new nodes keeps the cost at what the caller already allocated |
| 2026-09-17 | Site fonts self-hosted from `site/fonts/` (Archivo variable + IBM Plex Mono, SIL OFL 1.1, latin and latin-ext as Google subsets them); the Google Fonts stylesheet and both `preconnect`s are gone | It was the only render-blocking request on the page — 418 ms, and the only thing between Lighthouse desktop and 100. It also removes the one third-party origin, so no visitor's address reaches Google and the CSP drops to `'self'` |
| 2026-09-17 | Site CSP gained `connect-src 'self'`; `robots.txt` and `sitemap.xml` added | `default-src 'none'` blocked Lighthouse's own fetch of `/robots.txt` — the audit failed with "CSP violation", not a missing file, which cost SEO 9 points and would have blocked any same-origin fetch the site later wants |
| 2026-09-17 | Open Graph and Twitter card metadata added, with `site/og.png` rendered from the page's own tokens | With no summary to find, link unfurlers quoted the first text in the document — visitors were being sent a preview of the stylesheet |
| 2026-09-17 | Landing page is light only: the `prefers-color-scheme` block and the `[data-theme]` overrides are gone from `site/index.html`, `color-scheme` is `light`. The identity keeps both palettes and `examples/hello` still follows the system setting | The page is one printed page, and the `og:image`, the favicon and the wordmark are all drawn on the light ground — a dark variant made the shared preview disagree with the page it links to. A decision about this page, not about the brand |
| 2026-09-17 | One published package — `sheratan`, with a `bin`. `packages/check` and `packages/cli` are folders that fold into that tarball, not `@sheratan/*` on npm | SPEC A4's corollary already promised "one package in the user's `package.json`", and SPEC §11's layout was being read as three products. Three tarballs put `sheratan` + a CLI + a checker in a CI project's manifest and create a version matrix between them, for no gain the folders do not already give. Cost, and it is real: `typescript` becomes an optional peer of `sheratan` itself, and the checker needs its own export subpath so nothing can pull a compiler into an app bundle |
| 2026-09-17 | `examples/dashboard` will be generated by `sheratan create` and install `sheratan` from the registry; `examples/hello` keeps `workspace:*` | A scaffolder nobody runs on a real app is a scaffolder that rots, and a reference app linked by `workspace:*` never exercises the `exports` map, so the published prod build is the one artifact no example loads. The two examples answer different questions: `hello` breaks when core breaks, `dashboard` breaks when the *package* breaks |
| 2026-09-17 | Tracker audited against the code a second time: npm reservation and the monorepo skeleton were done but unticked, Week 5 still read "Not started", the Week 0 runtime snapshot understated the code by 50%, two leak-test citations had drifted, and the site — live, and the most visible artifact so far — had no task line anywhere, only decisions-log rows | Same reason as the 2026-09-16 audit: the next decision is which week to work on. Two of the stale rows contradicted a decision recorded lower down in this same file, which is worse than being out of date — a reader hits the wrong one first. Line-number citations are now paired with the test name, since numbers drifted within a day |
| 2026-09-17 | No GitHub environment on the release workflow; npm's trusted-publisher environment field stays blank. `release.yml` gained a "tag is on `main`" guard instead | The environment's only value was a required-reviewer prompt, and the same person pushes the tag and clicks approve — a second click, not a second pair of eyes. The guard catches the failure the approval was actually standing in for: a tag on the wrong commit |
| 2026-09-19 | `mutation()` semantics fixed (SPEC §6): optimistic at `run()`, one request at a time per key, rollback on failure *and* cancellation, no rollback when `onSuccess` throws, `status()`/`error()` describe the last run to settle, `run()` resolves and never rejects, unmount drops the queue and calls nothing | SPEC gave the shape but not the order, and the order is what an app gets wrong by hand. Cancellation rolls back because the write did not happen, but is not an error (§5b rule 3). A throwing `onSuccess` does not roll back because the server already has the write — undoing the screen would make it lie |
| 2026-09-19 | `mutation()` costs 412 B brotli (6548 → 6960 for `everything`, +6%; 83 B of it is keyed lanes) and the budget was re-recorded | SPEC §6 calls it the write half of `resource()`, and the reference app has forms. `Docs/COMPARISON.md`'s 6.9 kB is unchanged, because it matches `resource` against `useQuery` alone and neither side imports a mutation |
| 2026-09-19 | `mutation()`'s I/O hook is `send`, not `run`; `optimistic`, `rollback` and `onSuccess` are documented passed by reference; concurrency is per `key` (`string \| number`) instead of a parallel flag | `run` named both the option and the method with different signatures. By-reference matches `SHR-V001`'s rule for intents, and works because transitions are plain functions (SPEC §4). A per-key queue is the only safe reading of "parallel": two records at once, never two writes to one record racing — which is what T04 asks for |
| 2026-09-19 | An error's docs URL is the whole code — `sheratan.dev/errors/SHR-L001` — not the code without its prefix (SPEC §4, §8) | SPEC named the prefix-less form, but the runtime has shipped `DOCS_BASE_URL + code` since the prod build existed, so every bundle already contains the full form, and the URL cannot change once it is in other people's code. The full code also needs no translation: the URL segment is the string the error prints. `packages/eval` still generates the prefix-less form and is deliberately left alone — Week 5 re-runs that eval unchanged |
| 2026-09-19 | Week 2's gate is passed on one combined test, not on the per-primitive leak tests | Four of the six ran 200 cycles, not the 1000 the gate names, and none mounted the primitives together — a leak that needs two of them sharing an owner would pass every one. A subscription count also cannot see an unaborted request or a live timer, so the gate test checks those directly, and was broken three ways to prove it fails |
| 2026-09-19 | Any module file may `import type` from another module's `index.ts` (SPEC §4) | Found by running the checker over the Week 0 host app: three `index.ts` files type their `notifications` parameter that way, and the matrix as written had no legal alternative, though SPEC's own wiring example passes modules in as parameters. It is the contract exception's twin — something public, erased at run time. Value imports and deep imports are unchanged |
| 2026-09-19 | The checker leaves test files, files outside the layout and package imports alone; a file in a module folder that is none of its four reads like the view (SPEC §4) | SPEC's table has no row for any of them, and each needed an answer before the matrix could be a table. A test reaches into what it tests; a package is not a layer |
| 2026-09-19 | The checker checks both apps in this repo on every run, and both must stay clean | A false positive on the reference app is a bug in the checker or in the spec, and both have happened once already — see the `index.ts` row above |
