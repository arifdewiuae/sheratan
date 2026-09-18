// Writes in the core (SPEC §6). `resource()` reads; this is its write path:
// an optimistic transition the moment a run is asked for, the request, and
// then either what follows a success or the rollback of a write that did not
// land. Runs are serialized, so two saves of one form cannot race each other
// to the server and land in the wrong order.

import { isAbort, toError } from './async.ts';
import { onDispose } from './owner.ts';
import { batch } from './scheduler.ts';
import { signal } from './signal.ts';
import type { Signal } from './types.ts';

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

/** What `run` is handed: the input it was called with, and the signal that cancels. */
export interface MutationContext<I> {
  /** The input passed to `mutation.run(input)`. */
  readonly input: I;
  /** Aborts when the owning module unmounts. Pass it on, or cancellation is cosmetic. */
  readonly signal: AbortSignal;
}

/** How a mutation is described. Only `run` is required. */
export interface MutationOptions<I, R> {
  /** The request that performs the write. */
  readonly run: (context: MutationContext<I>) => Promise<R>;
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
   * Queues a run behind any in flight. Resolves when this run has settled and
   * never rejects: the outcome is in `status()` and `error()`.
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

  private readonly queue: Queued<I>[] = [];

  private controller: AbortController | undefined = undefined;

  private draining = false;

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

    return new Promise<void>((settle) => {
      this.queue.push({ input, settle });

      if (!this.draining) void this.drain();
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
   * One request on the wire at a time, in the order they were asked for.
   * Recursive rather than a loop: serial awaiting is the point, and a loop
   * that awaits reads as an accident.
   */
  private async drain(): Promise<void> {
    const next = this.queue.shift();

    this.draining = next !== undefined;

    if (next === undefined) return;

    await this.execute(next.input);
    next.settle();

    return this.drain();
  }

  private async execute(input: I): Promise<void> {
    const controller = new AbortController();

    this.controller = controller;

    try {
      const result = await this.options.run({ input, signal: controller.signal });

      if (!this.disposed) this.succeed(result, input);
    } catch (error: unknown) {
      if (!this.disposed) this.fail(input, error);
    }

    this.controller = undefined;
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

  /** Records a run's outcome; the status stays `running` while the queue still has work. */
  private settle(outcome: MutationStatus, error: Error | undefined): void {
    batch(() => {
      this.errorSignal.set(error);
      this.statusSignal.set(this.queue.length > 0 ? MutationStatus.Running : outcome);
    });
  }

  /** Aborts the request in flight and releases every run still waiting. */
  private stop(): void {
    this.disposed = true;
    this.controller?.abort();

    for (const queued of this.queue) queued.settle();

    this.queue.length = 0;
  }
}

/**
 * A write with its optimistic update, rollback and follow-up specified rather
 * than left to each app. Runs are serialized; `optimistic` and `rollback` are
 * transitions, never direct writes; a failure is a value in `error()`, and a
 * cancelled run is not a failure. Unmounting aborts the request in flight and
 * drops the queue. Legal in `*.effects.ts` only (`SHR-L004`).
 *
 * @example
 * const save = mutation({
 *   run: ({ input, signal }) => api.saveOrder(input, signal),
 *   optimistic: (input) => state.orderDraftApplied(input),
 *   rollback: (input) => state.orderDraftReverted(input),
 *   onSuccess: () => orders.invalidate(),
 * });
 *
 * void save.run(draft);
 */
export function mutation<I, R>(options: MutationOptions<I, R>): Mutation<I> {
  const node = new MutationNode(options);

  node.start();

  return node;
}
