// The seeded fixture every task and both arms are measured against
// (EVAL-TASKS §1.3). Deterministic: no clock, no randomness, no ordering that
// depends on how fast a caller asks.
//
// These rows are deliberately a second copy of the ones in
// `hosts/services/api.fixture.ts`, which serves the self-repair sub-eval in
// process. The duplication is the point: `evalkit` is frozen with the task
// harness, and the host app is a tree agents edit. Neither may move because
// the other did. The two must agree on the numbers below, and the test
// `data.test.ts` is what says so.

/** A row of `GET /api/customers`. */
export interface Customer {
  readonly id: number;
  readonly name: string;
  readonly company: string;
  readonly country: string;
}

/** A row of `GET /api/orders`. */
export interface Order {
  readonly id: number;
  readonly customer: string;
  readonly status: string;
}

/** A tradeable symbol, for the price socket. */
export interface Instrument {
  readonly symbol: string;
  readonly name: string;
  /** The price the seeded generator walks away from. */
  readonly open: number;
}

/** Who the session says is signed in. */
export interface Session {
  readonly user: string;
  readonly company: string;
}

/** How many rows `GET /api/customers` answers with. T01 asserts on this. */
export const CUSTOMER_COUNT = 25;

const COUNTRIES = ['Netherlands', 'Japan'] as const;

/** The customers, in server order. Identical for every run and every arm. */
export const CUSTOMERS: readonly Customer[] = Array.from(
  { length: CUSTOMER_COUNT },
  (_unused, index) => ({
    id: index + 1,
    name: `Customer ${String(index + 1)}`,
    company: `Company ${String(index + 1)}`,
    country: COUNTRIES[index % COUNTRIES.length] ?? COUNTRIES[0],
  }),
);

/** The orders T04 toggles. None of them starts shipped. */
export const ORDERS: readonly Order[] = [
  { id: 101, customer: 'Customer 1', status: 'pending' },
  { id: 102, customer: 'Customer 2', status: 'packing' },
  { id: 103, customer: 'Customer 3', status: 'pending' },
];

/** The statuses an order may hold. `shipped` is the one T04 writes. */
export const Status = { Pending: 'pending', Packing: 'packing', Shipped: 'shipped' } as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

/** Symbols the price socket streams (T05). */
export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: 'ACME', name: 'Acme Industries', open: 100 },
  { symbol: 'BOLT', name: 'Bolt Logistics', open: 42.5 },
  { symbol: 'CDNS', name: 'Cadence Freight', open: 318 },
];

/** Who `GET /api/session` says is signed in. */
export const SESSION: Session = { user: 'Ada Bakker', company: 'Company 1' };

/** The id `POST /api/orders` hands back for the first accepted draft. */
export const FIRST_NEW_ORDER_ID = 900;

/** The smallest quantity `POST /api/orders` accepts. */
export const QUANTITY_MIN = 1;

/** The largest quantity `POST /api/orders` accepts. */
export const QUANTITY_MAX = 1000;

/** The longest note `POST /api/orders` accepts, in characters. */
export const NOTE_MAX = 200;
