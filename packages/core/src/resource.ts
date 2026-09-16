// Async in the core (SPEC §6). One primitive covers what an app otherwise
// assembles out of a query library: fetch on a reactive key, cancel the
// request the key replaced, retry with backoff, and revalidate a value once it
// has gone stale. The three guarantees that make it worth having in core are
// in `run()`: a superseded response is discarded, a cancelled one is not a
// failure, and the request itself is aborted rather than merely ignored.

import { isAbort, sameKey, toError } from './async.ts';
import { onDispose } from './owner.ts';
import { batch } from './scheduler.ts';
import { signal } from './signal.ts';
import type { Accessor, DeepReadonly, Signal } from './types.ts';
import { watch } from './watch.ts';

/** How long the first retry waits. Later attempts scale from this. */
const RETRY_BASE_MS = 100;

/** Exponential backoff doubles the wait on every attempt. */
const BACKOFF_FACTOR = 2;

/** Where a resource is, between its first request and a value or an error. */
export const ResourceStatus = {
  /** Nothing in flight and nothing to show. Reached only through `abort()`. */
  Idle: 'idle',
  /** A first request for the current key is in flight; `data()` is empty. */
  Loading: 'loading',
  /** `data()` holds the value for the current key. */
  Ready: 'ready',
  /** The last request failed. `error()` says how, and `data()` is untouched. */
  Error: 'error',
  /** Revalidating, with the previous value still on screen. */
  Refreshing: 'refreshing',
} as const;

/** One of the five states a resource can be in. */
export type ResourceStatus = (typeof ResourceStatus)[keyof typeof ResourceStatus];

/** How the wait between retries grows. */
export const Backoff = {
  /** Doubles every attempt: 100 ms, then 200 ms, then 400 ms. */
  Exponential: 'exponential',
  /** The same 100 ms wait every attempt. */
  Fixed: 'fixed',
} as const;

/** One of the backoff strategies. */
export type Backoff = (typeof Backoff)[keyof typeof Backoff];

/** What a fetcher is handed: the key that asked, and the signal that cancels. */
export interface FetchContext<K extends readonly unknown[]> {
  /** The key this request is for, as the key accessor returned it. */
  readonly key: K;
  /** Aborts when the key changes, when `abort()` is called, and on unmount. */
  readonly signal: AbortSignal;
}

/** How a resource is described. Only `key` and `fetch` are required. */
export interface ResourceOptions<T, K extends readonly unknown[]> {
  /** Reactive: a key with new contents refetches, an equal one does not. */
  readonly key: Accessor<K>;
  /** The request. It must pass `signal` on, or cancellation is cosmetic. */
  readonly fetch: (context: FetchContext<K>) => Promise<T>;
  /** Milliseconds a value stays fresh; after that it revalidates in place. */
  readonly staleAfter?: number;
  /** Attempts counts the first try, so `3` means one try and two retries. */
  readonly retry?: {
    readonly attempts: number;
    readonly backoff: Backoff;
  };
}

/**
 * Async state as three independent signals, so a hole that renders a spinner
 * reads `status()` alone and is not woken when the value arrives (SPEC §6).
 */
export interface Resource<T> {
  /** Where the resource is. */
  status(): ResourceStatus;
  /** The value for the current key, retained while it is being revalidated. */
  data(): DeepReadonly<T> | undefined;
  /** Why the last request failed. Cancellation never lands here (SPEC §5b). */
  error(): Error | undefined;
  /** Reads `status()`, and narrows `data()` or `error()` with what it finds. */
  is(status: 'ready' | 'refreshing'): this is LoadedResource<T>;
  is(status: 'error'): this is FailedResource<T>;
  is(status: ResourceStatus): boolean;
  /** Refetches the current key. A request already in flight absorbs the call. */
  invalidate(): void;
  /** Cancels what is in flight. The resource keeps whatever value it had. */
  abort(): void;
}

/** A resource that has a value: what `is('ready')` and `is('refreshing')` prove. */
export interface LoadedResource<T> extends Resource<T> {
  data(): DeepReadonly<T>;
}

/** A resource that failed: what `is('error')` proves. */
export interface FailedResource<T> extends Resource<T> {
  error(): Error;
}

function delayFor(tries: number, backoff: Backoff): number {
  if (backoff === Backoff.Fixed) return RETRY_BASE_MS;

  return RETRY_BASE_MS * BACKOFF_FACTOR ** (tries - 1);
}

/** Resolves after `ms`, or the moment the request is cancelled. */
function wait(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    const stop = (): void => {
      clearTimeout(timer);
      resolve();
    };

    abort.addEventListener('abort', stop, { once: true });
  });
}

class ResourceNode<T, K extends readonly unknown[]> implements Resource<T> {
  private readonly options: ResourceOptions<T, K>;

  private readonly statusSignal: Signal<ResourceStatus> = signal<ResourceStatus>(
    ResourceStatus.Loading,
  );

  private readonly dataSignal: Signal<T | undefined> = signal<T | undefined>(undefined);

  private readonly errorSignal: Signal<Error | undefined> = signal<Error | undefined>(undefined);

  /** Bumped by every request, so an older one can tell it has been replaced. */
  private generation = 0;

  private controller: AbortController | undefined = undefined;

