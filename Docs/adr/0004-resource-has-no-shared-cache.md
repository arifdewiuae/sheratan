# 0004 — `resource()` owns its value, and there is no cache between resources

**Status:** accepted, 2026-09-16 · implements SPEC §6 "`resource()` — async in the core"

## Context

SPEC §6 calls `resource()` "the single most important differentiator: one
primitive covers what React Query / RxJS wrappers do today". Most of what it
specifies is mechanical — abort on key change, deduplicate identical keys,
discard out-of-order responses, errors as values. Two things were not decided,
and both are the kind of choice a framework only gets to make once.

**Whether there is a cache.** A query library's centre of gravity is a store
keyed by query key, shared by every component: the second caller of
`['user', 7]` gets the first one's data without a request, and invalidating the
key updates everyone. It is the feature people name when they say "React
Query", and leaving it out is the visible difference.

**What makes stale data revalidate.** `staleAfter: 30_000` appears in SPEC's
example with no trigger attached. React Query's `staleTime` is read when
something *else* prompts a refetch — a remount, a window focus, a new
subscriber. Sheratan's core has none of those: a module mounts once and the
resource lives as long as it does, so a freshness threshold with nothing to
compare it against would do nothing at all.

## Decision

**A resource holds its own value and nothing else's.** Two modules asking for
the same key make two requests; `invalidate()` on one does not reach the other.
There is no key registry, no shared store and no garbage collector for one.
Data shared between modules is state, and state lives in a `*.state.ts` that
both modules read — the mechanism SPEC §4b already requires for every other
kind of sharing.

**`staleAfter` revalidates on a timer owned by the mount.** When it elapses the
resource refetches itself: status goes `'ready'` → `'refreshing'` with `data()`
still readable, then back to `'ready'`, and the next value starts its own
clock. The timer is cleared by disposal and by every new request, so an
unmounted module makes no requests. Omitting `staleAfter` means a key is
fetched once and never goes stale, which stays the default.

## Trade-off accepted

- **The headline comparison gets harder.** "Covers what React Query does"
  is now false about its most-cited feature, and the honest claim is narrower:
  one primitive covers the *request lifecycle* — cancellation, retry, races,
  revalidation — in the core, with sharing handled by the state layer that
  already exists. SPEC §6 and `llms.txt` both say so in as many words, because
  an agent that assumes a cache writes code that silently double-fetches.
- **Two modules on one key cost two requests.** Real, and measurable on a page
  that lists orders and shows a detail pane. The fix is to lift the resource
  into one module and let the other read its state — which is the layering the
  checker enforces anyway, so the cost pushes towards the shape we want rather
  than away from it.
- **`staleAfter` is polling, and polling has a footgun.** A live resource with
  `staleAfter` set fetches forever, whether or not anything reads it. The
  alternative — revalidating when stale data is *read* — is lazier, but a
  signal read that starts a request is re-entrant, fires inside `flush()`, and
  makes a hole's first paint depend on the network. A timer is predictable,
  testable with fake timers, and bounded by the owner's lifetime. It is opt-in:
  a resource with no `staleAfter` never schedules anything.
- **`'idle'` is reachable only through `abort()`.** With eager fetching there
  is no idle state on the way in, and the status was nearly dropped for it.
  It stays because `abort()` before the first response leaves a resource with
  nothing in flight and nothing to show, and neither `'loading'` nor `'error'`
  is true of that.

## Revisit if

- A real app in this repo shows two modules that genuinely need the same key at
  the same time and cannot share a state module — the reference app (SPEC §11)
  is the test. The answer then is an explicit shared resource created in
  `app.ts` and passed in, not an implicit global store.
- `mutation()` lands and `onSuccess: () => orders.invalidate()` turns out to
  need cross-module reach. That is the same question arriving from the write
  side, and it should be answered once, for both.
