// Templates and rendering (SPEC §9, §10d). Written before the implementation.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { dom, freshHost } from './dom.ts';
import {
  computed,
  each,
  ErrorCode,
  flush,
  html,
  render,
  signal,
  SheratanError,
  type Accessor,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

let host: Element;

beforeEach(() => {
  host = freshHost();
});

const text = (element: Element = host): string => element.textContent.replace(/\s+/g, ' ').trim();
const $ = (selector: string): Element => host.querySelector(selector) as Element;
const $$ = (selector: string): Element[] => [...host.querySelectorAll(selector)];

const hasCode =
  (code: string) =>
  (error: unknown): boolean =>
    error instanceof SheratanError && error.code === code;

test('static values render once and are escaped as text', () => {
  const markup = '<em>not markup</em>';

  render(() => html`<p>${markup}</p>`, host);
  assert.equal($('p').querySelector('em'), null, 'interpolation never becomes markup');
  assert.ok($('p').innerHTML.startsWith('&lt;em&gt;not markup&lt;/em&gt;'));
  assert.equal(text($('p')), markup);
});

test('a signal passed to a hole is reactive; frame-coalesced; a called signal is read once', () => {
  const live = signal('a');
  const once = signal('x');

  render(
    () =>
      html`<p>${live}</p>
        <q>${once()}</q>`,
    host,
  );

  assert.equal(text($('p')), 'a');

  live.set('b');
  once.set('y');
  assert.equal(text($('p')), 'a', 'no DOM write before the frame');

  flush();
  assert.equal(text($('p')), 'b');
  assert.equal(text($('q')), 'x', 'a called signal was read once at mount');
});

test('a text hole update reuses its text node', () => {
  const value = signal('a');

  render(() => html`<p>${value}</p>`, host);

  const node = $('p').firstChild;

  value.set('b');
  flush();
  assert.equal($('p').firstChild, node, 'same text node');
  assert.equal(text($('p')), 'b');
});

test('attribute holes: reactive, null/false remove, true sets empty', () => {
  const tone = signal<string | null | boolean>('warn');

  render(() => html`<p class=${tone} data-static="keep"></p>`, host);
  assert.equal($('p').getAttribute('class'), 'warn');

  tone.set(null);
  flush();
  assert.equal($('p').hasAttribute('class'), false);

  tone.set(true);
  flush();
  assert.equal($('p').getAttribute('class'), '');

  tone.set(false);
  flush();
  assert.equal($('p').hasAttribute('class'), false);
  assert.equal($('p').getAttribute('data-static'), 'keep');
});

test('property holes set properties, preserving camelCase names', () => {
  const value = signal('typed');

  render(() => html`<input .value=${value} />`, host);
  assert.equal(($('input') as HTMLInputElement).value, 'typed');

  value.set('again');
  flush();
  assert.equal(($('input') as HTMLInputElement).value, 'again');
});

test('quoted attribute holes are accepted and unquoted ones too', () => {
  const id = signal('a');

  render(() => html`<p id="${id}" title=${id}></p>`, host);
  assert.equal($('p').getAttribute('id'), 'a');
  assert.equal($('p').getAttribute('title'), 'a');
});

test('a plain value in an attribute or property hole is written once', () => {
  render(() => html`<p class=${'fixed'} .id=${'once'}></p>`, host);
  assert.equal($('p').getAttribute('class'), 'fixed');
  assert.equal($('p').id, 'once');
});

test('conditional markup through a computed: one branch at a time, old branch disposed', () => {
  const before = liveSubscriptions();
  const failed = signal(false);
  const detail = signal('details');
  const body = computed(() => (failed() ? html`<b>${detail}</b>` : html`<i>fine</i>`));

  render(() => html`<main>${body}</main>`, host);
  assert.equal(text(), 'fine');

  failed.set(true);
  flush();
  assert.equal(text(), 'details');
  assert.equal($$('i').length, 0);

  failed.set(false);
  flush();
  assert.equal(text(), 'fine');

  detail.set('ignored');
  flush();
  assert.equal(text(), 'fine');
  assert.ok(liveSubscriptions() >= before, 'branch watchers do not leak');
});

test('null, undefined and false render nothing', () => {
  const value = signal<string | null>(null);

  render(() => html`<b>${value}</b><s>${undefined}</s><q>${false}</q>`, host);
  assert.equal(text(), '');

  value.set('x');
  flush();
  assert.equal(text(), 'x');
});

test('a DOM node in a child hole is inserted as-is and replaced when the hole changes', () => {
  const badge = document.createElement('em');

  badge.textContent = 'new';

  const value = signal<Element | string>(badge);

  render(() => html`<p>${value}</p>`, host);
  assert.equal($('p > em'), badge, 'the same node, not a copy');

  value.set('plain');
  flush();
  assert.equal($('em'), null);
  assert.equal(text(), 'plain');
});

test('events: handler gets a payload, never the raw Event', () => {
  const calls: [string, unknown][] = [];

  const clicked = (payload: unknown): void => {
    calls.push(['click', payload]);
  };

  const typed = (payload: unknown): void => {
    calls.push(['input', payload]);
  };

  const toggled = (payload: unknown): void => {
    calls.push(['change', payload]);
  };

  const submitted = (payload: unknown): void => {
    calls.push(['submit', payload]);
  };

  render(
    () => html` <form @submit=${submitted}>
      <input name="qty" value="3" @input=${typed} />
      <input type="checkbox" name="gift" @change=${toggled} />
      <button type="button" @click=${clicked}>go</button>
    </form>`,
    host,
  );

  ($('button') as HTMLElement).click();

  const qty = $('input[name=qty]') as HTMLInputElement;

  qty.value = '12';
  qty.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);

  const gift = $('input[type=checkbox]') as HTMLInputElement;

  gift.checked = true;
  gift.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event);

  const submit = new dom.Event('submit', { bubbles: true, cancelable: true });

  $('form').dispatchEvent(submit as unknown as Event);

  assert.deepEqual(calls, [
    ['click', undefined],
    ['input', '12'],
    ['change', true],
    ['submit', { qty: '12', gift: 'on' }],
  ]);

  assert.equal(submit.defaultPrevented, true);
});

