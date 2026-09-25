// The proxy is what makes "the origin this page is served from" true for both
// arms, so these prove the three things a run depends on: the backend is
// reachable at /api, the app is reachable everywhere else, and the test-only
// surfaces are not reachable at all.
//
// Each of those three is proved twice, once per path. An upgrade is a request
// with different plumbing, and until 2026-09-25 it was routed to the backend
// whatever it asked for — so `/__control` over a WebSocket reached `evalkit`
// with nothing recorded, and the run scored clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';

import { startEvalkit, type Evalkit } from '../evalkit/src/server.ts';
import { startProxy, type Proxy } from '../src/proxy.ts';

const OK = 200;
const NOT_FOUND = 404;

// A guard that stops working must fail these, not hang them: forwarded to a
// backend expecting a body, a control request simply never answers.
const ANSWER_MS = 3000;
const APP_BODY = 'the app, as its own dev server would answer';

/** What the app answers an upgrade with, so a route can be told apart. */
const APP_UPGRADE = 'HTTP/1.1 101 Switching Protocols\r\nx-served-by: the app\r\n\r\n';

/** The sample nonce from RFC 6455. Nothing here checks the accept key. */
const SOCKET_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

async function fakeApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(OK, { 'content-type': 'text/plain' }).end(APP_BODY);
  });

  // A dev server with a socket of its own — Vite's HMR channel is one. The
  // proxy has to leave it alone rather than hand it to the backend.
  server.on('upgrade', (_request, socket) => void socket.end(APP_UPGRADE));

  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: async () =>
      new Promise<void>((settle) => {
        server.closeAllConnections();
        server.close(() => settle());
      }),
  };
}

/**
 * Runs `body` against a proxy, and closes everything afterwards whether it
 * passed or not. Without the `finally`, a failed assertion leaves three
 * listening servers open and `node --test` never exits — a test that hangs
 * instead of failing is a test that reports nothing.
 */
async function withProxy(body: (proxy: Proxy, kit: Evalkit) => Promise<void>): Promise<void> {
  const kit = await startEvalkit();
  const app = await fakeApp();
  const proxy = await startProxy({ app: app.url, backend: kit.url });

  try {
    await body(proxy, kit);
  } finally {
    await proxy[Symbol.asyncDispose]();
    await app.close();
    await kit.close();
  }
}

/**
 * One upgrade handshake, written by hand, and whatever came back before the
 * connection closed. By hand because two of the three answers are not a
 * WebSocket at all: a refusal is a closed socket, and the app's is a marker.
 */
async function rawUpgrade(origin: string, path: string): Promise<string> {
  const { hostname, port } = new URL(origin);

  return new Promise<string>((settle) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: Upgrade\r\n` +
          `Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n` +
          `Sec-WebSocket-Key: ${SOCKET_KEY}\r\n\r\n`,
      );
    });

    let text = '';

    socket.setTimeout(ANSWER_MS, () => socket.destroy());

    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });

    // A refused upgrade arrives as a reset, not as an answer. That is the
    // result, so it settles rather than throwing.
    socket.on('error', () => socket.destroy());
    socket.on('close', () => settle(text));
  });
}

test('one origin answers for the app and for the backend', async () => {
  await withProxy(async (proxy) => {
    const page = await fetch(`${proxy.url}/`);
    const api = await fetch(`${proxy.url}/api/customers`);

    assert.equal(await page.text(), APP_BODY);
    assert.equal(api.status, OK);

    const customers = (await api.json()) as readonly { name: string }[];

    assert.ok(customers.length > 0, 'the backend answered through the proxy');
    assert.deepEqual(proxy.tampering(), []);
  });
});

test('a POST reaches the backend with its body', async () => {
  await withProxy(async (proxy) => {
    const made = await fetch(`${proxy.url}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 1, quantity: 2 }),
    });

    assert.equal(made.status, OK);

    const body = (await made.json()) as { id?: number };

    assert.equal(typeof body.id, 'number');
  });
});

test('the test-only surfaces are not reachable at the app origin, and are recorded', async () => {
  await withProxy(async (proxy, kit) => {
    const control = await fetch(`${proxy.url}/__control/reset`, {
      method: 'POST',
      signal: AbortSignal.timeout(ANSWER_MS),
    });

    const inspect = await fetch(`${proxy.url}/__inspect/requests`, {
      signal: AbortSignal.timeout(ANSWER_MS),
    });

    assert.equal(control.status, NOT_FOUND);
    assert.equal(inspect.status, NOT_FOUND);
    assert.deepEqual(proxy.tampering(), ['/__control/reset', '/__inspect/requests']);

    // The same surfaces still answer on evalkit's own URL, which is how the
    // hidden tests use them.
    const direct = await fetch(`${kit.url}/__inspect/requests`);

    assert.equal(direct.status, OK);
  });
});

test('an upgrade to a test-only surface is refused, and recorded', async () => {
  await withProxy(async (proxy) => {
    const answer = await rawUpgrade(proxy.url, '/__control/reset');

    assert.equal(answer, '', 'the connection was closed without an answer');

    // The record is the whole verdict here, and deliberately so. `evalkit`
    // destroys an upgrade to anything but `/ws/prices`, so the routed and the
    // refused case look identical from the client — which is exactly why the
    // bug was invisible. What the run is scored on is this list.
    assert.deepEqual(proxy.tampering(), ['/__control/reset']);
  });
});

test('an upgrade the backend does not own goes to the app', async () => {
  await withProxy(async (proxy) => {
    const answer = await rawUpgrade(proxy.url, '/@vite/client');

    assert.match(answer, /x-served-by: the app/u);
    assert.deepEqual(proxy.tampering(), []);
  });
});

test('the price socket still reaches the backend through the proxy', async () => {
  await withProxy(async (proxy) => {
    const socket = new WebSocket(`${proxy.url.replace('http://', 'ws://')}/ws/prices`);

    try {
      const first = await new Promise<string>((settle, fail) => {
        const timer = setTimeout(() => fail(new Error('no price arrived')), ANSWER_MS);

        socket.addEventListener('message', (event: MessageEvent<string>) => {
          clearTimeout(timer);
          settle(event.data);
        });

        socket.addEventListener('error', () => {
          clearTimeout(timer);
          fail(new Error('the socket errored'));
        });
      });

      assert.match(first, /"type"/u);
      assert.deepEqual(proxy.tampering(), []);
    } finally {
      socket.close();
    }
  });
});
