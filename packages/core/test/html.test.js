// Templates and rendering (SPEC §9, §10d). Written before the implementation.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { signal, computed, flush, html, each, render } from '../src/index.js';
import { liveSubscriptions } from '../src/internal.js';

const window = new Window();
globalThis.document = window.document;
globalThis.FormData = window.FormData; // Node's own FormData cannot read a happy-dom form

let host;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

const text = (el = host) => el.textContent.replace(/\s+/g, ' ').trim();
const $ = (sel) => host.querySelector(sel);
const $$ = (sel) => [...host.querySelectorAll(sel)];

test('static values render once and are escaped as text', () => {
  render(() => html`<p class=${'intro'}>${'<b>hi</b>'} ${42}</p>`, host);
  assert.equal($('p').getAttribute('class'), 'intro');
  assert.equal($('b'), null, 'markup in a value never becomes markup');
  assert.equal(text(), '<b>hi</b> 42');
});

test('a signal passed to a hole is reactive; frame-coalesced; a called signal is read once', () => {
  const count = signal(1);
  render(() => html`<i>${count}</i><u>${count()}</u>`, host);
  assert.equal($('i').textContent, '1');
  count.set(2);
  count.set(3);
  assert.equal($('i').textContent, '1', 'DOM waits for the frame');
  flush();
  assert.equal($('i').textContent, '3');
  assert.equal($('u').textContent, '1', '${count()} was evaluated before the tag ran');
});

test('a text hole update reuses its text node', () => {
  const n = signal('a');
  render(() => html`<span>${n}</span>`, host);
  const node = $('span').firstChild;
  n.set('b');
  flush();
  assert.equal($('span').firstChild, node);
});

test('attribute holes: reactive, null/false remove, true sets empty', () => {
  const cls = signal('on');
  const hidden = signal(true);
  render(() => html`<div class=${cls} hidden="${hidden}"></div>`, host);
  const div = $('div');
  assert.equal(div.getAttribute('class'), 'on');
  assert.equal(div.getAttribute('hidden'), '');
  cls.set(null);
  hidden.set(false);
  flush();
  assert.equal(div.hasAttribute('class'), false);
  assert.equal(div.hasAttribute('hidden'), false);
});

test('property holes set properties, preserving camelCase names', () => {
  const qty = signal('5');
  const off = signal(false);
  render(() => html`<input .value=${qty} .disabled=${off}>`, host);
  const input = $('input');
  assert.equal(input.value, '5');
  qty.set('7');
  off.set(true);
  flush();
  assert.equal(input.value, '7');
  assert.equal(input.disabled, true);
});

test('conditional markup through a computed: one branch at a time, old branch disposed', () => {
  const status = signal('loading');
  const count = signal(0);
  const before = liveSubscriptions();
  const loading = html`<p data-testid="loading">…</p>`;
  const view = () => {
    const body = computed(() =>
      status() === 'loading' ? loading : html`<p data-testid="ready">${count}</p>`);
    return html`<main>${body}</main>`;
  };
  const dispose = render(view, host);
  assert.deepEqual($$('p').map((p) => p.dataset.testid), ['loading']);
  status.set('ready');
  flush();
  assert.deepEqual($$('p').map((p) => p.dataset.testid), ['ready']);
  count.set(5);
  flush();
  assert.equal(text(), '5');
  status.set('loading');
  flush();
  assert.deepEqual($$('p').map((p) => p.dataset.testid), ['loading']);
  dispose();
  assert.equal(liveSubscriptions(), before, 'branch watchers do not leak');
});

test('null, undefined and false render nothing', () => {
  const v = signal(null);
  render(() => html`<b>${v}</b><s>${undefined}</s><q>${false}</q>`, host);
  assert.equal(text(), '');
  v.set('x');
  flush();
  assert.equal(text(), 'x');
});

test('a DOM node in a child hole is inserted as-is and replaced when the hole changes', () => {
  const badge = document.createElement('em');
  badge.textContent = 'new';
  const v = signal(badge);

  render(() => html`<p>${v}</p>`, host);
  assert.equal($('p > em'), badge, 'the same node, not a copy');

  v.set('plain');
  flush();
  assert.equal($('em'), null);
  assert.equal(text(), 'plain');
});

test('events: handler gets a payload, never the raw Event', () => {
  const calls = [];
  const clicked = (p) => calls.push(['click', p]);
  const typed = (p) => calls.push(['input', p]);
  const toggled = (p) => calls.push(['change', p]);
  const submitted = (p) => calls.push(['submit', p]);
  render(() => html`
    <form @submit=${submitted}>
      <input name="qty" value="3" @input=${typed}>
      <input type="checkbox" name="gift" @change=${toggled}>
      <button type="button" @click=${clicked}>go</button>
    </form>`, host);
  $('button').click();
  const qty = $('input[name=qty]');
  qty.value = '12';
  qty.dispatchEvent(new window.Event('input', { bubbles: true }));
  const gift = $('input[type=checkbox]');
  gift.checked = true;
  gift.dispatchEvent(new window.Event('change', { bubbles: true }));
  const submit = new window.Event('submit', { bubbles: true, cancelable: true });
  $('form').dispatchEvent(submit);
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
  const button = $('button');

  dispose();
  button.click();
  assert.equal(calls, 0);
});