test('events: disposal removes listeners, so a retained node no longer calls the handler', () => {
  let calls = 0;
  const dispose = render(() => html`<button @click=${() => calls++}>go</button>`, host);
  const button = $('button') as HTMLElement;

  dispose();
  button.click();
  assert.equal(calls, 0);
});

test('an @event hole that is not a function fails with SHR-R005', () => {
  assert.throws(
    () => render(() => html`<button @click=${'nope'}>go</button>`, host),
    hasCode(ErrorCode.EventHoleNotFunction),
  );
});

test('holes inside a tag must be whole attribute values (SHR-R003)', () => {
  const value = 'x';

  assert.throws(
    () => render(() => html`<p class="a ${value}"></p>`, host),
    hasCode(ErrorCode.PartialAttributeHole),
  );

  assert.throws(
    () => render(() => html`<p title="name=${value}"></p>`, host),
    hasCode(ErrorCode.PartialAttributeHole),
  );
});

test('an array in a hole fails with SHR-R008 instead of rendering [object Object]', () => {
  const parts = [html`<b>a</b>`, html`<b>b</b>`];

  assert.throws(() => render(() => html`<p>${parts}</p>`, host), hasCode(ErrorCode.ArrayInHole));
});

test('a hole the HTML parser cannot keep fails with SHR-R004', () => {
  const value = signal('x');

  // A raw-text element keeps the marker as literal text, so the hole has no
  // node to bind to. Same in a browser for <textarea> and <title>.
  assert.throws(
    () =>
      render(
        () =>
          html`<style>
            ${value}
          </style>`,
        host,
      ),
    hasCode(ErrorCode.UnreachableHole),
  );
});

// Parse-once guarantees (AGENTS.md complexity table).

test('the parsed template carries no markers: mounting never scans or parses', () => {
  const tone = signal('warn');
  const label = signal('hi');

  render(
    () =>
      html`<section>
        <p class=${tone}><b>${label}</b></p>
      </section>`,
    host,
  );

  const section = $('section');

  assert.equal(section.outerHTML.includes('sh-'), false, 'no marker attributes survive');

  for (const node of section.querySelectorAll('*')) {
    for (const attribute of node.attributes) {
      assert.equal(attribute.name.startsWith('sh-'), false);
    }
  }
});

