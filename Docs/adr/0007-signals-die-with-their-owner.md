# 0007 — A signal belongs to the owner it was created under, and dies with it

**Status:** accepted, 2026-10-12 · implements SPEC §5b rule 1 "Post-disposal async is a no-op" · closes TASKS "Spec gaps": "Recognising a transition at run time" and "Runtime enforcement of post-disposal no-ops"

## Context

SPEC §5b rule 1 says a response arriving after unmount must not throw and must
not write to a discarded state. Half of that has always held: the watchers and
template holes of a disposed owner are unlinked, so a late write reaches
nothing and renders nothing. The other half — the write itself does nothing —
had no mechanism, and the SPEC said so.

The reason is SPEC §4's choice that a transition is a plain exported function,
with no `transition()` wrapper. Nothing marks a function as a transition at
run time, so the runtime cannot ask "is the caller's owner still alive?" when
the caller is just a function. Every effects file therefore checks
`signal.aborted` by hand before it commits — `examples/hello` does it in four
places — which is the pattern, but not the enforcement: nothing checks that the
check was written, and an agent that forgets it produces code that works until
a slow response lands after a route change.

The decision of 2026-10-04 (TASKS decisions log) chose enforcement over
documenting the hand-written check. This ADR is the mechanism.

The same gap held up the runtime half of `SHR-L005`: "dev builds record write
provenance … the assertion has to identify the writer by call site rather than
by a marker" (SPEC §13). Both questions asked the runtime to recognise a
transition, and both get answered here.

## Decision

**Mark the state, not the function.** A signal records the owner that was
active when it was created. A write to a signal whose owner has been disposed
is a no-op: the value does not change, nothing propagates, nothing throws.

That is SPEC §5b's first sentence applied to signals — "everything created
inside an owner dies with it" — and it needs no new API. It works because of
where state already lives: a module's state factory runs inside the module's
view function, which `mount()`, `render()` and `routes()` call under the
module's owner (SPEC §4, "Wiring a module"). So every signal of a module's
state is stamped with that module's owner, and a late transition — whatever
called it, through however many plain functions — writes into dead signals and
does nothing.

What it covers, precisely:

- **A late response into a disposed module's state** — the case rule 1 exists
  for. The checks in `examples/hello` that only guard a write become
  redundant and are removed. A check that guards *further work* — not
  subscribing to a feed once the mount is gone — stays, because that is not a
  write.
- **A route change mid-request.** `routes()` disposes the old screen's owner,
  so its state dies with it, including a layout's.
- **`scope()` in tests.** After `dispose()`, effects writing into state created
  inside the scope do nothing, exactly as after an unmount.

What it deliberately does not cover:

- **A signal with no owner** — created at module evaluation, in `app.ts`
  before `render()`, in a `lib/` singleton, or in a test outside `scope()` —
  is never dropped. App-wide state is not discarded state, and a late write to
  it (a logout response after the screen that sent it has gone) is legitimate.
- **Reads.** A disposed owner's signals still return their last value; there
  is nothing to protect by throwing on a read, and a teardown may need it.

**In dev builds a dropped write is a trace entry**, `kind: 'dropped'`, with the
write's call site and the value it would have written (SPEC §7). Not a console
warning and never an error: a response landing after unmount is normal
operation, not a bug (§5b rule 1 says it must not throw), and a warning on
every route change would teach people to ignore warnings. When someone does
need to know why a value did not change, the trace answers it.

**`SHR-L005` keeps its static half and loses its runtime one.** The dev-build
"write provenance" assertion is dropped from SPEC §13. It had two jobs. The
first — catching a direct write the checker cannot follow — is the job
`SHR-L010` took over on 2026-09-17 by making that write a type error; what the
type system cannot see after that is a widened declaration, which L010 reports.
The second — refusing a write from a dead caller — is what this ADR enforces
for every write, not only the ones a stack trace can attribute. What is left
would have identified a writer by parsing `Error().stack`, whose format no
standard fixes, in dev builds only, so dev and prod would disagree about what
is legal. The static `SHR-L005` (a `.set()` on state reached from
`*.effects.ts`) stays as the best-effort backstop SPEC §13 describes.

## Trade-off accepted

- **Cost on the hot path:** one pointer per signal and one flag test per
  `.set()`, before the equality check. O(1), no allocation, so the write
  bound in AGENTS.md is unchanged. The size budget is re-recorded in the PR
  that lands the runtime, with the number.
- **A signal can outlive its usefulness silently.** Code that creates a signal
  inside one module and hands it somewhere longer-lived will find writes
  dropped once the creator unmounts. That is the ownership rule doing its job —
  state that outlives a module is created above it, in `app.ts` or in the
  parent that composes both (SPEC §4b) — but it is a surprise when met, and the
  trace entry is the only signal. Watchers already die with their owner;
  signals now match them.
- **A disposed owner is retained by its signals.** A stamped signal holds its
  owner, so an owner lives as long as any of its signals is reachable. A
  disposed owner has already dropped its children, watchers and cleanups, so
  what is retained is one small object, not the subtree.
- **The hand-written check stops being a teaching example.** The `create`
  template and `llms.txt` stop showing `if (signal.aborted) return;` before a
  transition. Code that still has it keeps working; it is redundant, not wrong.

## Rejected

- **A `transition()` wrapper** (`export const loaded = transition((rows) => …)`).
  It reverses SPEC §4's resolved position and adds an export (A5). It marks a
  function, so it covers only what was wrapped — an unwrapped transition is
  silently unenforced, which needs a checker rule to find, which is a second
  mechanism for one guarantee. And it still has to learn the owner at the
  moment the state is created, which is this ADR with extra steps.
- **Call-site provenance from the trace.** Dev builds only, built on stack
  parsing, and it identifies a caller rather than whether its owner is alive.
  A production build would let the late write through, so the guarantee would
  hold exactly where nobody is looking.
- **Dropping rule 1** and documenting the hand-written `signal.aborted`
  check. Decided against on 2026-10-04: it is the one guarantee in §5b nothing
  could check, and a check nothing enforces is one an agent can leave out with
  every test still green.

## Revisit when

- A real app needs state created inside a module to outlive it. The first
  answer is to create it higher; if that is not possible, the answer is an
  explicit opt-out on the signal, not unstamping all of them.
- A profile shows the `.set()` flag test on a hot path. It has not been
  measured to matter; the reorder benchmark (Week 1 gate) is where it would
  show.
