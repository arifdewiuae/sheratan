// Writable state (SPEC §5). A signal belongs to the owner it was created
// under, and a write after that owner is disposed does nothing (SPEC §5b rule
// 1, ADR 0007): a late response cannot reach discarded state, whatever plain
// functions it passed through on the way.

import { DEV } from './env.ts';
import { freeze } from './freeze.ts';
import { Flags, type Dependency, type Link, propagate, track } from './graph.ts';
import { getOwner, type OwnerNode } from './owner.ts';
import { enterBatch, exitBatch } from './scheduler.ts';
import { traceDropped, traceWrite } from './trace.ts';
import type { DeepReadonly, Signal } from './types.ts';

class SignalNode<T> implements Dependency {
  flags = Flags.None;

  subs: Link | undefined = undefined;

  subsTail: Link | undefined = undefined;

  value: T;

  /** Undefined for app-wide state, which nothing disposes. */
  readonly owner: OwnerNode | undefined;

  constructor(value: T, owner: OwnerNode | undefined) {
    this.value = value;
    this.owner = owner;
  }
}

/**
 * A writable value. Read it by calling it, write it with `.set()`. Writing an
 * equal value (`Object.is`) notifies nobody, and the value is frozen, so state
 * can only be replaced, never mutated (SPEC §5 Immutability).
 *
 * Created inside a mounted module, it dies with the module: once that unmounts,
 * `.set()` does nothing and reads return the last value, so a response that
 * lands late writes nowhere (SPEC §5b rule 1). Created outside any owner, it
 * lives as long as the app.
 *
 * @example
 * const count = signal(0);
 * count.set(count() + 1);
 */
export function signal<T>(initial: T): Signal<T> {
  const node = new SignalNode(freeze(initial), getOwner());

  const read = (): DeepReadonly<T> => {
    track(node);

    return node.value as DeepReadonly<T>;
  };

  const write = (value: T | DeepReadonly<T>): void => {
    if (node.owner !== undefined && (node.owner.flags & Flags.Disposed) !== 0) {
      if (DEV) traceDropped(node.value, value);

      return;
    }

    const next = freeze(value) as T;

    if (Object.is(next, node.value)) return;

    // Before the assignment, so the old value is still there to record.
    if (DEV) traceWrite(node.value, next);

    node.value = next;
    enterBatch();

    try {
      propagate(node.subs);
    } finally {
      exitBatch();
    }
  };

  const accessor = read as Signal<T>;

  accessor.set = write;

  return accessor;
}
