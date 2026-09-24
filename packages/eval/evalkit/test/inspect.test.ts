// `/__inspect/*`, the surface a hidden test asks questions with
// (EVAL-TASKS §1.3). Like the control tests, the last one asserts every report
// was used: a report nobody reads is one that can rot without any suite going
// red, and the tasks leaning on it would fail inexplicably.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { ORDERS } from '../src/data.ts';
import { REPORT_NAMES } from '../src/inspect.ts';
import { startEvalkit, type Evalkit } from '../src/server.ts';

let kit: Evalkit;

const used = new Set<string>();

async function inspect<T>(name: string): Promise<T> {
  used.add(name);

  return (await (await fetch(`${kit.url}/__inspect/${name}`)).json()) as T;
}

const get = async (path: string): Promise<Response> => fetch(`${kit.url}${path}`);

const post = async (body: unknown): Promise<Response> =>
  fetch(`${kit.url}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const control = async (name: string, body: unknown = {}): Promise<Response> =>
  fetch(`${kit.url}/__control/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

before(async () => {
  kit = await startEvalkit();
});

afterEach(() => {
  kit.reset();
});

after(async () => {
  await kit.close();
});

describe('requests', () => {
  test('counts calls per route, including ones that were refused', async () => {
    await control('fail', { route: 'orders', status: 500 });
    await get('/api/customers');
    await get('/api/customers');
    await get('/api/orders');

    const counts = await inspect<Record<string, number>>('requests');

    assert.equal(counts['customers'], 2);
    assert.equal(counts['orders'], 1);
    assert.equal(counts['createOrder'], 0, 'a route nobody called reads zero, not undefined');
  });
});

describe('aborted', () => {
  test('counts a call the caller gave up on (T02)', async () => {
    const LATENCY_MS = 300;
    const GIVE_UP_MS = 60;

    await control('latency', { route: 'customers', ms: LATENCY_MS });

    const stop = new AbortController();
    const pending = get('/api/customers').catch(() => undefined);

    void fetch(`${kit.url}/api/customers`, { signal: stop.signal }).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, GIVE_UP_MS));

    stop.abort();

    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    await pending;

    const aborted = await inspect<Record<string, number>>('aborted');

    assert.ok(
      aborted['customers'] !== undefined && aborted['customers'] >= 1,
      'one call was abandoned',
    );
  });

  test('a call nobody abandoned is not counted', async () => {
    await get('/api/customers');

    const aborted = await inspect<Record<string, number>>('aborted');

    assert.equal(aborted['customers'], 0);
  });
});

describe('drafts and orders', () => {
  test('drafts are the accepted bodies, in order', async () => {
    // One after the other, not together: the report is about their order, and
    // two concurrent posts have none.
    await post({ customerId: 1, quantity: 3 });
    await post({ customerId: 1, quantity: 7 });

    const drafts = await inspect<{ quantity: number }[]>('drafts');

    assert.deepEqual(
      drafts.map((draft) => draft.quantity),
      [3, 7],
    );
  });

  test('orders show the writes a run has made', async () => {
    assert.deepEqual(await inspect('orders'), ORDERS);

    await fetch(`${kit.url}/api/orders/102`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'shipped' }),
    });

    const after2 = await inspect<typeof ORDERS>('orders');

    assert.equal(after2.find((order) => order.id === 102)?.status, 'shipped');
  });
});

describe('sockets', () => {
  test('reports nothing open before a client connects', async () => {
    const sockets = await inspect<{ open: number; pushed: number }>('sockets');

    assert.equal(sockets.open, 0);
  });

  test('reports an open subscription, and that it is being pushed to', async () => {
    const socket = new WebSocket(`${kit.url.replace('http://', 'ws://')}/ws/prices`);

    await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
    await new Promise<void>((resolve) => socket.addEventListener('message', () => resolve()));

    const sockets = await inspect<{ open: number; pushed: number }>('sockets');

    assert.equal(sockets.open, 1);
    assert.ok(sockets.pushed > 0);

    socket.close();
  });
});

describe('all', () => {
  test('carries every other report in one answer', async () => {
    await get('/api/customers');

    const everything = await inspect<Record<string, unknown>>('all');

    for (const key of ['requests', 'aborted', 'sockets', 'drafts', 'orders', 'sessionExpired']) {
      assert.ok(key in everything, `"all" is missing ${key}`);
    }
  });
});

test('an unknown report is a 404', async () => {
  const missing = await get('/__inspect/nonsense');

  assert.equal(missing.status, 404);
});

test('every inspection report is exercised by this file', () => {
  const skipped = REPORT_NAMES.filter((name) => !used.has(name));

  assert.deepEqual(skipped, [], `untested inspection reports: ${skipped.join(', ')}`);
});
