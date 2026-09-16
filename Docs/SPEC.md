# SHERATAN — Technical Specification (draft v0.1)

> Name: β Arietis — Arabic aš-šaraṭān, "the two signs"; with Mesarthim it
> marked the vernal equinox, the reference point of the year. Free on npm as of
> 2026-09-14. Still to verify: the GitHub org handle and `sheratan.dev`, which
> goes into checker error links and cannot be changed later.
> Error codes use the `SHR-` prefix.
> This document is the source of truth for implementation. If code and spec
> disagree, the spec wins or the spec gets amended — never silently diverge.

---

## 1. One-sentence positioning

A frontend framework with **one legal way to structure an app**, enforced by a
checker with machine-readable fixes, plus async and live data in the core.

Precise version of the enforcement claim, because the loose one is an
overclaim: **the import matrix is enforced statically**; `SHR-L005` falls back
to a dev-time runtime assertion (§13). Never write "all architectural
violations are compile errors."

Why this needs a framework rather than an ESLint plugin: React's problem for a
code-generating agent is not a missing linter, it is that there are too many
legal ways to do the same thing. `eslint-plugin-boundaries` does not delete the
choice between Zustand, Context, Redux and Query. A1 is the only argument that
requires new runtime, and everything in this spec is subordinate to it. If a
feature introduces a second way to do something, it is cut.

### Prior art, stated plainly

- **Elm / TEA** is the ancestor of "architecture enforced by the compiler".
  Sheratan is TEA with files and signals instead of a single `update`.
- **Solid** already has signals, `createResource` and fine-grained DOM.
- **Lit** already has no-build tagged templates at ~5 KB, backed by Google.
- **eslint-plugin-boundaries, Sheriff, dependency-cruiser, Nx** already enforce
  import matrices on existing stacks.
- **TC39 Signals** will commoditize the reactive core. Do not bet the brand on
  our signal implementation.

The defensible sentence is therefore not "we have signals and boundaries" but:
**the runtime was designed so that the import matrix is sufficient** — one
state model, one async model, one place for I/O, so a boundary rule actually
determines the shape of the code instead of decorating it.

### Target niche

Authenticated, high-frequency, app-shaped UIs: ops consoles, trading screens,
internal tools, admin panels. This justifies no SSR, `stream()` in core, frame
coalescing, and "we are not Next".

## 2. Why this exists

Four gaps that React, Vue, Svelte and Angular all leave open:

1. **Async state is not in the core.** Every app re-implements loading, error,
   race-cancellation, staleness and retry through a third-party library.
2. **Causality is not observable.** "Why did this re-render / why did this
   effect fire" requires a browser extension and guesswork.
3. **Layer separation is a convention, not a constraint.** Angular organizes;
   it does not enforce. Nothing stops I/O inside a component.
4. **A build step is mandatory.** Hundreds of MB of tooling before hello world.

## 3. Design axioms

These are non-negotiable. Every design decision is checked against them.

- **A1 — One way to do each thing.** Where two idioms exist, a code-generating
  agent picks randomly and the codebase diverges. Ambiguity is a bug.
- **A2 — Violations fail loudly and early.** Preferably at check time, never
  silently at runtime.
- **A3 — Errors are machine-readable first, human-readable second.** Every
  error carries a stable code, a location, and a suggested fix.
- **A4 — Zero runtime dependencies, no required build.** `core` ships with an
  empty dependency tree — nothing transitive, nothing to audit. Dev tooling
  (checker, CLI) may have devDependencies; the runtime may not.
  Corollary, stated separately because it is the stronger claim: **one package
  in the user's `package.json`.** Async state, layer enforcement and debugging
  are in the core, so there is no router/query/forms/state stack to assemble.
  Never write "zero dependencies" unqualified — the checker depends on the
  TypeScript compiler API, and the imprecision will be caught on day one.
  Same honesty applies to "one package": `typescript` is a **peer** dependency
  of the checker, so a TS project has it already and a JS project installs it
  for `check` only. Say that in the README rather than letting someone find it.
- **A5 — Nothing in the public API requires more than one screen to explain.**
  The whole API surface must fit in an LLM context window with room to spare.

Explicit non-goals: React compatibility, a CSS-in-JS solution, an opinionated
router shipped in v0, a component library, IE/legacy support.

## 4. The module contract

The unit of code is a **module** — a directory whose file set is fixed by its
declared kind. Two kinds only; a variable file set would reintroduce a choice
A1 forbids, and a mandatory four produces hollow files an agent writes just to
satisfy the checker.

| Kind | Files | For |
|---|---|---|
| `view` | `<name>.view.ts`, `index.ts` | presentational modules with no state of their own |
| `full` | `<name>.state.ts`, `<name>.effects.ts`, `<name>.view.ts`, `index.ts` | everything else |

The kind is declared in `index.ts` and checked. A `full` module with an empty
`effects.ts` is a `view` module that has not been declared honestly.

Either kind may add one `<name>.css`. It is optional, does not change the kind,
and must follow the scoping rule in §9a (`SHR-L009`).

A `full` module:

```
modules/<name>/
  <name>.state.ts     signals + pure transitions. No I/O. No DOM.
  <name>.effects.ts   everything impure: fetch, storage, timers, browser APIs.
  <name>.view.ts      pure function (state) => template. No I/O. No imports of effects.
  index.ts            the module's only public surface.
```

### Project layout

```
modules/<name>/     feature modules (four files, above)
ui/<component>/     stateless reusable components
lib/                pure utilities, no app knowledge
services/           I/O adapters behind contracts
styles/global.css   tokens and base layers only (§9a)
app.ts              composition root
e2e/                end-to-end tests
```

