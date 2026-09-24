// `/__control/*`, the surface a hidden test steers the server with
// (EVAL-TASKS §1.3). Every command is exercised here, and the last test says
// so by name: a knob nothing pulls is a knob that has quietly stopped working,
// and the tasks that depend on it would fail for reasons no one could see.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { COMMAND_NAMES } from '../src/control.ts';
import { ORDERS } from '../src/data.ts';
import { startEvalkit, type Evalkit } from '../src/server.ts';

let kit: Evalkit;

/** Commands this file has pulled, checked against the real list at the end. */
const exercised = new Set<string>();

async function control(name: string, body: unknown = {}): Promise<Response> {
  exercised.add(name);

  return fetch(`${kit.url}/__control/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const get = async (path: string): Promise<Response> => fetch(`${kit.url}${path}`);

before(async () => {
  kit = await startEvalkit();
});

afterEach(() => {
  kit.reset();
});

after(async () => {
  await kit.close();
});

describe('latency', () => {
  test('delays the route it names, and only that route', async () => {
    const WAIT_MS = 250;
    const TOLERANCE_MS = 40;

    await control('latency', { route: 'customers', ms: WAIT_MS });

    const started = performance.now();

    await get('/api/customers');

    const slow = performance.now() - started;
    const before2 = performance.now();

    await get('/api/orders');

    const fast = performance.now() - before2;

    assert.ok(slow >= WAIT_MS - TOLERANCE_MS, `customers waited ${String(Math.round(slow))}ms`);
    assert.ok(fast < WAIT_MS, `orders did not wait (${String(Math.round(fast))}ms)`);
  });

  test('an unknown route is refused rather than silently ignored', async () => {
    const refused = await control('latency', { route: 'nope', ms: 10 });

    assert.equal(refused.status, 400);
  });
});

describe('fail', () => {
  test('refuses exactly the number of calls asked for', async () => {
    await control('fail', { route: 'customers', status: 500, message: 'boom', times: 2 });

    assert.equal((await get('/api/customers')).status, 500);
    assert.equal((await get('/api/customers')).status, 500);
    assert.equal((await get('/api/customers')).status, 200);
  });

  test('carries the message in an error body', async () => {
    await control('fail', { route: 'orders', status: 409, message: 'Already shipped.' });

    const refused = await get('/api/orders');

    assert.deepEqual(await refused.json(), { error: 'Already shipped.' });
  });

  test('a queued 422 carries field errors instead (T03)', async () => {
    await control('fail', {
      route: 'createOrder',
      status: 422,
      errors: { quantity: 'Too many for this customer.' },
    });

    const refused = await fetch(`${kit.url}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 1, quantity: 5 }),
    });

    assert.equal(refused.status, 422);

    assert.deepEqual(await refused.json(), {
      errors: { quantity: 'Too many for this customer.' },
    });
  });
});

describe('reverse', () => {
  test('a later request answers before an earlier one (T02)', async () => {
    await control('reverse', { route: 'customers' });

    const finished: string[] = [];
    const first = get('/api/customers?q=a').then(() => void finished.push('first'));

    const GAP_MS = 30;

    await new Promise((resolve) => setTimeout(resolve, GAP_MS));

    const second = get('/api/customers?q=ab').then(() => void finished.push('second'));

    await Promise.all([first, second]);

    assert.deepEqual(finished, ['second', 'first']);
  });
});

describe('expire', () => {
  test('every route answers 401 afterwards', async () => {
    await control('expire');

    assert.equal((await get('/api/customers')).status, 401);
    assert.equal((await get('/api/orders')).status, 401);
    assert.equal((await get('/api/session')).status, 401);
  });
});

describe('reset', () => {
  test('clears a queued failure, a latency and a shipped order', async () => {
    await control('latency', { route: 'customers', ms: 400 });
    await control('fail', { route: 'orders', status: 500 });

    await fetch(`${kit.url}/api/orders/101`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'shipped' }),
    });

    await control('reset');

    const started = performance.now();
    const customers = await get('/api/customers');
    const elapsed = performance.now() - started;

    assert.equal(customers.status, 200);
    assert.ok(elapsed < 400, 'the latency is gone');
    assert.equal((await get('/api/orders')).status, 200, 'the failure is gone');
    assert.deepEqual(await (await get('/api/orders')).json(), ORDERS, 'the order is back');
  });

  test('clears an expired session', async () => {
    await control('expire');
    await control('reset');

    assert.equal((await get('/api/session')).status, 200);
  });
});

describe('rate and drop', () => {
  test('rate refuses a nonsense value and accepts a real one', async () => {
    assert.equal((await control('rate', { rate: 0 })).status, 400);
    assert.equal((await control('rate', { rate: 40 })).status, 204);
  });

  test('drop is accepted with no sockets open', async () => {
    assert.equal((await control('drop')).status, 204);
  });
});

test('an unknown command is a 404, not a silent success', async () => {
  const missing = await fetch(`${kit.url}/__control/nonsense`, { method: 'POST' });

  assert.equal(missing.status, 404);
});

test('every control command is exercised by this file', () => {
  const missing = COMMAND_NAMES.filter((name) => !exercised.has(name));

  assert.deepEqual(missing, [], `untested control commands: ${missing.join(', ')}`);
});
