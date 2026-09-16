// Subscriptions in the core (SPEC §6). `resource()` models request/response;
// push data needs the other half. The contract that earns its place is the
// fold: `reduce` runs once per message and the value is committed once per
// frame, so a thousand messages a second cost a thousand O(1) folds and one
// DOM write rather than a thousand of each.

import { sameKey, toError } from './async.ts';
import { Flags } from './graph.ts';
import { onDispose } from './owner.ts';
import { batch, enqueue, type Job } from './scheduler.ts';
import { signal } from './signal.ts';
import type { Accessor, DeepReadonly, Signal } from './types.ts';
import { watch } from './watch.ts';

/** Whether messages are arriving, so a view can say the numbers are stale. */
export const StreamStatus = {
  /** Subscribing. Only a `subscribe` that returns a promise stays here. */
  Connecting: 'connecting',
  /** Subscribed. Messages reach the fold. */
  Open: 'open',
  /** The adapter called `close`, or `subscribe` failed. `error()` says which. */
  Closed: 'closed',
} as const;

/** One of the three states a subscription can be in. */
export type StreamStatus = (typeof StreamStatus)[keyof typeof StreamStatus];

/** What `subscribe` returns so the runtime can end the subscription (SPEC §5b). */
export type Teardown = () => void;

/** What a subscriber is handed: where to put messages, and when to stop. */
export interface StreamContext<K extends readonly unknown[], M> {
  /** The key this subscription is for, as the key accessor returned it. */
  readonly key: K;
  /** Hands one message to the fold. Safe to call after teardown; it is ignored. */
  readonly emit: (message: M) => void;
  /** Reports that the source ended. The teardown still runs on unmount. */
  readonly close: (reason?: unknown) => void;
  /** Aborts when the key changes and when the owning module unmounts. */
  readonly signal: AbortSignal;
}

/**
 * How a stream is described. `reduce` and `reduceMany` are alternatives, and
 * the type admits exactly one: `reduce` is the contract (O(1) per message),
 * `reduceMany` the escape hatch for work that cannot be done one at a time.
 */
export type StreamOptions<T, M, K extends readonly unknown[]> = {
  /** Reactive: a key with new contents resubscribes, an equal one does not. */
  readonly key: Accessor<K>;
  /** Opens the subscription and returns its teardown, now or once connected. */
  readonly subscribe: (context: StreamContext<K, M>) => Teardown | Promise<Teardown>;
  /** The value before anything has arrived, and after the key changes. */
  readonly initial: T;
} & (
  | {
      /** Folds one message. **Must be O(1)** — this is a contract (SPEC §6). */
      readonly reduce: (previous: T, message: M) => T;
      readonly reduceMany?: never;
    }
  | {
      /** Folds the whole frame at once, when per-message work is unavoidable. */
      readonly reduceMany: (previous: T, messages: readonly M[]) => T;
      readonly reduce?: never;
    }
);

/**
 * The folded value, read like any other value, with the subscription's state
 * beside it.
 */
export interface Stream<T> {
  (): DeepReadonly<T>;
  /** Whether messages are arriving. */
  status(): StreamStatus;
  /** Why the subscription closed, if it closed with a reason. */
  error(): Error | undefined;
}

class StreamNode<T, M, K extends readonly unknown[]> implements Job {
  // A scheduler job, so the frame drains it with the template watchers and a
  // hole sees the new value in the same frame it was committed.
  flags: number = Flags.Frame;

  drainId = -1;

  reruns = 0;

  readonly value: Signal<T>;

  readonly statusSignal: Signal<StreamStatus> = signal<StreamStatus>(StreamStatus.Connecting);

  readonly errorSignal: Signal<Error | undefined> = signal<Error | undefined>(undefined);

  private readonly options: StreamOptions<T, M, K>;

  /** What one message does: decided once, by which reducer the caller gave. */
  private readonly absorb: (message: M) => void;

  /** What the frame does with what arrived. */
  private readonly commit: () => void;

  /** Bumped by every subscription, so a late message can tell it is orphaned. */
  private generation = 0;

  private folded: T;

  private pending: M[] = [];

  private teardown: Teardown | undefined = undefined;

  private controller: AbortController | undefined = undefined;

  private lastKey: K | undefined = undefined;