`shared/` is a banned directory name (`SHR-L003`). It groups by ownership ("used in more
than one place") rather than by purpose, and becomes a second application
without rules. Everything that would go there belongs to one of the categories
above.

- **Shared state is an ordinary module.** Current user, feature flags, theme →
  `modules/session/` with the same four files. Shared state is the most
  dangerous code in an app and must live under the same rules, not beside them.
- **`ui/` components are folders, not files:** `ui/button/button.view.ts`,
  `button.css`, `button.test.ts`, `index.ts`. They have no state and no
  effects, so they are not modules. Nesting inside `ui/` is at most one level —
  the component itself (`SHR-L003`). Namespacing is by prefix (`ui/form-input/`,
  `ui/data-table/`), never by subdirectory.
- A component used by exactly one module lives **inside that module**, not in
  `ui/`. Most "hundreds of components" are local things parked in a shared
  folder just in case.
- **Module or `ui/`?** The test is capability, not size or complexity: has
  state or I/O → module; has neither → `ui/`. A data table with sorting,
  pagination and fetching is a module. A button, an input, a modal shell are
  `ui/`. This question is safe to put to an agent; "is this component complex?"
  is not.
- **There are no shared effects.** Repeated logic across two modules is either
  a service (I/O) or a pure function (`lib/`). No third option.

### Enforced rules (checker, section 8)

The import matrix is the rule set. One table an agent can hold in context,
rather than a numbered list.

| From | May import |
|------|-----------|
| `lib/` | nothing |
| `ui/` | `lib/`, `ui/` |
| `services/` | `lib/`, `services/` |
| `*.state.ts` | `lib/`, own module |
| `*.effects.ts` | `lib/`, `services/` contracts, own state, other modules' `index.ts` |
| `*.view.ts` | `lib/`, `ui/`, own state, module instances received as parameters |
| `index.ts` | own module files |
| `app.ts` | everything (composition root) |

Plus one exception for every module file: **`import type` from
`services/*.contract.ts`** is always allowed. Contracts are the app's shared
vocabulary (`Customer`, `Order`), type imports are erased at run time, and the
alternatives — domain types in `lib/`, or a copy per module — either give `lib/`
app knowledge or duplicate shapes that drift. A value import from `services/`
is still `SHR-L001`.

Every cell of this matrix reports as **one code, `SHR-L001`**. The message names
the cell and states the allowed set rather than citing a rule number: *"view
cannot import services; allowed: lib, ui, own state."* For self-repair this
beats a link to a rule. A deep import — reaching past another module's
`index.ts` into its state, effects or view — is an `SHR-L001` cell like any
other.

Constraints the matrix cannot express:

| Code | Rule |
|------|------|
| `SHR-L002` | `*.view.ts` must not call an I/O global (`fetch`, `localStorage`, `document`, timers) |
| `SHR-L003` | Project layout: no `shared/` directory; `ui/` nests at most one level (below) |
| `SHR-L004` | Effects-only APIs — `resource()`, `mutation()`, `stream()`, `onDispose()`, `navigate()` — are called only inside `*.effects.ts` |
| `SHR-L005` | `*.effects.ts` must not mutate state directly; it may only invoke transitions exported by `*.state.ts` |
| `SHR-L006` | Module file set matches its declared kind (below) |
| `SHR-L007` | Every `Promise`-returning method in a `*.contract.ts` takes an `AbortSignal` (§5b) |
| `SHR-L008` | The module import graph must be acyclic |
| `SHR-L009` | Module and `ui/` stylesheets are wrapped in one `@scope` with a lower boundary; `global.css` holds only `tokens` and `base` (§9a) |

Template rules, checked off the AST of `html` literals (§9, §13):

| Code | Severity | Rule |
|------|----------|------|
| `SHR-V001` | error | No inline function in a template hole; handlers are named intents |
| `SHR-V002` | warning | `unsafeHTML()` with a non-literal argument |
| `SHR-V003` | warning | Reactivity trap: a signal or computed *called* inside a template hole (`${s.total()}`) instead of passed (`${s.total}`) (§9) |
| `SHR-V004` | error | Malformed template: unclosed tag, unknown attribute or binding |

| Code | Severity | Rule |
|------|----------|------|
| `SHR-T001` | warning | Module has no `*.state.test.ts` / `*.effects.test.ts` |

**Code scheme.** The letter is the family: `L` structure and layers, `V` view
templates, `T` tests; `R` is reserved for structured runtime errors. Numbers
are stable — never renumbered, never reused; a retired code stays reserved.
A violation caught at run time by a dev-build assertion reports under the same
code as its static check (`SHR-L005`, §13). The docs URL is the code without
the prefix: `sheratan.dev/errors/L001`.

`SHR-L008` exists because of shared modules specifically: without it,
`session` and `orders` will import each other within a week.

Data flows in exactly one direction: `effects → state → view`. Views emit
intents; they never act.

### Wiring a module

```ts
// index.ts
export const kind = 'full';                      // or 'view' (SHR-L006)
export const createCustomers = (api: Api) => () => {
  const state = createCustomersState();          // signals, computeds, transitions
  const effects = createCustomersEffects(api, state);
  effects.load();
  return customersView(state, effects);          // (state, intents) => html
};

// app.ts
render(createCustomers(createHttpApi('/api')), document.getElementById('app')!);
```

- `index.ts` exports the kind and **a factory returning a view function**.
  `render()` calls that function inside its owner, so state, watchers and
  `onDispose` created there belong to the mount and die with it.
- State is a factory (`create<Name>State()`), so every mount and every test
  starts fresh.
- The view is `(state, intents) => html`. It declares the intents it needs as a
  `<Name>Intents` interface; the effects object satisfies it structurally, so
  the view never imports effects.

### Atomic transitions

An effect that gathers several inputs assembles one payload and invokes **one**
transition. Two sequential transitions create an observable intermediate state
where the first response is applied and the second is not, and the view will
render it.

```ts
// effects
const [orders, customers] = await Promise.all([...]);
state.ordersLoaded({ orders, customers });   // one transition, one commit
```

Arbitrary interdependent logic inside the transition is fine — it is a pure
function. Complexity belongs in transitions; orchestration belongs in effects.

A transition is a plain function exported by `*.state.ts`; there is no
`transition()` wrapper. One that writes more than one signal wraps its writes in
`batch()`, so watchers see the commit, never the steps:

```ts
// orders.state.ts
export const ordersLoaded = ({ orders, customers }) => batch(() => {
  ordersById.set(orders);
  customersById.set(customers);
});
```

Intent handlers already run inside a batch (§9), so a transition called from
one commits once either way.

### State holds only what cannot be derived

Joins, formatting, derived flags and view-shaped projections are `computed`,
never stored. Storing derived data creates a second source of truth and the
desynchronization that follows. If it can be computed, it is not state.

### Tests

Tests are not a fifth mandatory file — a mandatory test file produces an empty
test file. `sheratan generate module` scaffolds `<name>.state.test.ts` and
`<name>.effects.test.ts`, and `SHR-T001` reports their absence as a warning.

The architecture is what makes this cheap: `*.state.ts` is a pure function and
needs no mocks; `*.view.ts` is a snapshot of state; `*.effects.ts` is the only
place a fake transport is needed, because it is the only place I/O can exist.

E2E lives at `e2e/` at the app level, never inside a module. Sheratan ships no
test runner (a dependency, and not our problem) but provides two things:
single-point transport substitution (pass a different adapter to the effects
factory), and the causal trace
attached to failed-test artifacts.

## 4b. Services, contracts and wiring

"Everything impure goes in effects" conflates three different things:

1. **Pure domain logic** — validation, calculation, rules. Not an effect. Lives
   in `*.state.ts` as transitions, or in a dedicated domain module.
2. **Orchestration** — "on submit: validate, call two endpoints, roll back on
   failure". Sequencing in time. This is what `*.effects.ts` is for.
3. **I/O adapters** — HTTP client, storage, sockets. These are *services*,
   shared across modules, and live at the app level.

```
services/
  api.contract.ts    the interface modules depend on
  api.http.ts        the adapter — URLs, headers, parsing, transport retries
app.ts               the only place a contract meets an adapter
```

Smell test: a `fetch`, URL or header inside `*.effects.ts` is a leaked adapter.
A business-meaning `if` inside `*.effects.ts` is leaked state logic. An effect
should read as a sequence of steps, not as logic.

### Wiring: factories, not a container

No DI container, no tokens, no `inject()`. An implicit global registry has the
same failure mode as React's rules-of-hooks: a call that works only inside a
particular execution window and breaks obscurely outside it. Dependencies
arrive as parameters:

```ts
// todo.effects.ts
export const createTodoEffects = (api: Api, state: TodoState) => ({
  load: async () => { ... },
});

// app.ts
const api = createHttpApi(baseUrl);
const todo = createTodoEffects(api, todoState);
```

Zero runtime machinery, plain TypeScript, substitution in tests is passing a
different object, and go-to-definition lands on the implementation rather than
a token. For an agent, dependencies are visible in the signature instead of
inferred from a graph. Prop drilling does not arise: `app.ts` constructs the
effects and effects are already the bottom layer — views receive no
dependencies at all.

Inversion of dependencies remains (a module depends on the contract, not the
adapter). Only the container is gone.

**Per-subtree composition.** `app.ts` as the single root becomes a wall on a
large tree, and nested factories alone do not solve "a child needs a service
the parent should not see". A parent module may therefore expose its own
`compose()` that constructs its children with a narrowed set of services.
Composition stays explicit and readable top-down; what is avoided is a
container, not nesting.

### Cross-cutting values

Logger and clock are not a data-passing problem — they are two objects that do
not change over the life of the app. Use a module singleton in `lib/`:

```ts
// lib/clock.ts
export let now = () => Date.now();
export const setClock = (fn) => { now = fn; };   // tests only
```

A singleton is allowed for anything with no state and no per-app
configuration. The moment a dependency gains a `baseUrl` or any option, it is a
service and goes through a parameter.

### No event bus

An `EventTarget`-based bus is the implicit global registry again, worse: string
names, no type checking, no guarantee anyone is listening, and it breaks the
causal trace, which works precisely because the cause is known.

Modules that must react to each other without direct coupling use signals:
`session.expired` is a `computed` in the `session` module, and other modules
`watch` it from their effects. Explicit direction, typed, traceable, no new
mechanism. `EventTarget` appears only inside an adapter, as a boundary to the
outside world (WebSocket, `BroadcastChannel`).

## 5. Reactive core

Fine-grained signals. No virtual DOM. No dependency arrays.

```ts
const count = signal(0);           // read: count(), write: count.set(n)
const doubled = computed(() => count() * 2);
const stop = watch(() => log(count()));  // auto-tracked, returns disposer
```

Glitch-free propagation: a computed never observes a partially-applied update.
Disposal is ownership-scoped — a module tears down its own watchers.

### Scheduler and frame coalescing

Propagation through computeds is synchronous and batched. DOM writes are not:
they are coalesced to the next animation frame, last value wins. A signal
written a thousand times in a second produces at most sixty DOM writes, because
the screen cannot show more. This is in the scheduler from day one, not bolted
on later — high-frequency data is a first-class case, not an edge case.

`flush()` forces a synchronous write for tests and for measurement code that
must read layout immediately after a write.

### Immutability

State values are immutable — not for purity, for three concrete reasons:
reference comparison is cheap, the causal trace can hold the previous value
(without it the trace says "something changed" instead of "X became Y"), and a
code-generating agent cannot accidentally mutate a nested object, which it does
routinely. Cost is verbosity on deep updates; addressed with a structural
update helper in `core`, not with an Immer-style dependency.

Immutability is enforced, not requested, in three layers:

1. **Types.** Reading a signal or computed yields `DeepReadonly<T>`, so
   `items().push(x)` or `order().status = 'shipped'` fails type-checking.
2. **Run time.** `signal.set(value)` deep-freezes plain objects and arrays.
   Subtrees that are already frozen are skipped, so with structural sharing
   only the newly allocated nodes are frozen — the cost is bounded by what the
   caller already allocated, and it stays on in production. A mutation then
   throws a `TypeError` (ES modules are strict). DOM nodes, `Date`, `Map`,
   `Set` and class instances are left alone: freezing them breaks them.
3. **Check time.** Mutation visible on the AST (a mutating method or an
   assignment through a signal read) is a checker error with a `fix` (code to
   be assigned, see TASKS "Spec gaps").

### Declared transitions (no `machine()` primitive)

Where state is a finite automaton, the legal moves are declared next to the
transitions and asserted in dev builds:

```ts
export const transitions = declare({
  draft: ['submitting'], submitting: ['submitted', 'failed'], failed: ['submitting'],
});
```

This is an assertion, not a statechart library. It deliberately does not get a
noun like `machine()`: naming it invites an XState comparison it would lose,
and a second modelling vocabulary is a second way to do things.

## 5b. Ownership and lifecycle

Everything has an owner, and everything created inside an owner dies with it.
Nothing is unsubscribed by hand. The owner is a mounted module.

Disposed automatically when a module unmounts:

- **Template watchers** — the per-hole subscriptions; nodes are removed after.
- **`resource()`** — its `AbortController` fires, so the request is cancelled at
  the network level, not merely ignored.
- **`stream()`** — the teardown returned from `subscribe` is invoked. This is
  why `subscribe` must return one.
- **Watchers in effects**, including those observing other modules
  (`session.expired`). Cross-module coupling through signals disposes itself —
  unlike an event bus, where unsubscription is always forgotten.
- **Children created with `mount()`**, recursively.

### `onDispose()`

External subscriptions the runtime cannot see — `addEventListener` on `window`,
`setInterval`, `ResizeObserver` — are the one place teardown is written by hand:

```ts
onDispose(() => window.removeEventListener('resize', onResize));
```

Legal in `*.effects.ts` only (`SHR-L004`).

### Three rules that prevent leaks

1. **Post-disposal async is a no-op.** A response arriving after unmount must
   not throw and must not write to a discarded state. Watchers and template
   holes of a disposed owner are unlinked, so a late write reaches nothing and
   renders nothing. Making the write itself a no-op needs a way to recognise a
   transition, which plain-function transitions (§4) do not give — open, see
   TASKS "Spec gaps".
2. **Disposal order:** stop watchers → tear down subscriptions → remove nodes.
   Any other order lets a final stream message write into detached DOM.
3. **Cancellation is not failure.** `AbortError` must not become
   `resource.error()`. Otherwise the user sees "failed to load" on every page
   change — the most common bug in this class of code.

### Cancellable I/O is a contract requirement

Every `Promise`-returning method in a `*.contract.ts` takes an `AbortSignal`.
An adapter that ignores it makes cancellation cosmetic: the response is
discarded but the request still runs. Checked: a contract method returning a
promise without a `signal` parameter is an error (`SHR-L007`).

Cancellation triggers: key change, owner disposal, explicit `resource.abort()`.

## 6. `resource()` — async in the core

The single most important differentiator. One primitive covers what
React Query / RxJS wrappers do today.

```ts
const user = resource({
  key: () => ['user', userId()],     // reactive; changing it refetches
  fetch: async ({ signal, key }) => api.getUser(key[1], { signal }),
  staleAfter: 30_000,
  retry: { attempts: 3, backoff: 'exponential' },
});

user.status();   // 'idle' | 'loading' | 'ready' | 'error' | 'refreshing'
user.data();     // T | undefined  — previous value retained while refreshing
user.error();    // Error | undefined
user.invalidate();
user.abort();
```

`'idle'` means nothing in flight and nothing to show, which only `abort()`
produces: a resource fetches as soon as it is constructed, so it is never idle
on the way in.

**A key change is a different question.** `data()` and `error()` are cleared
and the status goes to `'loading'`, because the value that is there answers the
old key. A *failure* is the other way round: `data()` is kept, so a stale value
beside an error beats an empty screen.

`staleAfter` is milliseconds of freshness. When it elapses the resource
revalidates itself — `'refreshing'` with `data()` still readable, then
`'ready'` — and the timer is owned by the mount, so unmounting stops it.
Omitted, a key is fetched once and never goes stale.

`retry.attempts` counts the first try: `3` is one try and two retries. The
first wait is 100 ms; `'exponential'` doubles it each attempt, `'fixed'` does
not. A cancelled request is never retried.

**No shared cache.** A resource owns its value and nothing else's: two modules
asking for the same key make two requests, and `invalidate()` on one does not
reach the other. A cache is a second place state lives, which A1 does not
allow, and it is the part of a query library an app can least often use
unchanged (ADR 0004).

**Separate signals, not one union.** `status()`, `data()` and `error()` are
independent signals, so a hole that renders a spinner reads only `status()`
and is not woken when data changes. A single `user()` returning
`{ status, data, error }` would narrow better but wake every reader on every
change. Only the separate form exists; no union accessor is offered alongside.

Narrowing comes from one type-guard method, since TypeScript cannot narrow
`data()` from a separate `status() === 'ready'` comparison:

```ts
if (user.is('ready'))   user.data();    // T — `this is LoadedResource<T>`
if (user.is('error'))   user.error();   // Error — `this is FailedResource<T>`
if (user.is('refreshing')) user.data(); // T — previous value retained
```

`is()` reads `status()` only, so it has the same reactivity as the comparison.
Comparing `status()` directly remains legal but leaves `data()` as `T | undefined`.
A value arrives `DeepReadonly` like every other value a signal hands out
(§5 Immutability), so `T` above means the read-only view of it.

Guarantees: in-flight request is aborted when the key changes; identical keys
are de-duplicated; out-of-order responses are discarded, never applied; errors
are values, not thrown. `resource()` may only be constructed inside
`*.effects.ts` (enforced by `SHR-L004`, as are `mutation()` and `stream()`).

### `mutation()` — writes in the core

`resource()` without a write path is Query without `useMutation`, and the
reference app has forms. Optimistic update, rollback and invalidation are where
async UI actually hurts, so they are specified rather than left to each app:

```ts
const save = mutation({
  run: ({ input, signal }) => api.saveOrder(input, { signal }),
  optimistic: (input) => state.orderDraftApplied(input),   // a transition
  rollback: (input) => state.orderDraftReverted(input),    // a transition
  onSuccess: () => orders.invalidate(),
});

save.run(input);  save.status();  save.error();
```

`optimistic` and `rollback` name transitions, never mutate — the L005 rule
holds. Concurrent runs of the same mutation are serialized by default; opting
out is explicit.

### `stream()` — subscriptions in the core

`resource()` models request/response. Push data needs a second primitive:

```ts
const ticks = stream({
  key: () => ['ticks', symbol()],
  subscribe: ({ emit, signal }) => socket.on(symbol(), emit),   // returns teardown
  reduce: (prev, msg) => applyTick(prev, msg),
  initial: {},
});
```

`reduce` must be **O(1) per message** — this is a documented contract, not a
suggestion. Folding a thousand messages per frame still runs `reduce` a
thousand times, so an O(n) reduce over a 500-row table blows the frame budget
even with a perfect scheduler. For the cases where per-message work is
unavoidable, `reduceMany(prev, msgs[])` receives the whole frame's batch and is
the only supported escape hatch.

Guarantees: teardown runs when the owner is disposed or the key changes;
messages arriving faster than a frame are folded and committed once per frame
(backpressure by coalescing, never by queueing unboundedly);
reconnection state is exposed as `ticks.status()` so views can show staleness
instead of silently rendering old numbers.

A stream is read like any other value — `ticks()` — with `ticks.status()` and
`ticks.error()` beside it, rather than a `data()` accessor: unlike a resource
it always has a value, because `initial` is one.

`status()` is `'connecting' | 'open' | 'closed'`. A `subscribe` that returns a
teardown directly is open the moment it returns; one that returns a *promise*
of a teardown stays `'connecting'` until it resolves, and messages that arrive
during the handshake are still folded. A subscription that resolves after its
key changed is torn down as soon as it exists.

`subscribe` is handed `close(reason?)` as well as `emit`. An adapter whose
source ends calls it, and the stream goes `'closed'` with the last value still
readable, so a view can show stale numbers and say they are stale. The teardown
still runs on unmount. A `subscribe` that throws, or whose promise rejects, is
the same `'closed'` state with the error in `error()` — never a throw.

A new key tears the subscription down, resubscribes, and resets the value to
`initial`: the fold belonged to the key that went away. Messages from a
torn-down subscription are ignored, so an adapter that keeps emitting cannot
corrupt the new key's fold.

## 7. Causal trace

The runtime records a causal chain for every update, behind a flag in
development builds:

```
write(count, 0 -> 1) @ todo.effects.ts:24
  └─ computed(doubled) recomputed
      └─ view(TodoList) patched 1 node: <span data-s="3">
```

Retention is bounded: a fixed-size ring buffer (default 500 entries), opt-in
per signal for previous-value capture, and sampling above a write-rate
threshold. Holding a previous value for every write at 1000 writes/sec would
exhaust memory and produce a log unreadable by human or agent alike.

Note the tension, acknowledged rather than hidden: `__sheratan` is a global
registry, which this spec rejects for DI and for event buses. It is defensible
only because it is a dev-build debugging surface with no role in application
code, and it is absent from production builds entirely.

Exposed as `__sheratan.trace()` returning structured JSON — timestamp, cause,
propagation path, DOM patches. This is the artifact an agent reads to debug
itself (section 10). Off in production; zero cost when disabled.

## 8. Checker

Ships as `sheratan check`. Implemented over the TypeScript compiler API as a
dev-time tool — a devDependency, which does not violate A4.

Error format is fixed and stable:

```json
{
  "code": "SHR-L001",
  "severity": "error",
  "file": "modules/todo/todo.view.ts",
  "range": { "line": 3, "column": 1 },
  "message": "view cannot import effects; allowed: lib, ui, own state.",
  "fix": "Move the call into todo.effects.ts and expose the result via todo.state.ts.",
  "docs": "https://sheratan.dev/errors/L001"
}
```

Human formatter for the terminal, `--json` for machines. The JSON shape is a
public API and is versioned.

## 9. Templates and rendering

Tagged template literals — works with no build step:

```ts
export const view = (s: TodoState) => html`
  <ul>
    ${each(s.items, (item) => {
      const title = computed(() => item().title);
      return html`<li>${title} <button @click=${intent.remove}>×</button></li>`;
    })}
  </ul>
  <button @click=${intent.add}>Add</button>
`;
```

Keyed list reconciliation, event binding via `@event`, property binding via
`.prop`, attribute binding via a bare name.

**`each(list, row)`.** `list` is a signal or computed of an array (or a plain
array, rendered once). Rows are keyed by `item.id` for objects and by value for
primitives; an object without `id`, or a duplicate key, is an error. There is
no key option. The row function runs **once per key** and receives an
**accessor for the row's item**, not the item: when a new object arrives under
the same key the accessor updates, and only the holes whose values changed are
written. Cells read the item through computeds in the row, the same rule as any
other derived value (§9 "Holes take signals by reference"). `${item().title}`
reads once and is the trap.

**`each(list, row, window)`.** A third argument turns the list positional:
instead of creating and destroying nodes on scroll, `each` keeps a fixed pool
of rows and rewrites their items in place, with a spacer above and below
standing in for the rows that are not in the DOM. Virtualization is cheap here
precisely because the framework owns both the scheduler and the renderer — a
userland library has to measure through `getBoundingClientRect` and fight the
renderer for write timing.

```ts
interface EachWindow {
  readonly start: number;     // index of the first row rendered
  readonly count: number;     // how many rows exist — the size of the pool
  readonly rowHeight: number; // CSS pixels, for the spacers
}

each(s.rows, row, window: Accessor<EachWindow>)
```

Mechanism in core, policy outside: the window is supplied by the caller, not
decided by the framework. A scroll listener in `*.effects.ts` owns the
container's height and the overscan and hands over one value — which is also
the only place a measurement can come from, because the list's first reconcile
happens while its rows are still in a detached fragment. An out-of-range window
is clamped rather than rejected: a rubber-banding scroll reports a negative
offset, and that is not an error.

The scroll container needs `overflow-anchor: none`. This is not a nicety: the
spacer above the rows changes height on every scroll step, the browser moves
`scrollTop` to hold its anchor element still, and that move fires another
scroll event. Six wheel ticks carry the list to the end of its own accord.

A windowed list is **positional, not keyed**. A slot is recycled, so a row's
DOM node no longer follows its item when the list reorders, and `SHR-R006` /
`SHR-R007` key validation does not run. That is what makes scrolling
allocation-free; see ADR 0003.

An optional compiler (post-MVP) can pre-compile templates and add
typed template checking; it must remain optional.

### How a view updates (the most important runtime decision)

The view function runs **once**, at mount. It is not re-run on state change and
there is no re-render.

At mount the template is parsed once into a `<template>`, hole positions are
recorded as direct node references, and each hole that receives a signal or
computed gets its own micro-watcher:

```ts
// html`<span>${s.total}</span>` becomes roughly
watch(() => { textNode.data = String(s.total()); });
```

**Holes take signals by reference.** JavaScript evaluates every `${…}` before
the `html` tag runs, so a hole cannot observe a call made inside it: in
`${s.total()}` the runtime receives a plain number and cannot know which signal
produced it. Without a compiler there is exactly one way for a hole to be
reactive: it receives the signal or computed itself, `${s.total}`, and the
runtime reads it inside the hole's watcher. A plain value in a hole is rendered
once. An expression — `${s.total() * 2}`, a ternary choosing between templates
— is a derivation, and derivations are named computeds (§4): in state when they
shape data, in the view when they choose markup:

```ts
const body = computed(() => s.status() === 'error' ? errorBox : table);
html`<main>${body}</main>`
```

A signal write therefore wakes only the watchers for the holes that read it and
writes to those nodes directly. Twenty holes means twenty independent
subscriptions; changing one touches one text node. The 500-row claim depends
entirely on this: if the view function rebuilt 500 `<li>` descriptions per
tick, the number would be unreachable. `each` creates per-row watchers and
reconciles by key; rows are not rebuilt when a cell value changes.

**The trap agents will hit:** `${s.total}` is reactive; `${s.total()}` reads
once at mount and never updates — and so does `const t = s.total()` above the
template, for the same reason. It looks like every other framework and is
wrong here. First item in `llms.txt`, and a checker warning (`SHR-V003`): a
call expression inside a hole is visible on the AST, so unlike the old
formulation this one is detectable exactly.

### Intents

`@click=${intent.add}` is sugar for a named handler exported by the view's
module, invoked with a typed payload; the raw `Event` is not passed on.

| Event | Payload |
|---|---|
| `submit` | form fields as an object (`Object.fromEntries(new FormData(form))`); default prevented |
| anything else | the element's `value`, or `checked` when its `type` is `checkbox`; `undefined` when it has neither |

**The payload is read from the element the handler is on, not chosen by the
event's name.** A component library announces changes under its own name —
`sl-change`, `md-input` — and no table of event types can hold them all, so a
name-keyed rule hands every one of them `undefined` while looking like it
worked. Reading the element is one rule instead of a list that is always
incomplete, and it makes a custom element a first-class control with no adapter.

Two consequences worth stating. A `<button value="ascending">` reports
`"ascending"`, so one intent can serve several buttons without a `data-`
attribute. And a plain `<button>` reports `""` rather than `undefined`, because
a button has a value and an empty one is still one; only an element with no
`value` at all — a `<div>`, a `<li>` — reports nothing.

Inside an `each` row the handler receives a **second argument: the row's
current item**, read when the event fires, from the innermost row. That is how
a row's button names its order without an inline arrow:

```ts
html`<button @click=${intent.ship}>Ship</button>`   // in a row
ship: (_payload, order) => …                         // in effects
```

Every handler runs inside `batch()`. Views
declare intents, effects implement them, and the wiring is generated by
`sheratan generate`. An inline arrow function in a template is a checker error
(`SHR-V001`) — that is where logic starts leaking back into views.

### Escaping and `unsafeHTML`

Every hole is escaped as text by default; interpolated values never become
markup. Injecting markup requires the explicit `unsafeHTML(value)` directive,
which the checker flags whenever its argument is not a literal (`SHR-V002`,
a warning: sanitized markup is a legitimate non-literal). Agents
interpolate user data without thinking, so the default must be the safe one.

### CSS without a build step

Component styles are plain `.css` files loaded through CSS module scripts
(`import sheet from './button.css' with { type: 'css' }`). No bundler, no
runtime CSS-in-JS.

`adoptedStyleSheets` on `document` is global: attaching a sheet does not scope
it. Scoping therefore needs its own decision, made here.

## 9a. Style scoping

**One mechanism: native CSS `@scope`, enforced by the checker.** No hashed class
names, no Shadow DOM, no runtime selector rewriting.

Rejected, with reasons:

- **Hashed / generated class names** (CSS Modules style) require a transform
  step. That breaks §10c ("type stripping only").
- **Shadow DOM per module** isolates properly but breaks form participation,
  focus and `:focus-visible` across boundaries, and makes global base styles
  unreachable. It is also a second rendering model inside the tree.
- **Runtime prefixing** needs a CSS parser in `core`, which costs size and
  correctness for no gain over a native feature.

### The rule

Every module and `ui/` component root carries its name as an attribute, set by
the runtime at mount, never written by hand:

```html
<section data-module="orders"> … </section>
<button data-ui="button"> … </button>
```

Its stylesheet wraps **all** rules in exactly one `@scope` block keyed to that
attribute, with a lower boundary at any nested module or component:

```css
/* modules/orders/orders.css */
@layer modules {
  @scope ([data-module="orders"]) to ([data-module], [data-ui]) {
    :scope { display: grid; gap: var(--space-3); }
    .row   { border-bottom: 1px solid var(--color-hairline); }
  }
}
```

The lower boundary is the point: a parent's `.row` never styles a child
module's `.row`. Class names stay short and readable in devtools because they
cannot collide.

`sheratan generate module` and `sheratan create` write this wrapper; nobody
types it from memory.

### Common styles

There is exactly one global stylesheet, `styles/global.css`, linked from
`index.html`. It declares the layer order once and may contain only two layers:

```css
@layer tokens, base, ui, modules;

@layer tokens { :root { --space-3: 12px; --color-hairline: rgb(0 0 0 / .12); } }
@layer base   { *, *::before, *::after { box-sizing: border-box; } body { margin: 0; } }
```

- **`tokens`**: custom properties on `:root` only, plus their
  `prefers-color-scheme` overrides. Custom properties inherit, so they are the
  single channel by which global design reaches scoped styles, and they cross
  widget-mode boundaries too.
- **`base`**: reset and element defaults (`body`, `a`, form controls). No class
  selectors.
- **`ui`** and **`modules`**: never written in `global.css`. They are filled
  by the scoped component and module sheets, so a module rule always beats a
  `ui/` rule, and both beat `base`, regardless of load order or specificity.

There is no utility-class layer and no shared stylesheet between modules. A
style shared by two modules is either a token or a `ui/` component. This
mirrors "there are no shared effects" in §4.

### Widget mode

A mounted widget ships its `global.css` tokens scoped to its own root instead of
`:root` (`@scope ([data-sheratan-root])`), so it never restyles the host page.
The host's own global CSS can still reach in. If that proves a problem in
practice, the escape hatch is mounting the widget root in a shadow root. That is
a mount option, not a second styling model.

### Enforcement: `SHR-L009`

Checked over `.css` files by the checker:

| Violation | Message states |
|---|---|
| Module / `ui/` sheet has a rule outside its single `@scope` block | "all rules must be inside `@scope ([data-module=\"orders\"])`" |
| `@scope` root does not match the file's own module or component name | the expected selector |
| `@scope` block has no `to (…)` lower boundary | the canonical boundary |
| `global.css` contains a layer other than `tokens` / `base`, or a class selector in `base` | allowed layers |
| A module sheet declares a custom property on `:root` | "tokens live in global.css" |
| `!important` anywhere outside `base` | "layers already decide precedence" |

Browser support: `@scope` and `@layer` are required. The target niche is
authenticated app UIs on current evergreen browsers (§1), so there is no
fallback path. Verify the support matrix in Week 1, before templates are built
on it.

### Composing modules: `mount()`

Complex components are modules, so views must be able to render other modules.
They do it without importing them. A module's `index.ts` exports a factory; the
instance is constructed where dependencies already exist (`app.ts`, or the
parent's effects) and handed to the view as a parameter:

```ts
// app.ts, or the parent's effects
const ordersTable = createOrdersTable(api);

// parent.view.ts
html`<section>${mount(ordersTable, { customerId: s.id })}</section>`
```

`mount()` returns a node description like everything else in a template — the
view constructs nothing, touches no foreign state and invokes no foreign
effects, so purity holds. Composition lives in the wiring, not in the view.
Child lifetime is bound to the parent: when the parent unmounts, the child is
disposed.

Importing another module directly from a view remains a checker error.

## 9b. Routing

The URL is an **input effect**: read as a source, written as an effect, subject
to the same layer rules. Views never touch `history`; views emit intents.

The browser already provides most of it — `<a href>` works on its own,
`URLPattern` matches paths natively, `pushState` + `popstate` cover navigation,
and View Transitions handle animation. What the browser does not provide, and
what therefore ships in core:

- `location` as a signal
- delegated click interception for `<a>` (same origin, primary button, no
  Ctrl/Cmd/Shift, no `target`, no `download`) — trivial, and always written
  wrong when left to the user
- `navigate()`, callable only from `*.effects.ts` (`SHR-L004`)
- scroll and focus restoration on back/forward
- **flat path matching** — a thin wrapper over `URLPattern`, roughly thirty
  lines, and a plain `computed` rather than new machinery:

```ts
const page = computed(() => match(location(), {
  '/orders':      () => ordersList,
  '/orders/:id':  ({ id }) => orderDetail,
}));
```

Without `match()` the core looks unfinished — it would hand the user a URL
signal and no way to act on it. Flat routes must work with zero dependencies.

Loading races are free: `resource()` aborts on key change, and the key includes
`location()`. There is no loader lifecycle to invent.

That leaves exactly one thing that is genuinely a router — **nested layouts**
(`/app/*` renders a shell, `/app/orders/:id` renders inside it). The reason it
stays out of core is policy, not size: a match tree needs resolution order,
behaviour while a parent is still loading, and a rule for partial matches.
These are the questions routers disagree about. Hence optional
`@sheratan/router`, post-MVP.

Documented boundary: **single-level routes work out of the box; nested layouts
are a separate install.**

Validation: if the reference app can be built without the router package, the
boundary is right. If nested layouts are needed on the first screen, they
belong in core — and that must be discovered in Week 4, not after release.

Positioning line that falls out of this: routing is `<a href>`, `URLPattern`,
and a resource whose key depends on the URL.

## 10. Agent surface

Treated as part of the product, not as marketing.

**One interface: the CLI.** Logic lives in the `check` and `cli` packages as
ordinary functions (`checkProject()`, `scaffoldModule()`, `explainError()`);
the CLI is a thin wrapper that parses arguments and prints. `--json` on every
command is the machine surface.

No MCP server. An agent can already run commands, and `sheratan check --json`
delivers exactly what a tool call would — without a server to install, a
protocol to version, or a second place where behaviour drifts. This is axiom
A1 applied to tooling. Reconsider post-MVP only if a concrete scenario appears
that a command cannot cover.

```
sheratan create <app>
sheratan generate module <name>
sheratan generate resource <name> --in <module>
sheratan generate stream <name> --in <module>
sheratan check [--json]
sheratan explain <error-code> [--json]
sheratan trace [--json]        # pulls the causal trace from the dev server
sheratan dev
sheratan build                 # strips types into a deployable directory
```

- **`llms.txt`** at the repo and docs root: full API surface, the import
  matrix, canonical module example, error-code index, and — first item — the
  reactivity trap (`${s.total}` in a hole is reactive; `${s.total()}` is read
  once). Must fit in ~8k tokens.
- **Skill** (`SKILL.md`): when to use, how to scaffold via the CLI, how to read
  checker output, how to read a trace, the "one way to do each thing" table.
- **Generation over recall.** Agents call `sheratan generate` instead of writing
  boilerplate from memory. Deterministic output where determinism is possible;
  the model writes only the parts that require judgment.

## 10b. The `create` template

First impressions are a product decision. `sheratan create` must produce
something that looks deliberate, with zero dependencies intact.

**No UI kit is recommended, ever.** Every existing kit is React, Vue, or web
components — the first two cannot be used at all, the third drags in its own
runtime and state model. Recommending one means recommending a violation of A4.
It is also the step where a small framework becomes an opinionated
meta-framework maintaining someone else's release cycle.

Instead, the template ships:

- **Design tokens** — `styles/global.css` with the `tokens` and `base` layers
  from §9a: colour, spacing scale, typography, radii, dark mode via
  `prefers-color-scheme`. No JavaScript, no dependencies, tidy out of the box.
- **~10 `ui/` primitives copied into the user's project**, not installed:
  Button, Input, Select, Modal, Table, Toast. shadcn's model, and it fits here
  exactly because `ui/` components are stateless by definition. They belong to
  the user and are theirs to edit.
- **Browser primitives over hand-rolled ones** — `<dialog>`, the popover API,
  `<details>`. Half of a typical UI kit is unnecessary in 2026.

Tailwind is mentioned in the docs as compatible (no runtime, template-agnostic)
but is never wired into `create` — that would reintroduce a build step.

### The canonical module

The template includes one reference module that is deliberately not a hello
world: it must exercise **every rule at least once**, so that the first thing
both a human and an agent read is a correct, complete example.

Required coverage: all four files; a contract-backed service passed in by
factory; a `resource()`; a `stream()`; a `computed` deriving view shape rather
than storing it; an atomic transition committing two responses at once; an
`each` with a window; a `mount()` of a `ui/` primitive; an `onDispose()`; a
scoped stylesheet that relies on tokens from `global.css` (§9a); and both test
files populated with real assertions.

Two constraints:

1. **Correct code only.** No commented-out "wrong way" examples — an agent
   copies what it sees. Contrastive right/wrong pairs live in `llms.txt` and
   `sheratan explain`, where they are labelled as errors.
2. **CI asserts the canonical module passes `sheratan check` and that every
   rule code is exercised by it.** Otherwise the example rots and starts
   teaching the wrong thing.

This is the highest-leverage documentation in the project: ten correct files in
every new repo beat any number of documentation pages at suppressing
hallucinated React idioms.

## 10c. What "no build" actually means

The unresolved contradiction, settled here before someone settles it in a
comment thread: user code is TypeScript, and browsers do not run TypeScript.

The honest formulation, and the only one to use in the README:

- **`core` requires no build.** It ships as plain ESM and can be used from a
  `<script type="module">` with an empty `node_modules`, served by **any static
  file server** (`python3 -m http.server`, `npx serve`). Not from `file://`:
  browsers refuse ES module scripts from an opaque origin, and a `file://`
  build would be a second way to load core. The zero-build demo is JavaScript.
- **TypeScript projects need type stripping.** `sheratan dev` strips types and
  serves ESM — no bundling, no transform of the templates, no plugin
  configuration. Under Bun or Deno, which run TypeScript natively, even that
  disappears.
- Production is ESM served as-is: `sheratan build` strips types from `src/`
  into a directory of plain ESM and copies everything else, so what ships is
  what a static host serves. No bundler is involved, and `dev` and `build`
  differ only in where the stripped output goes. Bundling afterwards is
  optional and the user's choice.
- Both commands are served by Sheratan's own minimal server rather than a
  third-party dev server: a framework that promises no plugin pipeline should
  not require one to run (ADR pending; prototyped in `examples/hello/serve.ts`).

"No build" is a promise to users, not a constraint on how Sheratan itself is
written. The core's source is strict TypeScript, compiled once before publish
to plain ESM plus generated `.d.ts`; the package users install contains only
the compiled output, so nothing above changes for them.

Never write "no build step" unqualified. Write "no bundler, no config, no
plugin pipeline — type stripping only".

## 10d. Widget mode (the adoption path)

A framework with zero training data cannot expect greenfield adoption. The
realistic first production user is one live table inside somebody's existing
React or Vue dashboard:

```ts
const dispose = render(view, document.querySelector('#live-table'));
```

`render()` mounts into any element, owns only its subtree, and disposes
cleanly, so a host app can mount and unmount it on route changes. This is the
Trojan horse and it is directly in service of the 8-week gate: an outsider
shipping one widget is a far more reachable "outside production use" than a
whole app rewritten.

Constraint it places on the design: no assumption of owning `document`, no
global listeners beyond the delegated `<a>` handler (which must be opt-in in
widget mode, since the host app owns routing).

## 11. Repository layout

```
packages/
  core/        signals, resource, html, render, trace   (zero runtime deps)
               src/ TypeScript → dist/ ESM + .d.ts, published
  check/       TS-API based rule checker                (dev only)
  cli/         create / generate / check / dev
  router/      post-MVP, optional — path matching, layouts, guards
examples/
  dashboard/   reference app: real-time dashboard over heavy data —
               streams, a 500-row virtualized table, errors, forms
               modules/ + services/ + app.ts composition root + e2e/
docs/
  llms.txt
SKILL.md
SPEC.md
```

## 12. MVP definition of done

Read together with the pre-committed cut list in PLAN.md — items below marked
(must) survive a schedule slip; everything else is cuttable.


- `examples/dashboard` runs from a plain `index.html` on a static file server with no build step and
  holds 60fps under a synthetic 1000 msg/sec feed into a 500-row table.
- Every cell of the import matrix is enforced (`SHR-L001`), plus L002–L009 and
  V001–V004, each with a failing-case test; `SHR-V002`, `SHR-V003` and
  `SHR-T001` report as warnings only.
- Error messages state the allowed import set, not a rule number.
- `resource()` passes tests for: abort on key change, dedup, out-of-order
  discard, stale-while-revalidate, retry with backoff.
- `stream()` passes tests for: teardown on key change and on disposal,
  frame coalescing under flood, reconnect status.
- Leak test: mount and unmount a module 1000 times; live subscription count
  returns to zero. Post-disposal responses are no-ops; `AbortError` never
  surfaces as an error state.
- `sheratan check --json` output is schema-stable and documented.
- The scaffold → check → fix loop works end to end from Claude Code using the
  CLI alone.
- Causal trace renders for the reference app.

## 13. Resolved positions

- **Template typing.** Type-level HTML parsing is not the answer: TS recursion
  caps out around 50 levels and condition-heavy parsing makes tsserver crawl.
  Reliable instead: typed holes (`string | number | Node | Directive`) plus
  generics on `each` and `mount`, dev-time runtime validation at first parse
  (unknown attributes, unclosed tags), and the checker parsing template
  literals off the AST to emit template errors (`SHR-V001`–`V004`) in the same
  JSON shape as layer errors. The optional compiler stays on the roadmap for template
  precompilation (start-up speed); typing arrives with it as a side effect.

- **SSR: a stated no, not a "later".** Sheratan targets app-shaped UIs behind
  authentication — dashboards, internal tools, trading and admin interfaces —
  where there is no SEO, first paint sells nothing, and server-rendering live
  data is meaningless. Public content sites should use Next or Nuxt, and the
  README says so plainly. Two cheap constraints keep the door open: no
  `document` access at module construction, and templates stay serializable.

- **`SHR-L005` is not a compile-time guarantee, and the positioning must not
  claim it is.** Static analysis catches direct writes but loses the trail
  through ordinary indirection. A signal held in a variable, passed to a `lib/`
  helper, destructured — that is a TypeScript limitation, not a checker bug.
  Statically, a transition is any function exported by `*.state.ts` (§4), and
  L005 flags a `.set()` on state reached from `*.effects.ts`. Backstop: dev
  builds record write provenance for the causal trace; with plain-function
  transitions the assertion has to identify the writer by call site rather
  than by a marker — open, see TASKS "Spec gaps". Both report `SHR-L005`.

## 14. To be settled by the reference app

Three empirical questions, each with a deadline and a way to answer it.

| Question | When | How it gets answered |
|---|---|---|
| Do typed holes + runtime validation + checker remove the desire for a compiler? | Week 4 | Build the reference app and count the errors that slipped through |
| Is flat `match()` enough, or are nested layouts needed on the first screen? | Week 4 | If the reference app needs `@sheratan/router`, nested layouts belong in core |
| Does `app.ts` become a 300-line wall on a large module tree? | Week 1 | Nested factories are already legal; verify the ergonomics rather than assume |
