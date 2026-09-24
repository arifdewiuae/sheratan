// When a route answers. Latency and reversal live here rather than inside the
// handlers, so every route is delayed the same way and a task cannot be made
// accidentally easier by the order its handler was written in.

import { count, Route, type State } from './state.ts';

/**
 * How far apart a reversed route spaces its answers. It has to exceed the gap
 * between the requests being raced — T02 types three characters — or the
 * answers arrive in the order they were asked for and the task proves nothing.
 */
const REVERSE_STEP_MS = 120;

/** How many answers a reversed route can hold before the spacing runs out. */
const REVERSE_DEPTH = 4;

/**
 * Milliseconds this call waits. A reversed route gives the *earliest* caller
 * the longest wait, so answers land in the opposite order to the asks; once
 * past {@link REVERSE_DEPTH} it degrades to no extra delay rather than going
 * negative.
 */
export function delayFor(state: State, route: Route): number {
  const latency = state.latency.get(route) ?? 0;

  if (!state.reversed.has(route)) return latency;

  const arrival = state.arrivals.get(route) ?? 0;

  state.arrivals.set(route, arrival + 1);

  const remaining = Math.max(REVERSE_DEPTH - arrival, 0);

  return latency + remaining * REVERSE_STEP_MS;
}

/** Resolves after `ms`, and never holds the process open. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();

      return;
    }

    setTimeout(resolve, ms).unref();
  });
}

/** What a route answers instead of its data, when a run has queued something. */
export interface Refusal {
  readonly status: number;
  readonly message: string;
  /** Field errors, when the queued status is a 422 (EVAL-TASKS §6). */
  readonly errors?: Record<string, string>;
}

/** The session check runs on every route, including the session route itself. */
const EXPIRED: Refusal = { status: 401, message: 'session expired' };

/**
 * The refusal this call owes, if any. Consumes one queued failure, so `fail`
 * with a count of 2 refuses exactly twice.
 */
export function refusalFor(state: State, route: Route): Refusal | undefined {
  if (state.sessionExpired) return EXPIRED;

  const failure = state.failures.get(route);

  if (failure === undefined) return undefined;

  failure.remaining -= 1;

  if (failure.remaining <= 0) state.failures.delete(route);

  return failure.errors === undefined
    ? { status: failure.status, message: failure.message }
    : { status: failure.status, message: failure.message, errors: failure.errors };
}

/** Records that a call arrived. Every route's first act. */
export function arrived(state: State, route: Route): void {
  count(state.received, route);
}

export { Route };
