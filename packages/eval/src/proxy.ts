// One origin for the whole task, so both arms reach the backend identically.
//
// `evalkit`'s contract tells the agent the base URL is "the origin this page
// is served from". Honouring that per-arm — a Vite proxy here, something else
// there — would configure the arms differently, which is the one thing
// EVAL-TASKS §1.1 forbids. So the app is never reached directly: the harness
// serves it behind this, `/api` and `/ws` go to `evalkit`, and everything else
// goes to the arm's own dev server.
//
// It is also where tampering is caught. `/__control` and `/__inspect` are
// named nowhere an agent can read, and the hidden tests reach them on
// `evalkit`'s own URL — so a request for one *here* can only be an arm that
// went looking, and the run says so rather than scoring it. That has to hold
// on the upgrade path as well: a WebSocket is a request, and one routed to the
// backend without reading its path is a control API reachable at the app's
// origin with nothing recorded.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** Paths the backend owns. Everything else is the app's. */
const BACKEND_PREFIXES = ['/api', '/ws'] as const;

/** The prefix `evalkit` puts its test-only surfaces behind. */
const HIDDEN_PREFIX = '/__';

const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

/** Hop-by-hop headers a proxy must not pass on. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']);

/** A running proxy. Disposing it closes the port. */
export interface Proxy extends AsyncDisposable {
  readonly url: string;
  readonly port: number;
  /**
   * Requests for a test-only surface seen at the app's origin. Anything above
   * zero voids the run: the arm found something it was never shown.
   */
  tampering(): readonly string[];
}

/** Where the two halves of one origin actually live. */
export interface ProxyOptions {
  /** The arm's dev server, as an origin. */
  readonly app: string;
  /** `evalkit`, as an origin. */
  readonly backend: string;
  /** 0 asks the OS for a free port, which is what tests want. */
  readonly port?: number;
}

function forBackend(pathname: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Whether this is a test-only surface, recording it if it is. Both paths ask,
 * because both paths can carry one: what differs is only how a request that
 * was never going to be answered is refused.
 */
function hidden(caught: string[], pathname: string): boolean {
  if (!pathname.startsWith(HIDDEN_PREFIX)) return false;

  caught.push(pathname);

  return true;
}

function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;

    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }

  return headers;
}

/**
 * The body a forwarded request carries, read whole. Nothing this backend
 * serves is large, and buffering keeps the forward a plain `fetch` rather
 * than a duplex stream with a different shape on every runtime.
 */
async function bodyOf(request: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;

  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Uint8Array.from(Buffer.concat(chunks));
}

async function forward(
  request: IncomingMessage,
  response: ServerResponse,
  to: string,
): Promise<void> {
  const body = await bodyOf(request);

  const answer = await fetch(new URL(request.url ?? '/', to), {
    method: request.method ?? 'GET',
    headers: headersOf(request),
    body,
    redirect: 'manual',
  });

  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(new Uint8Array(await answer.arrayBuffer()));
}

/** Pipes an upgrade to `to`, which is how the price socket survives. */
function upgrade(request: IncomingMessage, client: Duplex, head: Buffer, to: string): void {
  const target = new URL(to);
  const lines = Object.entries(request.headers).map(([name, value]) => `${name}: ${String(value)}`);

  const upstream: Socket = connect(Number(target.port), target.hostname, () => {
    upstream.write(`GET ${request.url ?? '/'} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);

    if (head.length > 0) upstream.write(head);

    upstream.pipe(client).pipe(upstream);
  });

  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
}

/** Starts the proxy and resolves once it is listening. */
export async function startProxy(options: ProxyOptions): Promise<Proxy> {
  const caught: string[] = [];

  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', options.app);

    if (hidden(caught, pathname)) {
      response.writeHead(NOT_FOUND).end();

      return;
    }

    const to = forBackend(pathname) ? options.backend : options.app;

    forward(request, response, to).catch(() => {
      if (!response.headersSent) response.writeHead(BAD_GATEWAY);

      response.end();
    });
  });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(request.url ?? '/', options.app);

    if (hidden(caught, pathname)) {
      // There is no 404 to send on a connection that was never established,
      // so closing it is the refusal. What voids the run is the record.
      socket.destroy();

      return;
    }

    // Not every upgrade belongs to the backend. An arm's dev server may have
    // a socket of its own, and handing it to `evalkit` would break the arm
    // for a reason no task prompt explains.
    upgrade(request, socket, head, forBackend(pathname) ? options.backend : options.app);
  });

  await new Promise<void>((settle) => server.listen(options.port ?? 0, '127.0.0.1', settle));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    tampering: () => [...caught],

    async [Symbol.asyncDispose]() {
      server.closeAllConnections();

      await new Promise<void>((settle) => void server.close(() => settle()));
    },
  };
}