  private staleTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  private lastKey: K | undefined = undefined;

  /** Mirrors `dataSignal`, so deciding to refresh never reads a signal. */
  private loaded = false;

  // Accessors are fields, not methods: a template hole takes the function
  // itself (`${user.data}`), so it cannot depend on how it was called.
  readonly status = (): ResourceStatus => this.statusSignal();

  readonly data = (): DeepReadonly<T> | undefined => this.dataSignal();

  readonly error = (): Error | undefined => this.errorSignal();

  readonly invalidate = (): void => {
    // A request in flight is the refetch this call is asking for: identical
    // keys are deduplicated, so a burst of invalidations costs one request.
    if (this.controller !== undefined) return;

    void this.run(this.options.key(), this.loaded);
  };

  readonly abort = (): void => {
    if (this.controller === undefined) return;

    this.cancel();
    this.statusSignal.set(this.loaded ? ResourceStatus.Ready : ResourceStatus.Idle);
  };

  constructor(options: ResourceOptions<T, K>) {
    this.options = options;
  }

  is(status: 'ready' | 'refreshing'): this is LoadedResource<T>;
  is(status: 'error'): this is FailedResource<T>;
  is(status: ResourceStatus): boolean;
  is(status: ResourceStatus): boolean {
    return this.statusSignal() === status;
  }

  /** Watches the key and dies with the module that made it (SPEC §5b). */
  start(): void {
    watch(() => {
      this.rekey(this.options.key());
    });

    onDispose(() => {
      this.cancel();
    });
  }

  /** A new key is a different question, so the old answer stops being shown. */
  private rekey(key: K): void {
    const last = this.lastKey;

    if (last !== undefined && sameKey(last, key)) return;

    this.loaded = false;

    batch(() => {
      this.dataSignal.set(undefined);
      this.errorSignal.set(undefined);
    });

    void this.run(key, false);
  }

  private async run(key: K, refresh: boolean): Promise<void> {
    // Whatever was in flight answers a question nobody is asking any more, and
    // SPEC §5b wants it cancelled at the network level, not merely ignored.
    this.cancel();

    const id = this.generation;
    const controller = new AbortController();

    this.lastKey = key;
    this.controller = controller;
    this.statusSignal.set(refresh ? ResourceStatus.Refreshing : ResourceStatus.Loading);

    try {
      const value = await this.attempt(key, controller.signal, 1);

      if (id === this.generation) this.settle(value);
    } catch (error: unknown) {
      // Two ways to arrive here without a failure to report: a newer request
      // has already replaced this one, or this one was cancelled.
      if (id === this.generation && !isAbort(error)) this.fail(toError(error));
    } finally {
      if (id === this.generation) this.controller = undefined;
    }
  }

  /** Recursive rather than a loop: a retry waits, and waits cannot sit in one. */
  private async attempt(key: K, abort: AbortSignal, tries: number): Promise<T> {
    try {
      return await this.options.fetch({ key, signal: abort });
    } catch (error: unknown) {
      const delay = this.backoffFor(tries, error, abort);

      if (delay === undefined) throw error;

      await wait(delay, abort);

      if (abort.aborted) throw error;

      return this.attempt(key, abort, tries + 1);
    }
  }

  /** How long before the next attempt, or nothing when there is not one. */
  private backoffFor(tries: number, error: unknown, abort: AbortSignal): number | undefined {
    const retry = this.options.retry;

    if (retry === undefined || tries >= retry.attempts) return undefined;

    if (abort.aborted || isAbort(error)) return undefined;

    return delayFor(tries, retry.backoff);
  }

  private settle(value: T): void {
    this.loaded = true;

    batch(() => {
      this.dataSignal.set(value);
      this.errorSignal.set(undefined);
      this.statusSignal.set(ResourceStatus.Ready);
    });

    this.scheduleStale();
  }

  /** The value stays: an error beside stale data beats an empty screen. */
  private fail(error: Error): void {
    batch(() => {
      this.errorSignal.set(error);
      this.statusSignal.set(ResourceStatus.Error);
    });
  }

  private scheduleStale(): void {
    const after = this.options.staleAfter;

    if (after === undefined) return;

    this.staleTimer = setTimeout(() => {
      this.invalidate();
    }, after);
  }

  private clearStale(): void {
    if (this.staleTimer === undefined) return;

    clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
  }

  /** Ends everything pending so no late response and no timer can land. */
  private cancel(): void {
    this.generation += 1;
    this.clearStale();
    this.controller?.abort();
    this.controller = undefined;
  }
}

/**
 * Async state on a reactive key. The request is aborted when the key changes,
 * when `abort()` is called and when the owning module unmounts; an identical
 * key is not refetched, a superseded response is discarded, and errors are
 * values. Legal in `*.effects.ts` only (`SHR-L004`).
 *
 * @example
 * const user = resource({
 *   key: () => ['user', userId()] as const,
 *   fetch: ({ key, signal }) => api.getUser(key[1], signal),
 *   staleAfter: 30_000,
 * });
 */
export function resource<T, K extends readonly unknown[]>(
  options: ResourceOptions<T, K>,
): Resource<T> {
  const node = new ResourceNode(options);

  node.start();

  return node;
}
