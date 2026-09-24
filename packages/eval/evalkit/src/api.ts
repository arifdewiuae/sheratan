// `/api/*` — everything an agent is allowed to see (EVAL-TASKS §1.3, §6).
// Each handler answers its own route and nothing else; arriving, waiting,
// refusing and abort-counting are done once, around them, in `serveApi`.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { CUSTOMERS, INSTRUMENTS, SESSION, Status as OrderStatus, type Order } from './data.ts';
import { readJson, sendEmpty, sendJson, Status, urlOf, watchClient } from './http.ts';
import { count, Route, type State } from './state.ts';
import { arrived, delayFor, refusalFor, sleep } from './timing.ts';
import { validateDraft } from './validate.ts';

/** What a handler decided: a status, and the body to write with it. */
interface Answer {
  readonly status: Status;
  readonly body?: unknown;
}

/** Everything a handler may read. Handlers never touch the request directly. */
interface Call {
  readonly url: URL;
  readonly state: State;
  readonly body: unknown;
  /** `:id` from the path, when the route has one. */
  readonly id: number;
}

const ORDER_PATH = /^\/api\/orders\/(\d+)$/;

const NO_ID = -1;

function listCustomers({ url }: Call): Answer {
  const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

  if (query === '') return { status: Status.Ok, body: CUSTOMERS };

  const matching = CUSTOMERS.filter((customer) =>
    `${customer.name} ${customer.company}`.toLowerCase().includes(query),
  );

  return { status: Status.Ok, body: matching };
}

function listOrders({ state }: Call): Answer {
  return { status: Status.Ok, body: state.orders };
}

function createOrder({ state, body }: Call): Answer {
  const errors = validateDraft(body);

  if (Object.keys(errors).length > 0) return { status: Status.Unprocessable, body: { errors } };

  state.drafts.push(body);

  const id = state.nextOrderId;

  state.nextOrderId += 1;

  return { status: Status.Ok, body: { id } };
}

function shipOrder({ state, body, id }: Call): Answer {
  const target = state.orders.find((order) => order.id === id);

  if (target === undefined) return { status: Status.NotFound, body: { error: 'No such order.' } };

  const wanted = (body as { status?: unknown } | undefined)?.status;
  const status = typeof wanted === 'string' ? wanted : OrderStatus.Shipped;
  const updated: Order = { ...target, status };

  state.orders = state.orders.map((order) => (order.id === id ? updated : order));

  return { status: Status.Ok, body: updated };
}

function readSession({ state }: Call): Answer {
  return state.sessionExpired
    ? { status: Status.Unauthorized, body: { error: 'session expired' } }
    : { status: Status.Ok, body: SESSION };
}

function listInstruments(_call: Call): Answer {
  return { status: Status.Ok, body: INSTRUMENTS };
}

/** One row of the public surface: how to recognise it, and what answers it. */
interface Handler {
  readonly method: string;
  readonly path: string | RegExp;
  readonly route: Route;
  readonly run: (call: Call) => Answer;
}

const HANDLERS: readonly Handler[] = [
  { method: 'GET', path: '/api/customers', route: Route.Customers, run: listCustomers },
  { method: 'GET', path: '/api/orders', route: Route.Orders, run: listOrders },
  { method: 'POST', path: '/api/orders', route: Route.CreateOrder, run: createOrder },
  { method: 'PATCH', path: ORDER_PATH, route: Route.ShipOrder, run: shipOrder },
  { method: 'GET', path: '/api/session', route: Route.Session, run: readSession },
  { method: 'GET', path: '/api/instruments', route: Route.Customers, run: listInstruments },
];

/** The handler for this method and path, with `:id` already read off. */
function match(method: string, pathname: string): { handler: Handler; id: number } | undefined {
  for (const handler of HANDLERS) {
    if (handler.method !== method) continue;

    if (typeof handler.path === 'string') {
      if (handler.path === pathname) return { handler, id: NO_ID };

      continue;
    }

    const found = handler.path.exec(pathname);

    if (found !== null) return { handler, id: Number(found[1]) };
  }

  return undefined;
}

/** Turns a queued refusal into the body its status calls for (EVAL-TASKS §6). */
function refusalBody(status: number, message: string, errors?: Record<string, string>): unknown {
  if (status === Status.Unprocessable) return { errors: errors ?? { form: message } };

  return { error: message };
}

/**
 * Answers one `/api` call: record it, wait however long the run asked for,
 * drop it if the caller has gone, refuse it if something is queued, and only
 * then let the handler decide. Returns false when no route matched.
 */
export async function serveApi(
  request: IncomingMessage,
  response: ServerResponse,
  state: State,
): Promise<boolean> {
  const url = urlOf(request);
  const found = match(request.method ?? 'GET', url.pathname);

  if (found === undefined) return false;

  const { handler, id } = found;
  const gone = watchClient(request, response);
  const body = await readJson(request);

  arrived(state, handler.route);
  await sleep(delayFor(state, handler.route));

  if (gone()) {
    count(state.aborted, handler.route);

    return true;
  }

  const refusal = refusalFor(state, handler.route);

  if (refusal !== undefined) {
    sendJson(
      response,
      refusal.status,
      refusalBody(refusal.status, refusal.message, refusal.errors),
    );

    return true;
  }

  const answer = handler.run({ url, state, body, id });

  if (answer.body === undefined) sendEmpty(response, answer.status);
  else sendJson(response, answer.status, answer.body);

  return true;
}