test('holes resolve at any depth, in document order, including several per element', () => {
  const first = signal('1');
  const second = signal('2');
  const third = signal('3');

  render(
    () => html`<article>
      <header id=${first} class=${second}><h1>${first}</h1></header>
      <p><span>${second}</span><span>${third}</span></p>
      <footer>${third}</footer>
    </article>`,
    host,
  );

  assert.equal($('header').getAttribute('id'), '1');
  assert.equal($('header').getAttribute('class'), '2');
  assert.equal(text($('h1')), '1');
  assert.equal(text($$('span')[0] as Element), '2');
  assert.equal(text($$('span')[1] as Element), '3');
  assert.equal(text($('footer')), '3');

  third.set('changed');
  flush();
  assert.equal(text($$('span')[1] as Element), 'changed');
  assert.equal(text($('footer')), 'changed');
});

// each (SPEC §9): keyed reconciliation. A row gets one accessor for its item;
// derived cells are computeds in the row.

interface Item {
  id: number;
  t?: string;
  n?: number;
  status?: string;
  note?: string;
}

const rowsOf = (): Element[] => $$('li');

const field = (item: Accessor<Item>, name: 't' | 'n' | 'status'): Accessor<unknown> =>
  computed(() => item()[name]);

test('each: renders rows in order from a signal of items', () => {
  const items = signal<Item[]>([
    { id: 1, t: 'a' },
    { id: 2, t: 'b' },
  ]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${field(item, 't')}</li>`)}
      </ul>`,
    host,
  );

  assert.deepEqual(
    rowsOf().map((li) => li.textContent),
    ['a', 'b'],
  );
});

test('each: reordering moves existing nodes instead of rebuilding them', () => {
  const a = { id: 1, t: 'a' };
  const b = { id: 2, t: 'b' };
  const c = { id: 3, t: 'c' };
  const items = signal<Item[]>([a, b, c]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${field(item, 't')}</li>`)}
      </ul>`,
    host,
  );

  const [first, second, third] = rowsOf();

  items.set([c, a, b]);
  flush();
  assert.deepEqual(rowsOf(), [third, first, second]);
});

test('each: one row moving performs one DOM move, not n', () => {
  const items = signal<Item[]>(Array.from({ length: 500 }, (_, index) => ({ id: index })));

  render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${field(item, 'n')}</li>`)}
      </ul>`,
    host,
  );

  const list = $('ul');
  let moves = 0;
  const insertBefore = list.insertBefore.bind(list);

  list.insertBefore = ((node: Node, anchor: Node | null) => {
    moves++;

    return insertBefore(node, anchor);
  }) as typeof list.insertBefore;

  const next = [...items()] as Item[];
  const [moved] = next.splice(0, 1) as [Item];

  next.push(moved);
  items.set(next);
  flush();

  assert.equal(moves, 1, 'moving the head to the tail is one move');
  assert.equal(rowsOf().length, 500);

  moves = 0;
  items.set(items().slice(0, 400));
  flush();
  assert.equal(moves, 0, 'removing a tail moves nothing');
});

test('each: inserting at the head leaves the matching tail untouched', () => {
  const items = signal<Item[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${field(item, 'n')}</li>`)}
      </ul>`,
    host,
  );

  const before = rowsOf();
  const list = $('ul');
  let moves = 0;
  const insertBefore = list.insertBefore.bind(list);

  list.insertBefore = ((node: Node, anchor: Node | null) => {
    moves++;

    return insertBefore(node, anchor);
  }) as typeof list.insertBefore;

  items.set([{ id: 0 }, ...items()] as Item[]);
  flush();

  assert.equal(moves, 1, 'only the new row is inserted');
  assert.deepEqual(rowsOf().slice(1), before, 'the old rows are the same nodes');
});