test('holes inside a tag must be whole attribute values', () => {
  const c = 'x';
  assert.throws(() => render(() => html`<p class="a ${c}"></p>`, host), /whole attribute value/);
});

// each (SPEC §9): keyed reconciliation. A row gets one accessor for its item;
// derived cells are computeds in the row.

const rowsOf = () => $$('li');
const field = (item, name) => computed(() => item()[name]);

test('each: renders rows in order from a signal of items', () => {
  const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  render(() => html`<ul>${each(items, (item) => html`<li>${field(item, 't')}</li>`)}</ul>`, host);
  assert.deepEqual(rowsOf().map((li) => li.textContent), ['a', 'b']);
});

test('each: reordering moves existing nodes instead of rebuilding them', () => {
  const a = { id: 1, t: 'a' }, b = { id: 2, t: 'b' }, c = { id: 3, t: 'c' };
  const items = signal([a, b, c]);
  render(() => html`<ul>${each(items, (item) => html`<li>${field(item, 't')}</li>`)}</ul>`, host);
  const [la, lb, lc] = rowsOf();
  items.set([c, a, b]);
  flush();
  assert.deepEqual(rowsOf(), [lc, la, lb]);
});

test('each: a new item object under the same key updates cells, never rebuilds the row', () => {
  let rowRuns = 0;
  const items = signal([{ id: 1, t: 'a', n: 1 }, { id: 2, t: 'b', n: 1 }]);
  render(() => html`<ul>${each(items, (item) => {
    rowRuns++;
    return html`<li>${field(item, 't')}:${field(item, 'n')}</li>`;
  })}</ul>`, host);
  const [la, lb] = rowsOf();
  const textT = lb.firstChild;
  items.set([items()[0], { id: 2, t: 'b', n: 2 }]);
  flush();
  assert.deepEqual(rowsOf(), [la, lb], 'same row nodes');
  assert.equal(lb.textContent, 'b:2');
  assert.equal(lb.firstChild, textT, 'unchanged cell untouched');
  assert.equal(rowRuns, 2, 'row function runs once per key');
});

test('each: removed rows are disposed', () => {
  const before = liveSubscriptions();
  const tick = signal(0);
  const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  const dispose = render(() => html`<ul>${each(items, (item) => html`<li>${field(item, 't')}${tick}</li>`)}</ul>`, host);
  items.set([items()[0]]);
  flush();
  assert.equal(rowsOf().length, 1);
  dispose();
  assert.equal(liveSubscriptions(), before);
});

test('each: primitive items key by value; objects need an id', () => {
  const tags = signal(['x', 'y']);
  render(() => html`<ul>${each(tags, (tag) => html`<li>${tag}</li>`)}</ul>`, host);
  assert.deepEqual(rowsOf().map((li) => li.textContent), ['x', 'y']);
  assert.throws(
    () => render(() => html`${each([{ name: 'no id' }], () => html`<li></li>`)}`, host),
    /id/,
  );
  assert.throws(
    () => render(() => html`${each([1, 1], () => html`<li></li>`)}`, host),
    /duplicate key/,
  );
});

test('each: a handler inside a row receives the row item, current at event time', () => {
  const calls = [];
  const ship = (payload, order) => calls.push([payload, order]);
  const items = signal([{ id: 1, status: 'new' }, { id: 2, status: 'new' }]);
  render(() => html`<ul>${each(items, (item) => {
    const done = computed(() => item().status === 'shipped');
    const branch = computed(() => (done() ? null : html`<button @click=${ship}>ship</button>`));
    return html`<li>${branch}</li>`;
  })}</ul>`, host);
  $$('button')[1].click();
  assert.deepEqual(calls, [[undefined, { id: 2, status: 'new' }]]);
  items.set([{ id: 1, status: 'new', note: 'x' }, items()[1]]);
  flush();
  $$('button')[0].click();
  assert.deepEqual(calls[1], [undefined, { id: 1, status: 'new', note: 'x' }], 'latest item, from a nested template');
});

test('each: in nested rows a handler gets the innermost item', () => {
  const calls = [];
  const pick = (payload, line) => calls.push(line);
  const orders = [{ id: 1, lines: [{ id: 'a' }, { id: 'b' }] }];
  render(() => html`${each(orders, (order) =>
    html`<ol>${each(order().lines, () => html`<li @click=${pick}></li>`)}</ol>`)}`, host);
  $$('li')[1].click();
  assert.deepEqual(calls, [{ id: 'b' }]);
});

test('events outside any row get no second argument', () => {
  const calls = [];
  const go = (...args) => calls.push(args);
  render(() => html`<button @click=${go}></button>`, host);
  $('button').click();
  assert.deepEqual(calls, [[undefined]]);
});

// render (SPEC §10d): owns only its subtree

test('render: dispose removes its nodes and nothing else; 1000 cycles leak nothing', () => {
  const sibling = document.createElement('aside');
  host.append(sibling);
  const shared = signal(0);
  const items = signal([{ id: 1 }, { id: 2 }]);
  const before = liveSubscriptions();
  for (let i = 0; i < 1000; i++) {
    const dispose = render(() => html`<section>${shared}${each(items, (item) => html`<b>${shared}${field(item, 'id')}</b>`)}</section>`, host);
    shared.set(i);
    flush();
    dispose();
  }
  assert.equal(liveSubscriptions(), before);
  assert.deepEqual([...host.childNodes], [sibling]);
});
