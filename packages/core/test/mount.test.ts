// Composing modules (SPEC §9a): a view renders another module, without
// importing it and without constructing it. Written against the public API,
// because that is what an app writes.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { freshHost } from './dom.ts';
import {
  computed,
  ErrorCode,
  flush,
  html,
  mount,
  onDispose,
  render,
  signal,
  SheratanError,
  type Accessor,
  type Template,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

let host: Element;

beforeEach(() => {
  host = freshHost();
});

const text = (): string => host.textContent.replaceAll(/\s+/g, ' ').trim();

/** A module as its `index.ts` hands it over: a factory returning a view. */
function createCounter(label: string): () => Template {
  return () => {
    const count = signal(0);
    const shown = computed(() => `${label} ${String(count())}`);

    return html`<p>${shown}</p>`;
  };
}

test('a view renders another module in a hole', () => {
  const activity = createCounter('runs');

  render(() => html`<main><aside>${mount(activity)}</aside></main>`, host);

  assert.equal(text(), 'runs 0');
  assert.equal(host.querySelectorAll('aside > p').length, 1);
});

test('props carry accessors, so the child updates without re-rendering', () => {
  const customerId = signal('c1');
  let views = 0;

  const ordersTable = (props: { customerId: Accessor<string> }): Template => {
    views += 1;

    return html`<table data-for=${props.customerId}></table>`;
  };

  render(() => html`<section>${mount(ordersTable, { customerId })}</section>`, host);

  const table = host.querySelector('table') as Element;

  assert.equal(table.getAttribute('data-for'), 'c1');

  customerId.set('c2');
  flush();

  assert.equal(table.getAttribute('data-for'), 'c2', 'the same node, rewritten');
  assert.equal(views, 1, 'the child view ran once');
});

test("a child's lifetime is the parent's: unmounting disposes it", () => {
  const stopped: string[] = [];

  const child = (): Template => {
    onDispose(() => stopped.push('child'));

    return html`<p>child</p>`;
  };

  const parent = (): Template => {
    onDispose(() => stopped.push('parent'));

    return html`<main>${mount(child)}</main>`;
  };

  const dispose = render(parent, host);

  assert.equal(text(), 'child');

  dispose();

  assert.deepEqual(stopped, ['child', 'parent']);
  assert.equal(text(), '');
});

test('swapping the module in a reactive hole disposes the one it replaces', () => {
  const stopped: string[] = [];

  const module = (name: string): (() => Template) => {
    return () => {
      onDispose(() => stopped.push(name));

      return html`<p>${name}</p>`;
    };
  };

  const orders = module('orders');
  const customers = module('customers');
  const route = signal('orders');
  const screen = computed(() => (route() === 'orders' ? mount(orders) : mount(customers)));

  render(() => html`<main>${screen}</main>`, host);

  assert.equal(text(), 'orders');

  route.set('customers');
  flush();

  assert.equal(text(), 'customers');
  assert.deepEqual(stopped, ['orders'], 'the old module was disposed, exactly once');
  assert.equal(host.querySelectorAll('p').length, 1, 'and its nodes went with it');
});

// The child runs in a scope of its own, with tracking off. Without it, a
// signal the child's view reads while mounting becomes a dependency of the
// parent's hole, and the next write rebuilds the whole child instead of
// rewriting the one node that shows it.
test("what a child reads while mounting is not the parent's dependency", () => {
  const ticks = signal(0);
  let built = 0;

  const child = (): Template => {
    built += 1;

    return html`<p>tick ${String(ticks())}</p>`;
  };

  const screen = computed(() => mount(child));

  render(() => html`<main>${screen}</main>`, host);

  assert.equal(text(), 'tick 0');

  ticks.set(1);
  flush();

  assert.equal(built, 1, 'the parent hole did not re-run');
});

test('one mount() belongs to one hole', () => {
  const activity = createCounter('runs');
  const placed = mount(activity);

  assert.throws(
    () => render(() => html`<main>${placed}${placed}</main>`, host),
    (error: unknown) => error instanceof SheratanError && error.code === ErrorCode.MountedTwice,
  );
});

test('mounting and unmounting a child leaks no subscriptions', () => {
  const before = liveSubscriptions();

  for (let run = 0; run < 100; run += 1) {
    const dispose = render(() => html`<main>${mount(createCounter('runs'))}</main>`, host);

    flush();
    dispose();
  }

  assert.equal(liveSubscriptions(), before);
});
