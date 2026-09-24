// Everything a run can change about the server, in one place, so `reset`
// is one assignment and a leaked knob cannot outlive a task (EVAL-TASKS §1.3).
//
// The control and inspection surfaces are the only writers. Nothing under
// `/api` may reach in and mutate a knob, or the backend stops being the fixed
// point every arm is measured against.

import { ORDERS, type Order } from './data.ts';

/** The routes latency, failures and ordering can be aimed at. */
export const Route = {
  Customers: 'customers',
  Orders: 'orders',
  CreateOrder: 'createOrder',
  ShipOrder: 'shipOrder',
  Session: 'session',
} as const;

/** One of {@link Route}. */
export type Route = (typeof Route)[keyof typeof Route];

const ROUTES: readonly Route[] = Object.values(Route);

/** A queued refusal: the next `remaining` calls answer `status` instead. */
export interface Failure {
  remaining: number;
  readonly status: number;
  readonly message: string;
  /** Field errors to send instead of `{ error }`, when the status is a 422. */
  readonly errors?: Record<string, string>;
}

/** What a run has done to the server, and what the server has seen. */
export interface State {
  /** Milliseconds a route waits before answering. */
  readonly latency: Map<Route, number>;
  readonly failures: Map<Route, Failure>;
  /** Routes answering in reverse arrival order, for the race tasks. */
  readonly reversed: Set<Route>;
  /** How many calls a reversed route has taken, so each gets its own delay. */
  readonly arrivals: Map<Route, number>;
  readonly received: Map<Route, number>;
  /** Calls whose caller went away before the answer was written. */
  readonly aborted: Map<Route, number>;
  orders: readonly Order[];
  /** Drafts `POST /api/orders` accepted, in order. */
  readonly drafts: unknown[];
  nextOrderId: number;
  sessionExpired: boolean;
}

/** A counter map with every route at zero, so a reader never sees `undefined`. */
function zeroed(): Map<Route, number> {
  return new Map(ROUTES.map((route) => [route, 0]));
}

/**
 * A server with nothing done to it. `reset` builds one of these, which is why
 * adding a knob above cannot leave `reset` behind.
 */
export function freshState(nextOrderId: number): State {
  return {
    latency: new Map(),
    failures: new Map(),
    reversed: new Set(),
    arrivals: zeroed(),
    received: zeroed(),
    aborted: zeroed(),
    orders: ORDERS,
    drafts: [],
    nextOrderId,
    sessionExpired: false,
  };
}

/** Adds one to a route's tally. */
export function count(tally: Map<Route, number>, route: Route): void {
  tally.set(route, (tally.get(route) ?? 0) + 1);
}

/** A tally as JSON, for `/__inspect`: every route present, in a stable order. */
export function tallyOf(tally: Map<Route, number>): Record<string, number> {
  return Object.fromEntries(ROUTES.map((route) => [route, tally.get(route) ?? 0]));
}
