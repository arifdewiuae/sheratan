// The behaviour half of the Week 0 self-repair gate (EVAL-TASKS §5): after the
// agent's one turn, does the host task still do what its prompt says? These
// assertions are taken from the hidden-test bullets of T01, T03 and T04.
//
// The agent never sees this file. The harness copies it in after the turn.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { flush, render, type Disposer } from 'sheratan';

import { createApp } from '../hosts/app.ts';
import { RejectedError } from '../hosts/services/api.contract.ts';
import {
  createFixture,
  CUSTOMERS,
  NEW_ORDER_ID,
  ORDERS,
  type Fixture,
} from '../hosts/services/api.fixture.ts';
import { changesDuring, fire, freshHost, type Change } from './dom.ts';

let host: Element;
let dispose: Disposer | undefined;

beforeEach(() => {
  host = freshHost();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

const TURNS = 4;

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  flush();
}

/** Lets every queued promise settle, then paints the frame they scheduled. */
async function settle(): Promise<void> {
  // Four passes, because a chain of `await`s inside effects takes more than
  // one macrotask to reach the transition that schedules the frame.
  /* eslint-disable-next-line no-await-in-loop -- the turns are deliberately sequential */
  for (let turn = 0; turn < TURNS; turn++) await tick();
}

function mount(fixture: Fixture): void {
  dispose = render(createApp(fixture.api), host);
}

function all(testid: string): Element[] {
  return [...host.querySelectorAll(`[data-testid="${testid}"]`)];
}

function one(testid: string): Element | null {
  return host.querySelector(`[data-testid="${testid}"]`);
}

function text(testid: string): string {
  return one(testid)?.textContent.trim() ?? '';
}

function countOf(route: string, fixture: Fixture): number {
  return fixture.control.calls().filter((call) => call === route).length;
}

// ---------------------------------------------------------------- T01

test('T01: loading shows before the rows arrive, and goes away after', async () => {
  const fixture = createFixture();

  fixture.control.hold('customers');
  mount(fixture);
  await settle();

  assert.notEqual(one('loading'), null, 'loading is visible while the request is open');
  assert.equal(all('customer-row').length, 0);

  fixture.control.release('customers');
  await settle();

  assert.equal(one('loading'), null, 'and gone once the rows are there');
  assert.equal(all('customer-row').length, CUSTOMERS.length);
});

test('T01: renders the fixture rows in server order with the right cells', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  const rows = all('customer-row');

  assert.equal(rows.length, 25);

  const first = CUSTOMERS[0];
  const cells = [...(rows[0]?.children ?? [])].map((cell) => cell.textContent);

  assert.deepEqual(cells, [first?.name, first?.company, first?.country]);
  assert.equal(rows.at(-1)?.firstElementChild?.textContent, CUSTOMERS.at(-1)?.name);
});

test('T01: a failed request shows the error, with no rows and no loading', async () => {
  const fixture = createFixture();

  fixture.control.fail('customers', new Error('Server error'));
  mount(fixture);
  await settle();

  assert.notEqual(one('error'), null);
  assert.equal(one('loading'), null);
  assert.equal(all('customer-row').length, 0);
  assert.match(text('error'), /Server error/);
});

test('T01: retry makes exactly one new request, then renders the rows', async () => {
  const fixture = createFixture();

  fixture.control.fail('customers', new Error('Server error'));
  mount(fixture);
  await settle();

  assert.equal(countOf('customers', fixture), 2, 'the list, and the form’s select');

  fire(one('retry') as Element, 'click');
  await settle();

  assert.equal(countOf('customers', fixture), 3, 'one retry, one request');
  assert.equal(all('customer-row').length, CUSTOMERS.length);
  assert.equal(one('error'), null);
});

/** The three T01 says are mutually exclusive. */
const STATES = ['loading', 'error', 'customer-table'];

function statesIn(element: Element): string[] {
  return STATES.filter(
    (name) =>
      element.getAttribute('data-testid') === name ||
      element.querySelector(`[data-testid="${name}"]`) !== null,
  );
}

/** Replays recorded mutations one at a time and reports the worst moment. */
function mostAtOnce(start: readonly string[], changes: readonly Change[]): number {
  const present = new Set(start);
  let worst = present.size;

  for (const change of changes) {
    for (const name of change.removed.flatMap(statesIn)) present.delete(name);
    for (const name of change.added.flatMap(statesIn)) present.add(name);

    worst = Math.max(worst, present.size);
  }

  return worst;
}

test('T01: loading, error and the table are never on screen together', async () => {
  const fixture = createFixture();

  fixture.control.fail('customers', new Error('Server error'));
  mount(fixture);
  await settle();

  const start = STATES.filter((name) => one(name) !== null);
  const changes: Change[] = [];
  const recorder = changesDuring(host, changes);

  // The transition a three-hole implementation gets wrong: the loader goes in
  // before the error comes out, and for one frame both are on screen. The
  // request is held open so the loading state actually reaches a frame —
  // otherwise the scheduler coalesces it away and the test proves nothing.
  fixture.control.hold('customers');
  fire(one('retry') as Element, 'click');
  await settle();

  assert.notEqual(one('loading'), null, 'the loading state did reach the DOM');

  fixture.control.release('customers');
  await settle();
  recorder.stop();

  assert.ok(changes.length > 1, 'the DOM did change');
  assert.equal(mostAtOnce(start, changes), 1, 'never two of the three at once');
});

// ---------------------------------------------------------------- T03

function type(testid: string, value: string): void {
  const field = one(testid) as HTMLInputElement;

  field.value = value;
  fire(field, 'input');
}

