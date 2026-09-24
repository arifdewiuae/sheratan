// The server itself: one port, four surfaces, and a `reset` that puts every
// one of them back where a task starts (EVAL-TASKS §1.3).
//
// Ordering matters. `/__control` and `/__inspect` are matched before `/api`,
// so a task cannot shadow them by asking for a path that looks like one, and
// an unmatched path is a 404 rather than a fall-through to anything.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { serveApi } from './api.ts';
import { serveControl, type Host } from './control.ts';
import { FIRST_NEW_ORDER_ID } from './data.ts';
import { sendEmpty, sendError, Status, urlOf } from './http.ts';
import { serveInspect } from './inspect.ts';
import { createPrices, type Prices } from './prices.ts';
import { freshState, type State } from './state.ts';

/** The socket path. The only one this server upgrades. */
const SOCKET_PATH = '/ws/prices';

/** The seed every run starts from unless it says otherwise. */
export const DEFAULT_SEED = 0x51ee_d10c;

/** A running server, and the handle a harness steers it with. */
export interface Evalkit {
  readonly server: Server;
  /** `http://127.0.0.1:<port>`, once listening. */
  readonly url: string;
  /** Back to the state a task starts in. Also what `/__control/reset` calls. */
  reset(): void;
  close(): Promise<void>;
}

/** How a run differs from the default one. */
export interface EvalkitOptions {
  /** 0 asks the OS for a free port, which is what tests want. */
  readonly port?: number;
  readonly seed?: number;
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  state: State,
  parts: { host: Host; prices: Prices },
): Promise<void> {
  if (request.method === 'OPTIONS') {
    sendEmpty(response, Status.NoContent);

    return;
  }

  if (await serveControl(request, response, state, parts.host)) return;

  if (serveInspect(request, response, state, parts.prices)) return;

  if (await serveApi(request, response, state)) return;

  sendError(response, Status.NotFound, `No route for ${urlOf(request).pathname}.`);
}

/** Starts the server and resolves once it is listening. */
export async function startEvalkit(options: EvalkitOptions = {}): Promise<Evalkit> {
  const seed = options.seed ?? DEFAULT_SEED;
  const prices = createPrices(seed);

  let state = freshState(FIRST_NEW_ORDER_ID);

  const host: Host = {
    drop: () => prices.drop(),
    announceExpiry: () => prices.announceExpiry(),
    reset() {
      state = freshState(FIRST_NEW_ORDER_ID);
      prices.reset();
    },
    setRate: (rate) => prices.setRate(rate),
  };

  const server = createServer((request, response) => {
    void route(request, response, state, { host, prices }).catch(() => {
      if (!response.writableEnded) sendError(response, Status.ServerError, 'evalkit failed.');
    });
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers['sec-websocket-key'];

    if (urlOf(request).pathname !== SOCKET_PATH || typeof key !== 'string') {
      socket.destroy();

      return;
    }

    prices.attach(socket, key);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    server,
    url: `http://127.0.0.1:${String(port)}`,
    reset: () => host.reset(),

    async close() {
      prices.stop();

      // `fetch` holds its connection open by default, and `close` waits for
      // every one of them — so without this a finished test suite hangs.
      server.closeAllConnections();

      await new Promise<void>((resolve) => void server.close(() => resolve()));
    },
  };
}