  constructor(options: StreamOptions<T, M, K>) {
    this.options = options;
    this.folded = options.initial;
    this.value = signal<T>(options.initial);

    const step = options.reduce;

    if (step === undefined) {
      // The type admits exactly one reducer, so `reduce` being absent narrows
      // this to the one that is there.
      const all = options.reduceMany;

      this.absorb = (message) => {
        this.pending.push(message);
      };

      this.commit = () => {
        this.foldPending(all);
      };

      return;
    }

    this.absorb = (message) => {
      this.folded = step(this.folded, message);
    };

    this.commit = () => {
      this.value.set(this.folded);
    };
  }

  /** Watches the key and dies with the module that made it (SPEC §5b). */
  start(): void {
    watch(() => {
      this.rekey(this.options.key());
    });

    onDispose(() => {
      this.stop();
    });
  }

  /** The scheduler's frame: one commit, whatever arrived since the last one. */
  update(): void {
    this.commit();
  }

  private foldPending(all: (previous: T, messages: readonly M[]) => T): void {
    const messages = this.pending;

    // A key change empties the buffer, so a commit already queued for the old
    // key would otherwise fold nothing into the new one and call `reduceMany`
    // with nothing in it.
    if (messages.length > 0) {
      this.pending = [];
      this.folded = all(this.folded, messages);
    }

    this.value.set(this.folded);
  }

  /** A new key is a different subscription, and a different fold. */
  private rekey(key: K): void {
    const last = this.lastKey;

    if (last !== undefined && sameKey(last, key)) return;

    this.stop();
    this.lastKey = key;
    this.folded = this.options.initial;
    this.pending = [];

    batch(() => {
      this.value.set(this.options.initial);
      this.errorSignal.set(undefined);
    });

    this.open(key);
  }

  private open(key: K): void {
    const id = ++this.generation;
    const controller = new AbortController();

    this.controller = controller;
    this.statusSignal.set(StreamStatus.Connecting);

    try {
      const opened = this.options.subscribe({
        key,
        signal: controller.signal,
        emit: (message) => {
          this.receive(id, message);
        },
        close: (reason) => {
          this.closed(id, reason);
        },
      });

      if (opened instanceof Promise) void this.connect(id, opened);
      else this.opened(id, opened);
    } catch (error: unknown) {
      this.closed(id, error);
    }
  }

  private async connect(id: number, opening: Promise<Teardown>): Promise<void> {
    try {
      this.opened(id, await opening);
    } catch (error: unknown) {
      this.closed(id, error);
    }
  }

  private opened(id: number, teardown: Teardown): void {
    // The key moved on while the handshake was in flight. Nobody wants this
    // subscription, so it is closed as soon as it is something that can be.
    if (id !== this.generation) {
      teardown();

      return;
    }

    this.teardown = teardown;
    this.statusSignal.set(StreamStatus.Open);
  }

  private closed(id: number, reason: unknown): void {
    if (id !== this.generation) return;

    batch(() => {
      if (reason !== undefined) this.errorSignal.set(toError(reason));

      this.statusSignal.set(StreamStatus.Closed);
    });
  }

  private receive(id: number, message: M): void {
    if (id !== this.generation) return;

    this.absorb(message);
    enqueue(this);
  }

  /** Ends the subscription so nothing it sends afterwards reaches the fold. */
  private stop(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = undefined;
    this.teardown?.();
    this.teardown = undefined;
  }
}

/**
 * Push data on a reactive key. The subscription is torn down when the key
 * changes and when the owning module unmounts; messages are folded as they
 * arrive and the value is committed once per frame, so a flood coalesces
 * instead of queueing. Legal in `*.effects.ts` only (`SHR-L004`).
 *
 * @example
 * const ticks = stream({
 *   key: () => ['ticks', symbol()] as const,
 *   subscribe: ({ key, emit }) => socket.on(key[1], emit),
 *   reduce: (total, tick) => total + tick.size,
 *   initial: 0,
 * });
 */
export function stream<T, M, K extends readonly unknown[]>(
  options: StreamOptions<T, M, K>,
): Stream<T> {
  const node = new StreamNode(options);

  const read = ((): DeepReadonly<T> => node.value()) as Stream<T>;

  read.status = (): StreamStatus => node.statusSignal();
  read.error = (): Error | undefined => node.errorSignal();

  node.start();

  return read;
}