function choose(id: number): void {
  const select = one('customer') as HTMLSelectElement;

  select.value = String(id);
  fire(select, 'change');
}

function submit(): void {
  fire(one('order-form') as Element, 'submit');
}

async function readyForm(fixture: Fixture): Promise<void> {
  mount(fixture);
  await settle();
  choose(1);
  type('quantity', '5');
  await settle();
}

test('T03: an invalid quantity shows a field error and sends nothing', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  // Sequential on purpose: each value has to be typed, submitted and judged
  // before the next one replaces it.
  for (const value of ['0', '1001', '2.5', '']) {
    choose(1);
    type('quantity', value);
    submit();
    /* eslint-disable-next-line no-await-in-loop -- see above */
    await settle();

    assert.notEqual(text('error-quantity'), '', `"${value}" is refused`);
    assert.equal(countOf('createOrder', fixture), 0, `"${value}" was never sent`);
  }
});

test('T03: a valid submit sends one order and disables the button until it answers', async () => {
  const fixture = createFixture();

  await readyForm(fixture);

  fixture.control.hold('createOrder');
  submit();
  await settle();

  assert.equal(countOf('createOrder', fixture), 1);
  assert.equal((one('submit') as HTMLButtonElement).disabled, true, 'disabled while pending');

  fixture.control.release('createOrder');
  await settle();

  assert.equal((one('submit') as HTMLButtonElement).disabled, false);
  assert.deepEqual(fixture.control.drafts(), [{ customerId: 1, quantity: 5, note: '' }]);
});

test('T03: submitting twice still sends exactly one order', async () => {
  const fixture = createFixture();

  await readyForm(fixture);

  fixture.control.hold('createOrder');
  submit();
  submit();
  await settle();

  assert.equal(countOf('createOrder', fixture), 1);

  fixture.control.release('createOrder');
  await settle();

  assert.equal(countOf('createOrder', fixture), 1);
});

test('T03: a 422 shows the server message and keeps the other fields', async () => {
  const fixture = createFixture();

  await readyForm(fixture);
  type('note', 'Handle with care');
  await settle();

  fixture.control.fail('createOrder', new RejectedError({ quantity: 'Only 3 left in stock.' }));
  submit();
  await settle();

  assert.equal(text('error-quantity'), 'Only 3 left in stock.');
  assert.equal((one('quantity') as HTMLInputElement).value, '5', 'the form is not cleared');
  assert.equal((one('note') as HTMLTextAreaElement).value, 'Handle with care');
  assert.equal(one('created'), null);
});

test('T03: success clears the form and shows the new order id', async () => {
  const fixture = createFixture();

  await readyForm(fixture);
  type('note', 'Rush');
  submit();
  await settle();

  assert.match(text('created'), new RegExp(String(NEW_ORDER_ID)));
  assert.equal((one('quantity') as HTMLInputElement).value, '');
  assert.equal((one('note') as HTMLTextAreaElement).value, '');
  assert.equal(text('error-quantity'), '');
});

// ---------------------------------------------------------------- T04

function shipRow(index: number): void {
  const button = all('ship')[index];

  fire(button as Element, 'click');
}

function statuses(): string[] {
  return all('status').map((node) => node.textContent);
}

test('T04: the badge reads shipped before the server has answered', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  assert.deepEqual(statuses(), ['pending', 'packing', 'pending']);

  fixture.control.hold('shipOrder');
  shipRow(0);
  await settle();

  assert.deepEqual(statuses(), ['shipped', 'packing', 'pending'], 'optimistic, not pending');
  assert.equal(countOf('shipOrder', fixture), 1);

  fixture.control.release('shipOrder');
  await settle();

  assert.deepEqual(statuses(), ['shipped', 'packing', 'pending']);
});

test('T04: a failed request puts the badge back and says why', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  fixture.control.fail('shipOrder', new Error('Order already cancelled.'));
  shipRow(1);
  await settle();

  assert.deepEqual(statuses(), ['pending', 'packing', 'pending'], 'rolled back to packing');
  assert.match(text('toast'), /Order already cancelled\./);
});

test('T04: with two in flight and one failing, only that one reverts', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  fixture.control.hold('shipOrder');
  shipRow(0);
  shipRow(1);
  await settle();

  assert.deepEqual(statuses(), ['shipped', 'shipped', 'pending']);

  // The queue answers in arrival order, so the second call is the one that fails.
  fixture.control.fail('shipOrder', new Error('Order already cancelled.'));
  fixture.control.release('shipOrder');
  await settle();

  assert.deepEqual(statuses(), ['pending', 'shipped', 'pending']);
});

test('T04: a list arriving later does not undo a change still in flight', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  fixture.control.hold('shipOrder');
  shipRow(0);
  await settle();

  // The server has not been told yet, so its list still says pending.
  fixture.control.setOrders(ORDERS);
  mount(fixture);
  await settle();

  assert.equal(statuses()[0], 'shipped', 'the optimistic value survives a reload');

  fixture.control.release('shipOrder');
  await settle();
});

// ------------------------------------------------- the toast module

test('the toast shows one message and can be dismissed', async () => {
  const fixture = createFixture();

  mount(fixture);
  await settle();

  assert.equal(one('toast'), null, 'nothing to say, nothing on screen');

  fixture.control.fail('shipOrder', new Error('Nope.'));
  shipRow(0);
  await settle();

  assert.match(text('toast'), /Nope\./);

  fire(one('dismiss-toast') as Element, 'click');
  await settle();

  assert.equal(one('toast'), null);
});
