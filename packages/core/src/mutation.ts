// Writes in the core (SPEC §6), alongside `resource()` for reads. The two need
// opposite rules — a newer read makes the older one worthless, a newer write
// makes the older one no less real — so they are two primitives, not one.
// A run is an optimistic transition the moment it is asked for, the request,
// and then either what follows a success or the rollback of a write that did
// not land. Runs for one key are serialized, so two saves of one record cannot
// race to the server and land in the wrong order; different keys do not wait.

import { isAbort, toError } from './async.ts';
import { onDispose } from './owner.ts';
import { batch } from './scheduler.ts';
import { signal } from './signal.ts';
import type { Signal } from './types.ts';

/** Every run shares this lane when no `key` is given. */
const UNKEYED: unique symbol = Symbol('unkeyed');

/** Where a mutation is. Every state but `running` is the outcome of the last run to settle. */
export const MutationStatus = {
  /** Never run, or the last run was cancelled. */
  Idle: 'idle',
  /** A run is in flight or waiting its turn. */
  Running: 'running',
  /** The last run to settle succeeded. */
  Done: 'done',
  /** The last run to settle failed; `error()` says how. */
  Error: 'error',
} as const;

/** One of the four states a mutation can be in. */
export type MutationStatus = (typeof MutationStatus)[keyof typeof MutationStatus];

/** What `send` is handed: the input it was called with, and the signal that cancels. */
export interface MutationContext<I> {
  /** The input passed to `mutation.run(input)`. */
  readonly input: I;
  /** Aborts when the owning module unmounts. Pass it on, or cancellation is cosmetic. */
  readonly signal: AbortSignal;
}

/** How a mutation is described. Only `send` is required. */
export interface MutationOptions<I, R> {
  /** The request that performs the write. It must pass `signal` on. */
  readonly send: (context: MutationContext<I>) => Promise<R>;
  /**
   * Which record a run writes. Runs with the same key wait for each other;
   * runs with different keys are in flight at once. Without it, every run
   * waits for the one before.
   */
  readonly key?: (input: I) => string | number;
  /** A transition applied before the request, so the screen does not wait for it. */
  readonly optimistic?: (input: I) => void;
  /** A transition that undoes `optimistic` when the write did not land. */
  readonly rollback?: (input: I) => void;
  /** Runs after a write lands — usually `resource.invalidate()` on what it changed. */
  readonly onSuccess?: (result: R, input: I) => void;
}

/** A write path: run it with an input, read how the last run went. */
export interface Mutation<I> {
  /** Where the mutation is. */
  status(): MutationStatus;
  /** Why the last run to settle failed. Cancellation never lands here (SPEC §5b). */
  error(): Error | undefined;
  /**
   * Applies `optimistic` and sends the write, behind any run in flight for the
   * same key. Resolves when this run has settled and never rejects: the
   * outcome is in `status()` and `error()`.
   */
  run(input: I): Promise<void>;
}

/** A run that has been asked for and not started. */
interface Queued<I> {
  readonly input: I;
  readonly settle: () => void;
}

class MutationNode<I, R> implements Mutation<I> {
  private readonly options: MutationOptions<I, R>;

  private readonly statusSignal: Signal<MutationStatus> = signal<MutationStatus>(
    MutationStatus.Idle,
  );

  private readonly errorSignal: Signal<Error | undefined> = signal<Error | undefined>(undefined);

  /** Runs waiting per key. A lane exists exactly while its key has a run in flight. */
  private readonly lanes = new Map<string | number | typeof UNKEYED, Queued<I>[]>();

  private readonly inFlight = new Set<AbortController>();

  /** Runs asked for and not yet settled, across every lane. */
  private unsettled = 0;

  private disposed = false;

  // Fields, not methods, for the same reason as `resource()`: a hole takes the
  // function itself, and an intent may be handed `save.run` directly.
  readonly status = (): MutationStatus => this.statusSignal();

  readonly error = (): Error | undefined => this.errorSignal();

