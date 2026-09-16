# 0002 — Immutability is enforced, not requested

**Status:** accepted, 2026-09-16 · implements SPEC §5 "Immutability"

## Context

SPEC §5 requires state values to be immutable: reference comparison stays
cheap, the causal trace can hold the previous value, and an agent cannot
accidentally mutate a nested object — which it does routinely. Stating the rule
in documentation is not enforcement, and A2 asks for loud, early failure.

## Decision

Three layers, cheapest first:

1. **Types.** Reading a signal yields `DeepReadonly<T>`, so `items().push(x)`
   and `order().status = 'shipped'` fail to type-check.
2. **Run time.** `signal.set()` deep-freezes plain objects and arrays, so a
   mutation throws in strict mode (every ES module). Freezing skips subtrees
   that are already frozen, so with structural sharing the cost is bounded by
   the nodes the caller just allocated — which they paid for anyway. It stays
   on in production.
3. **Check time.** Mutation visible on the AST becomes a checker error with a
   `fix` (code to be assigned; TASKS "Spec gaps").

Values that break when frozen are left alone: DOM nodes, `Date`, `Map`, `Set`
and class instances.

## Trade-off accepted

- Freezing costs a pass over newly allocated nodes on every write. Measured
  against the alternative — a whole class of silent bugs — this is cheap, but
  it is not free, and a future benchmark may justify a development-only mode.
- `Map` and `Set` are typed as readonly but not frozen, so mutating one is
  caught by the compiler and not at run time. Making that symmetrical would
  mean wrapping them, which costs more than it protects.
- A user who stores a class instance in a signal gets no run-time protection.
  That is deliberate: freezing an instance breaks its methods.

## Revisit if

A benchmark shows freezing on the write path costs more than a few percent on
a realistic workload, in which case layer 2 becomes development-only and the
checker (layer 3) carries more weight.
