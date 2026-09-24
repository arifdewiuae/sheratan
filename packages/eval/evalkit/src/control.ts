// `/__control/*` — what a hidden test does to the server between assertions
// (EVAL-TASKS §1.3). Never named in `CONTRACT.md`, never in a task prompt, and
// the one thing an arm could use to cheat if it found it, which is why the
// harness asserts it was not called during an agent's own turns.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { readJson, sendEmpty, sendError, Status, urlOf } from './http.ts';
import { Route, type State } from './state.ts';

/** What a command may reach outside the state object it is handed. */
export interface Host {
  /** Closes every open price socket, as a network drop would. */
  drop(): void;
  /** Tells every open socket the session ended (EVAL-TASKS §6). */
  announceExpiry(): void;
  /** Puts the server back to the state it starts a task in. */
  reset(): void;
  /** Price ticks per second (EVAL-TASKS §1.3 "configurable rate"). */
  setRate(rate: number): void;
}

const ROUTES = new Set<string>(Object.values(Route));

function asRoute(value: unknown): Route | undefined {
  return typeof value === 'string' && ROUTES.has(value) ? (value as Route) : undefined;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** One command, and what it does to the state it is handed. */
type Command = (body: Record<string, unknown>, state: State, host: Host) => string | undefined;

const ONE = 1;

const COMMANDS: Record<string, Command> = {
  /** `{ route, ms }` — every later call to `route` waits `ms`. */
  latency(body, state) {
    const route = asRoute(body['route']);

    if (route === undefined) return 'Unknown route.';

    state.latency.set(route, asCount(body['ms'], 0));

    return undefined;
  },

  /** `{ route, status, message?, errors?, times? }` — refuse the next `times`. */
  fail(body, state) {
    const route = asRoute(body['route']);

    if (route === undefined) return 'Unknown route.';

    const status = asCount(body['status'], Status.ServerError);
    const message = typeof body['message'] === 'string' ? body['message'] : 'Request failed.';
    const errors = body['errors'] as Record<string, string> | undefined;

    state.failures.set(route, {
      remaining: asCount(body['times'], ONE),
      status,
      message,
      ...(errors === undefined ? {} : { errors }),
    });

    return undefined;
  },

  /** `{ route }` — later calls answer in the opposite order to their asks. */
  reverse(body, state) {
    const route = asRoute(body['route']);

    if (route === undefined) return 'Unknown route.';

    state.reversed.add(route);
    state.arrivals.set(route, 0);

    return undefined;
  },

  /** Closes every open price socket. */
  drop(_body, _state, host) {
    host.drop();

    return undefined;
  },

  /** Every route answers 401 from now on, and open sockets are told. */
  expire(_body, state, host) {
    state.sessionExpired = true;
    host.announceExpiry();

    return undefined;
  },

  /** Every knob, counter and order back to how the task started. */
  reset(_body, _state, host) {
    host.reset();

    return undefined;
  },

  /** `{ rate }` — price ticks per second. The socket's half of `latency`. */
  rate(body, _state, host) {
    const rate = body['rate'];

    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      return 'Rate must be a positive number of ticks per second.';
    }

    host.setRate(rate);

    return undefined;
  },
};

/** The commands, for the test that proves each one is reachable. */
export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

const PREFIX = '/__control/';

/** Runs one control command, or reports that there is no such command. */
export async function serveControl(
  request: IncomingMessage,
  response: ServerResponse,
  state: State,
  host: Host,
): Promise<boolean> {
  const { pathname } = urlOf(request);

  if (!pathname.startsWith(PREFIX)) return false;

  const name = pathname.slice(PREFIX.length);

  const command = COMMANDS[name];

  if (command === undefined) {
    sendError(response, Status.NotFound, `No control command "${name}".`);

    return true;
  }

  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const problem = command(body, state, host);

  if (problem === undefined) sendEmpty(response, Status.NoContent);
  else sendError(response, Status.BadRequest, problem);

  return true;
}