  readonly run = (input: I): Promise<void> => {
    // SPEC §5b rule 1: the module is gone, and so is the state these
    // transitions would write to.
    if (this.disposed) return Promise.resolve();

    batch(() => {
      this.options.optimistic?.(input);
      this.statusSignal.set(MutationStatus.Running);
    });

    this.unsettled += 1;

    const key = this.options.key === undefined ? UNKEYED : this.options.key(input);

    return new Promise<void>((settle) => {
      const lane = this.lanes.get(key);

      if (lane !== undefined) {
        lane.push({ input, settle });

        return;
      }

      this.lanes.set(key, []);
      void this.drain(key, { input, settle });
    });
  };

  constructor(options: MutationOptions<I, R>) {
    this.options = options;
  }

  /** Dies with the module that made it (SPEC §5b). */
  start(): void {
    onDispose(() => {
      this.stop();
    });
  }

  /**
   * One request per key on the wire, in the order they were asked for.
   * Recursive rather than a loop: serial awaiting is the point, and a loop
   * that awaits reads as an accident.
   */
  private async drain(key: string | number | typeof UNKEYED, run: Queued<I>): Promise<void> {
    await this.execute(run.input);
    run.settle();

    const next = this.lanes.get(key)?.shift();

    if (next === undefined) {
      this.lanes.delete(key);

      return;
    }

    return this.drain(key, next);
  }

  private async execute(input: I): Promise<void> {
    const controller = new AbortController();

    this.inFlight.add(controller);

    try {
      const result = await this.options.send({ input, signal: controller.signal });

      if (!this.disposed) this.succeed(result, input);
    } catch (error: unknown) {
      if (!this.disposed) this.fail(input, error);
    }

    this.inFlight.delete(controller);
  }

  /** The write landed: whatever throws after it is reported, and nothing is rolled back. */
  private succeed(result: R, input: I): void {
    try {
      this.options.onSuccess?.(result, input);
    } catch (error: unknown) {
      this.settle(MutationStatus.Error, toError(error));

      return;
    }

    this.settle(MutationStatus.Done, undefined);
  }

  /** The write did not land, so the optimistic change goes; a cancellation is not a failure. */
  private fail(input: I, error: unknown): void {
    batch(() => {
      this.options.rollback?.(input);

      if (isAbort(error)) {
        this.settle(MutationStatus.Idle, undefined);
      } else {
        this.settle(MutationStatus.Error, toError(error));
      }
    });
  }

  /** Records a run's outcome; the status stays `running` while any other run is unsettled. */
  private settle(outcome: MutationStatus, error: Error | undefined): void {
    this.unsettled -= 1;

    batch(() => {
      this.errorSignal.set(error);
      this.statusSignal.set(this.unsettled > 0 ? MutationStatus.Running : outcome);
    });
  }

  /** Aborts every request in flight and releases every run still waiting. */
  private stop(): void {
    this.disposed = true;

    for (const controller of this.inFlight) controller.abort();

    for (const lane of this.lanes.values()) {
      for (const queued of lane) queued.settle();
    }

    this.lanes.clear();
  }
}

/**
 * A write with its optimistic update, rollback and follow-up specified rather
 * than left to each app. Runs for one `key` are serialized and different keys
 * run at once; `optimistic` and `rollback` are transitions, passed by
 * reference; a failure is a value in `error()`, and a cancelled run is not a
 * failure. Unmounting aborts every request in flight and drops the queue.
 * Legal in `*.effects.ts` only (`SHR-L004`).
 *
 * @example
 * const ship = mutation({
 *   key: (order) => order.id,
 *   send: ({ input, signal }) => api.shipOrder(input.id, signal),
 *   optimistic: state.orderShipped,
 *   rollback: state.orderShipReverted,
 *   onSuccess: orders.invalidate,
 * });
 *
 * void ship.run(order);
 */
export function mutation<I, R>(options: MutationOptions<I, R>): Mutation<I> {
  const node = new MutationNode(options);

  node.start();

  return node;
}
