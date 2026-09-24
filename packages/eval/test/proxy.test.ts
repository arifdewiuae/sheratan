// The proxy is what makes "the origin this page is served from" true for both
// arms, so these prove the three things a run depends on: the backend is
// reachable at /api, the app is reachable everywhere else, and the test-only
// surfaces are not reachable at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { startEvalkit, type Evalkit } from '../evalkit/src/server.ts';
import { startProxy, type Proxy } from '../src/proxy.ts';

const OK = 200;
const NOT_FOUND = 404;

// A guard that stops working must fail these, not hang them: forwarded to a
// backend expecting a body, a control request simply never answers.
const ANSWER_MS = 3000;
const APP_BODY = 'the app, as its own dev server would answer';

async function fakeApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(OK, { 'content-type': 'text/plain' }).end(APP_BODY);
  });

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