test('each: a new item object under the same key updates cells, never rebuilds the row', () => {
  let rowRuns = 0;

  const items = signal<Item[]>([
    { id: 1, t: 'a', n: 1 },
    { id: 2, t: 'b', n: 1 },
  ]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => {
          rowRuns++;

          return html`<li>${field(item, 't')}:${field(item, 'n')}</li>`;
        })}
      </ul>`,
    host,
  );

  const [first, second] = rowsOf() as [Element, Element];
  const cell = second.firstChild;

  items.set([items()[0] as Item, { id: 2, t: 'b', n: 2 }]);
  flush();
  assert.deepEqual(rowsOf(), [first, second], 'same row nodes');
  assert.equal(second.textContent, 'b:2');
  assert.equal(second.firstChild, cell, 'unchanged cell untouched');
  assert.equal(rowRuns, 2, 'row function runs once per key');
});

test('each: removed rows are disposed', () => {
  const before = liveSubscriptions();
  const tick = signal(0);

  const items = signal<Item[]>([
    { id: 1, t: 'a' },
    { id: 2, t: 'b' },
  ]);

  const dispose = render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${field(item, 't')}${tick}</li>`)}
      </ul>`,
    host,
  );

  items.set([items()[0] as Item]);
  flush();
  assert.equal(rowsOf().length, 1);

  dispose();
  assert.equal(liveSubscriptions(), before);
});

test('each: primitive items key by value; objects need an id (SHR-R006, SHR-R007)', () => {
  const tags = signal(['x', 'y']);

  render(
    () =>
      html`<ul>
        ${each(tags, (tag) => html`<li>${tag}</li>`)}
      </ul>`,
    host,
  );

  assert.deepEqual(
    rowsOf().map((li) => li.textContent),
    ['x', 'y'],
  );

  assert.throws(
    () => render(() => html`${each([{ name: 'no id' }], () => html`<li></li>`)}`, host),
    hasCode(ErrorCode.EachItemWithoutId),
  );

  assert.throws(
    () => render(() => html`${each([1, 1], () => html`<li></li>`)}`, host),
    hasCode(ErrorCode.EachDuplicateKey),
  );
});

test('each: a handler inside a row receives the row item, current at event time', () => {
  const calls: [unknown, unknown][] = [];

  const ship = (payload: unknown, order?: unknown): void => {
    calls.push([payload, order]);
  };

  const items = signal<Item[]>([
    { id: 1, status: 'new' },
    { id: 2, status: 'new' },
  ]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => {
          const done = computed(() => item().status === 'shipped');

          const branch = computed(() =>
            done() ? null : html`<button @click=${ship}>ship</button>`,
          );

          return html`<li>${branch}</li>`;
        })}
      </ul>`,
    host,
  );

  ($$('button')[1] as HTMLElement).click();
  assert.deepEqual(calls, [[undefined, { id: 2, status: 'new' }]]);

  items.set([{ id: 1, status: 'new', note: 'x' }, items()[1] as Item]);
  flush();
  ($$('button')[0] as HTMLElement).click();

  assert.deepEqual(
    calls[1],
    [undefined, { id: 1, status: 'new', note: 'x' }],
    'latest item, from a nested template',
  );
});

test('each: in nested rows a handler gets the innermost item', () => {
  const calls: unknown[] = [];

  const pick = (_payload: unknown, line?: unknown): void => {
    calls.push(line);
  };

  const orders = [{ id: 1, lines: [{ id: 'a' }, { id: 'b' }] }];

  render(
    () =>
      html`${each(
        orders,
        (order) =>
          html`<ol>
            ${each(order().lines, () => html`<li @click=${pick}></li>`)}
          </ol>`,
      )}`,
    host,
  );

  ($$('li')[1] as HTMLElement).click();
  assert.deepEqual(calls, [{ id: 'b' }]);
});

test('events outside any row get no second argument', () => {
  const calls: unknown[][] = [];

  const go = (...args: unknown[]): void => {
    calls.push(args);
  };

  render(() => html`<button @click=${go}></button>`, host);
  ($('button') as HTMLElement).click();
  assert.deepEqual(calls, [[undefined]]);
});

// render (SPEC §10d): owns only its subtree

test('render: dispose removes its nodes and nothing else; 1000 cycles leak nothing', () => {
  const sibling = document.createElement('aside');

  host.append(sibling);

  const shared = signal(0);
  const items = signal<Item[]>([{ id: 1 }, { id: 2 }]);
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < 1000; cycle++) {
    const dispose = render(
      () =>
        html`<section>
          ${shared}${each(items, (item) => html`<b>${shared}${field(item, 'n')}</b>`)}
        </section>`,
      host,
    );

    shared.set(cycle);
    flush();
    dispose();
  }

  assert.equal(liveSubscriptions(), before);
  assert.deepEqual([...host.childNodes], [sibling]);
});
