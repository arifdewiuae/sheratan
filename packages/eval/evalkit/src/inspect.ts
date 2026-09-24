// `/__inspect/*` — what a hidden test can ask the server about a run
// (EVAL-TASKS §1.3). Read-only by construction: nothing here changes state,
// so an assertion cannot alter the thing it is measuring.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendError, sendJson, Status, urlOf } from './http.ts';
import { tallyOf, type State } from './state.ts';

/** How the socket half is counted, without this file importing it. */
export interface SocketView {
  /** Sockets currently open and subscribed. */
  open(): number;
  /** Price messages pushed since the last reset. */
  pushed(): number;
}

const PREFIX = '/__inspect/';

/** One report, and how to build it. */
type Report = (state: State, sockets: SocketView) => unknown;

const REPORTS: Record<string, Report> = {
  /** Calls the server took, per route, whether or not it answered them. */
  requests: (state) => tallyOf(state.received),

  /** Calls whose caller went away before the answer was written (T02). */
  aborted: (state) => tallyOf(state.aborted),

  /** Open price subscriptions, and how much has been pushed down them. */
  sockets: (_state, sockets) => ({ open: sockets.open(), pushed: sockets.pushed() }),

  /** Bodies `POST /api/orders` accepted, in order (T03). */
  drafts: (state) => state.drafts,

  /** The orders as they now stand, after any `PATCH` (T04). */
  orders: (state) => state.orders,

  /** Everything at once, for a failure message worth reading. */
  all: (state, sockets) => ({
    requests: tallyOf(state.received),
    aborted: tallyOf(state.aborted),
    sockets: { open: sockets.open(), pushed: sockets.pushed() },
    drafts: state.drafts,
    orders: state.orders,
    sessionExpired: state.sessionExpired,
  }),
};

/** The reports, for the test that proves each one is reachable. */
export const REPORT_NAMES: readonly string[] = Object.keys(REPORTS);

/** Answers one inspection request. */
export function serveInspect(
  request: IncomingMessage,
  response: ServerResponse,
  state: State,
  sockets: SocketView,
): boolean {
  const { pathname } = urlOf(request);

  if (!pathname.startsWith(PREFIX)) return false;

  const name = pathname.slice(PREFIX.length);
  const report = REPORTS[name];

  if (report === undefined) {
    sendError(response, Status.NotFound, `No inspection report "${name}".`);

    return true;
  }

  sendJson(response, Status.Ok, report(state, sockets));

  return true;
}
