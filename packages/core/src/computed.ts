// Derived state (SPEC §5): lazy, cached, and glitch-free.

import {
  checkDirty,
  type Derivation,
  Flags,
  type Link,
  revalidate,
  setActiveSub,
  startTracking,
  endTracking,
  track,
} from './graph.ts';
import { getOwner } from './owner.ts';
import type { Accessor, DeepReadonly } from './types.ts';

class ComputedNode<T> implements Derivation {
  flags = Flags.Computed | Flags.Dirty;

  subs: Link | undefined = undefined;

  subsTail: Link | undefined = undefined;

  deps: Link | undefined = undefined;

  depsTail: Link | undefined = undefined;

  value: T | undefined = undefined;

  private readonly fn: () => T;

  constructor(fn: () => T) {
    this.fn = fn;
  }

  /** Recomputes and reports whether the value changed. */
  refresh(): boolean {
    const previousSub = setActiveSub(this);

    startTracking(this);

    try {
      const next = this.fn();

      // Cleared only on success: a computed that threw stays dirty and runs
      // again on the next read.
      this.flags &= ~(Flags.Dirty | Flags.Pending);

      if (Object.is(next, this.value)) return false;

      this.value = next;

      return true;
    } finally {
      endTracking(this);
      setActiveSub(previousSub);
    }
  }

  read(): T {
    if ((this.flags & Flags.Dirty) !== 0) revalidate(this);
    else if ((this.flags & Flags.Pending) !== 0) this.settle();

    track(this);

    return this.value as T;
  }

  private settle(): void {
    if (checkDirty(this)) revalidate(this);
    else this.flags &= ~Flags.Pending;
  }
}

/**
 * A derived value: evaluated on first read, cached until a source changes.
 * Every expression over state is a named computed — that is the one way to
 * derive (SPEC §9 "Holes take signals by reference").
 *
 * @example
 * const total = computed(() => price() * quantity());
 */
export function computed<T>(fn: () => T): Accessor<DeepReadonly<T>> {
  const node = new ComputedNode(fn);

  getOwner()?.own(node);

  return () => node.read() as DeepReadonly<T>;
}
