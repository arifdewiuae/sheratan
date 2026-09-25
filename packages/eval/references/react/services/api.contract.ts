// The interface every module depends on. Nothing above this line knows whether
// the data arrives over HTTP, a socket, or a fixture.
//
// Deliberately the same file as the Sheratan reference's contract, to the
// letter: it describes the backend, which both arms share, and a contract that
// differed between the arms would make them different measurements.

/** A row of `GET /api/customers` (EVAL-TASKS T01). */
export interface Customer {
  readonly id: number;
  readonly name: string;
  readonly company: string;
  readonly country: string;
}

/** A row of `GET /api/orders` (EVAL-TASKS T04). */
export interface Order {
  readonly id: number;
  readonly customer: string;
  readonly status: string;
}

/** The body `POST /api/orders` accepts (EVAL-TASKS T03). */
export interface OrderDraft {
  readonly customerId: number;
  readonly quantity: number;
  readonly note: string;
}

/** What the server says when it refuses a draft: `422 { errors }`. */
export interface Rejected {
  readonly errors: Readonly<Record<string, string>>;
}

/**
 * A refusal the server explains field by field: `422 { errors }`. It is an
 * `Error` as well as a {@link Rejected}, so a caller that only knows about
 * errors still gets a message.
 */
export class RejectedError extends Error implements Rejected {
  readonly errors: Readonly<Record<string, string>>;

  constructor(errors: Readonly<Record<string, string>>) {
    super('The server rejected the order.');
    this.errors = errors;
  }
}

/** The API this app is written against. Every promise-returning call takes a signal. */
export interface Api {
  customers(signal: AbortSignal): Promise<readonly Customer[]>;
  orders(signal: AbortSignal): Promise<readonly Order[]>;
  createOrder(draft: OrderDraft, signal: AbortSignal): Promise<number>;
  shipOrder(id: number, signal: AbortSignal): Promise<void>;
}
