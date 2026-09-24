// The public surface, as a task's app sees it (EVAL-TASKS §6).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { CUSTOMERS, FIRST_NEW_ORDER_ID, ORDERS, QUANTITY_MAX } from '../src/data.ts';
import { startEvalkit, type Evalkit } from '../src/server.ts';

let kit: Evalkit;

const get = async (path: string): Promise<Response> => fetch(`${kit.url}${path}`);

const send = async (path: string, method: string, body: unknown): Promise<Response> =>
  fetch(`${kit.url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const VALID = { customerId: 1, quantity: 5, note: 'rush' };

before(async () => {
  kit = await startEvalkit();
});

after(async () => {
  await kit.close();
});

describe('customers', () => {
  test('answers the seeded rows in server order', async () => {
    const rows = (await (await get('/api/customers')).json()) as typeof CUSTOMERS;

    assert.equal(rows.length, CUSTOMERS.length);
    assert.deepEqual(rows[0], CUSTOMERS[0]);
    assert.deepEqual(rows.at(-1), CUSTOMERS.at(-1));
  });

  test('filters on q, and an empty q is every row', async () => {
    const filtered = (await (
      await get('/api/customers?q=Company%2012')
    ).json()) as typeof CUSTOMERS;

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, 12);

    const all = (await (await get('/api/customers?q=')).json()) as typeof CUSTOMERS;

    assert.equal(all.length, CUSTOMERS.length);
  });
});

describe('orders', () => {
  test('lists the seeded orders, none of them shipped', async () => {
    const rows = (await (await get('/api/orders')).json()) as typeof ORDERS;

    assert.deepEqual(rows, ORDERS);
  });

  test('a patch persists, so a reload shows it', async () => {
    kit.reset();

    const patched = await send('/api/orders/101', 'PATCH', { status: 'shipped' });

    assert.equal(patched.status, 200);

    const rows = (await (await get('/api/orders')).json()) as typeof ORDERS;

    assert.equal(rows.find((order) => order.id === 101)?.status, 'shipped');
    assert.equal(rows.find((order) => order.id === 102)?.status, 'packing');
  });

  test('a patch to an order that does not exist is a 404', async () => {
    const missing = await send('/api/orders/999', 'PATCH', { status: 'shipped' });

    assert.equal(missing.status, 404);
  });
});

describe('creating an order', () => {
  test('accepts a valid draft and hands back an id', async () => {
    kit.reset();

    const created = await send('/api/orders', 'POST', VALID);

    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), { id: FIRST_NEW_ORDER_ID });
  });

  test('ids do not repeat', async () => {
    kit.reset();

    const first = (await (await send('/api/orders', 'POST', VALID)).json()) as { id: number };
    const second = (await (await send('/api/orders', 'POST', VALID)).json()) as { id: number };

    assert.notEqual(first.id, second.id);
  });

  for (const quantity of [0, QUANTITY_MAX + 1, 2.5, undefined, 'four']) {
    test(`refuses quantity ${JSON.stringify(quantity)} with a field error`, async () => {
      const refused = await send('/api/orders', 'POST', { ...VALID, quantity });
      const body = (await refused.json()) as { errors: Record<string, string> };

      assert.equal(refused.status, 422);
      assert.notEqual(body.errors['quantity'], undefined, 'names the quantity field');
      assert.equal(body.errors['customer'], undefined, 'and only that field');
    });
  }

  test('refuses an unknown customer and an over-long note together', async () => {
    const refused = await send('/api/orders', 'POST', {
      customerId: 9999,
      quantity: 5,
      note: 'x'.repeat(201),
    });

    const body = (await refused.json()) as { errors: Record<string, string> };

    assert.equal(refused.status, 422);
    assert.notEqual(body.errors['customer'], undefined);
    assert.notEqual(body.errors['note'], undefined);
  });

  test('a rejected draft is not recorded', async () => {
    kit.reset();
    await send('/api/orders', 'POST', { ...VALID, quantity: 0 });

    const drafts = (await (await get('/__inspect/drafts')).json()) as unknown[];

    assert.deepEqual(drafts, []);
  });
});

describe('session', () => {
  test('answers who is signed in', async () => {
    kit.reset();

    const session = (await (await get('/api/session')).json()) as { user: string };

    assert.equal(typeof session.user, 'string');
  });
});

test('an unknown path is a 404 with an error body', async () => {
  const missing = await get('/api/nothing');

  assert.equal(missing.status, 404);
  assert.equal(typeof ((await missing.json()) as { error: string }).error, 'string');
});
