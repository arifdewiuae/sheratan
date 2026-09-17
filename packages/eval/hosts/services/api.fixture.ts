// The adapter the host app's behaviour suite runs against (SPEC §4b). It is a
// fixture, not a mock of the modules: it answers the contract, and the test
// decides when and how it answers.

import type { Api, Customer, Order, OrderDraft } from './api.contract.ts';

const COUNTRIES = ['Netherlands', 'Japan'] as const;

/** The 25 rows T01 asserts on, in server order. */
export const CUSTOMERS: readonly Customer[] = Array.from({ length: 25 }, (_unused, index) => ({
  id: index + 1,
  name: `Customer ${String(index + 1)}`,
  company: `Company ${String(index + 1)}`,
  country: COUNTRIES[index % COUNTRIES.length] ?? COUNTRIES[0],
}));

/** The orders T04 ships, none of them already shipped. */
export const ORDERS: readonly Order[] = [
  { id: 101, customer: 'Customer 1', status: 'pending' },
  { id: 102, customer: 'Customer 2', status: 'packing' },
  { id: 103, customer: 'Customer 3', status: 'pending' },
];

/** The id `createOrder` hands back when nothing is queued to fail. */
export const NEW_ORDER_ID = 900;

/** Which call a test is holding open or failing. */
export type Route = 'customers' | 'orders' | 'createOrder' | 'shipOrder';

/** What a test does to the server between assertions. */
export interface Control {
  /** Every later call to this route waits until {@link Control.release}. */
  hold(route: Route): void;
  /** Settles the calls held on a route, in the order they arrived. */
  release(route: Route): void;
  /** The next call to this route rejects with `error`. */
  fail(route: Route, error: Error): void;
  /** Every call the app has made, in order. */
  calls(): readonly string[];
  /** The bodies `createOrder` received. */
  drafts(): readonly OrderDraft[];
  /** Replaces what `orders` answers with, for the reload assertions. */
  setOrders(rows: readonly Order[]): void;
}

/** The fixture API plus the handle a test steers it with. */
export interface Fixture {
  readonly api: Api;
  readonly control: Control;
}

/** Decides whether a call waits, rejects or answers. One place, every route. */
interface Server {
  answer<T>(route: Route, value: () => T, signal: AbortSignal): Promise<T>;
  readonly control: Control;
  readonly drafts: OrderDraft[];
  orders(this: void): readonly Order[];
}

function createServer(): Server {
  const held = new Set<Route>();
  const waiting = new Map<Route, (() => void)[]>();
  const failures = new Map<Route, Error[]>();
  const calls: string[] = [];
  const drafts: OrderDraft[] = [];
  let orders = ORDERS;

  const wait = async (route: Route): Promise<void> => {
    await new Promise<void>((resolve) => {
      const pending = waiting.get(route) ?? [];

      pending.push(resolve);
      waiting.set(route, pending);
    });
  };

  return {
    async answer<T>(route: Route, value: () => T, signal: AbortSignal): Promise<T> {
      calls.push(route);

      if (held.has(route)) await wait(route);

      signal.throwIfAborted();

      const failure = (failures.get(route) ?? []).shift();

      if (failure !== undefined) throw failure;

      return value();
    },

    drafts,
    orders: () => orders,

    control: {
      hold: (route) => void held.add(route),

      release(route: Route): void {
        held.delete(route);

        for (const settle of waiting.get(route) ?? []) settle();

        waiting.delete(route);
      },

      fail(route: Route, error: Error): void {
        const queued = failures.get(route) ?? [];

        queued.push(error);
        failures.set(route, queued);
      },

      calls: () => calls,
      drafts: () => drafts,
      setOrders: (rows) => void (orders = rows),
    },
  };
}

/** Builds a fresh server. Each test gets its own; nothing is shared. */
export function createFixture(): Fixture {
  const server = createServer();

  return {
    api: {
      customers: async (signal) => server.answer('customers', () => CUSTOMERS, signal),
      orders: async (signal) => server.answer('orders', server.orders, signal),
      createOrder: async (draft, signal) =>
        server.answer(
          'createOrder',
          () => {
            server.drafts.push(draft);

            return NEW_ORDER_ID;
          },
          signal,
        ),
      shipOrder: async (_id, signal) => server.answer('shipOrder', () => undefined, signal),
    },

    control: server.control,
  };
}
