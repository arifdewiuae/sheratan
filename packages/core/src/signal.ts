// Writable state (SPEC §5).

import { freeze } from './freeze.ts';
import { Flags, type Dependency, type Link, propagate, track } from './graph.ts';
import { enterBatch, exitBatch } from './scheduler.ts';
import type { DeepReadonly, Signal } from './types.ts';

class SignalNode<T> implements Dependency {
  flags = Flags.None;

  subs: Link | undefined = undefined;

  subsTail: Link | undefined = undefined;

  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

/**
 * A writable value. Read it by calling it, write it with `.set()`. Writing an
 * equal value (`Object.is`) notifies nobody, and the value is frozen, so state
 * can only be replaced, never mutated (SPEC §5 Immutability).
 *
 * @example
 * const count = signal(0);
 * count.set(count() + 1);
 */
export function signal<T>(initial: T): Signal<T> {
  const node = new SignalNode(freeze(initial));

  const read = (): DeepReadonly<T> => {
    track(node);

    return node.value as DeepReadonly<T>;
  };

  const write = (value: T | DeepReadonly<T>): void => {
    const next = freeze(value) as T;

    if (Object.is(next, node.value)) return;

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
