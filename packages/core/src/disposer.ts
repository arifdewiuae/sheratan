// Every teardown the runtime hands back is also a `Disposable`, so callers can
// write `using stop = watch(…)` and let the block scope end the subscription.

/** A teardown function that also works with `using`. */
export type Disposer = (() => void) & Disposable;

/** Adds `Symbol.dispose` to a teardown function. */
export function asDisposer(stop: () => void): Disposer {
  const disposable = stop as Disposer & { [Symbol.dispose]: () => void };

  disposable[Symbol.dispose] = stop;

  return disposable;
}
