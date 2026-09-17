// Windowed lists (SPEC §9): a fixed pool of rows rewritten in place as the
// window moves. Written before the implementation, and driven entirely by the
// caller's numbers — happy-dom has no layout, which is exactly why the window
// is an input rather than something `each` measures (ADR 0003).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { dom, freshHost } from './dom.ts';
import {
  computed,
  each,
  type EachWindow,
  flush,
  html,
  render,
  signal,
  type Accessor,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

let host: Element;

beforeEach(() => {
  host = freshHost();
});

const POOL = 8;
const ROW_HEIGHT = 25;
const TOTAL = 1000;

interface Item {
  id: number;
  n: number;
}

const seed = (total: number, from = 0): Item[] =>
  Array.from({ length: total }, (_, index) => ({ id: index, n: index + from }));

const rowsOf = (): Element[] => [...host.querySelectorAll('li:not([role="presentation"])')];

const shown = (): number[] => rowsOf().map((li) => Number(li.textContent));

const spacers = (): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('[role="presentation"]'),
];

const heights = (): string[] => spacers().map((element) => element.style.height);

const cell = (item: Accessor<Item>): Accessor<unknown> => computed(() => item().n);

/** The caller's job in one place: where the window sits, and how big it is. */
function port(start: number, count = POOL): Accessor<EachWindow> {
  return () => ({ start, count, rowHeight: ROW_HEIGHT });
}

test('a window renders the slice it names, in order', () => {
  render(
    () => html`<ul>
      ${each(seed(TOTAL), (item) => html`<li>${cell(item)}</li>`, port(300))}
    </ul>`,
    host,
  );

  assert.deepEqual(shown(), [300, 301, 302, 303, 304, 305, 306, 307]);
});

test('scrolling the window across the whole list builds no new rows', () => {
  const items = signal(seed(TOTAL));
  const start = signal(0);
  const view = computed(() => ({ start: start(), count: POOL, rowHeight: ROW_HEIGHT }));
  let built = 0;

  render(
    () =>
      html`<ul>
        ${each(
          items,
          (item) => {
            built++;

            return html`<li>${cell(item)}</li>`;
          },
          view,
        )}
      </ul>`,
    host,
  );

  assert.equal(built, POOL, 'the pool is built once');

  for (let top = 0; top <= TOTAL - POOL; top++) {
    start.set(top);
    flush();
  }

  // The headline guarantee: 992 scroll steps past 1000 rows, and the DOM still
  // holds the eight nodes it started with.
  assert.equal(built, POOL, 'scrolling rewrites rows; it does not create them');
  assert.equal(rowsOf().length, POOL);
  assert.deepEqual(shown(), [992, 993, 994, 995, 996, 997, 998, 999]);
});

test('spacers hold open the rows that are not in the DOM', () => {
  const start = signal(0);
  const view = computed(() => ({ start: start(), count: POOL, rowHeight: ROW_HEIGHT }));

  render(
    () => html`<ul>
      ${each(seed(TOTAL), (item) => html`<li>${cell(item)}</li>`, view)}
    </ul>`,
    host,
  );

  assert.deepEqual(heights(), ['0px', `${(TOTAL - POOL) * ROW_HEIGHT}px`]);

  start.set(400);
  flush();
  assert.deepEqual(heights(), [`${400 * ROW_HEIGHT}px`, `${(TOTAL - 400 - POOL) * ROW_HEIGHT}px`]);

  // A spacer is a row's own tag, so the list stays valid to a screen reader
  // and to Lighthouse's `list` audit.
  assert.deepEqual(
    spacers().map((element) => element.tagName.toLowerCase()),
    ['li', 'li'],
  );
});

test('a spacer falls back to a neutral tag when a row has no element of its own', () => {
  render(
    () => html`<div>${each(seed(TOTAL), (item) => html`${cell(item)}`, port(0, 2))}</div>`,
    host,
  );

  assert.deepEqual(
    spacers().map((element) => element.tagName.toLowerCase()),
    ['div', 'div'],
  );
});

test('a list change rewrites only the rows in the window', () => {
  const items = signal(seed(TOTAL));
  let cells = 0;

  render(
    () =>
      html`<ul>
        ${each(
          items,
          (item) =>
            html`<li>
              ${computed(() => {
                cells++;

                return item().n;
              })}
            </li>`,
          port(500),
        )}
      </ul>`,
    host,
  );

  assert.equal(cells, POOL);

  items.set(seed(TOTAL, 1));
  flush();

  // A thousand new objects arrived and eight cells recomputed. The keyed path
  // would have written all thousand.
  assert.equal(cells, POOL * 2);
  assert.deepEqual(shown(), [501, 502, 503, 504, 505, 506, 507, 508]);
});

test('growing and shrinking the window adds and removes exactly the difference', () => {
  const count = signal(POOL);
  const view = computed(() => ({ start: 0, count: count(), rowHeight: ROW_HEIGHT }));
  let built = 0;

  render(
    () =>
      html`<ul>
        ${each(
          seed(TOTAL),
          (item) => {
            built++;

            return html`<li>${cell(item)}</li>`;
          },
          view,
        )}
      </ul>`,
    host,
  );

  count.set(POOL + 4);
  flush();
  assert.equal(rowsOf().length, POOL + 4);
  assert.equal(built, POOL + 4, 'growing builds four rows, not twelve');

  count.set(POOL - 3);
  flush();
  assert.equal(rowsOf().length, POOL - 3);
  assert.equal(built, POOL + 4, 'shrinking builds nothing');
  assert.deepEqual(heights(), ['0px', `${(TOTAL - POOL + 3) * ROW_HEIGHT}px`]);
});

test('a window past the end of the list shows the last rows there are', () => {
  const start = signal(TOTAL * 2);
  const view = computed(() => ({ start: start(), count: POOL, rowHeight: ROW_HEIGHT }));

  render(
    () => html`<ul>
      ${each(seed(TOTAL), (item) => html`<li>${cell(item)}</li>`, view)}
    </ul>`,
    host,
  );

  assert.deepEqual(shown(), [992, 993, 994, 995, 996, 997, 998, 999]);
  assert.deepEqual(heights(), [`${(TOTAL - POOL) * ROW_HEIGHT}px`, '0px']);

  // A rubber-banding scroll reports a negative offset; it is not an error.
  start.set(-40);
  flush();
  assert.deepEqual(shown(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('a window bigger than the list renders the list, and a count of zero renders nothing', () => {
  const count = signal(50);
  const view = computed(() => ({ start: 0, count: count(), rowHeight: ROW_HEIGHT }));

  render(
    () => html`<ul>
      ${each(seed(10), (item) => html`<li>${cell(item)}</li>`, view)}
    </ul>`,
    host,
  );

  assert.equal(rowsOf().length, 10);
  assert.deepEqual(heights(), ['0px', '0px']);

  count.set(0);
  flush();
  assert.equal(rowsOf().length, 0);

  // Nothing is rendered, but the list is still ten rows tall.
  assert.deepEqual(heights(), ['0px', `${10 * ROW_HEIGHT}px`]);
});

test('an empty list renders no rows and no spacers', () => {
  const items = signal<Item[]>([]);

  render(
    () => html`<ul>
      ${each(items, (item) => html`<li>${cell(item)}</li>`, port(0))}
    </ul>`,
    host,
  );

  assert.deepEqual(rowsOf(), []);
  assert.deepEqual(spacers(), []);

  items.set(seed(20));
  flush();
  assert.deepEqual(shown(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(heights(), ['0px', `${12 * ROW_HEIGHT}px`]);
});

test('a spacer is never a custom element, so it cannot become a component', () => {
  let built = 0;

  class Card extends (dom.HTMLElement as unknown as typeof HTMLElement) {
    constructor() {
      super();
      built += 1;
      this.attachShadow({ mode: 'open' }).innerHTML = '<i>chrome</i>';
    }
  }

  dom.customElements.define('x-card', Card as unknown as never);

  render(
    () =>
      html`<div>
        ${each(seed(TOTAL), (item) => html`<x-card>${cell(item)}</x-card>`, port(0))}
      </div>`,
    host,
  );

  const tags = spacers().map((element) => element.tagName.toLowerCase());

  assert.deepEqual(tags, ['div', 'div'], 'a spacer falls back to a neutral box');
  assert.ok(built > 0, 'the rows really are components');

  // The point of the tag rule: a spacer builds nothing. Counting constructor
  // calls would not prove it here — happy-dom upgrades custom elements inside
  // a <template>, which a real browser does not, because template contents
  // belong to an inert document.
  for (const element of spacers()) {
    assert.equal(element.shadowRoot, null, 'a spacer has no component inside it');
    assert.equal(element.textContent, '', 'and renders nothing');
  }
});

test('a windowed list disposes clean: 200 cycles leak nothing', () => {
  const items = signal(seed(TOTAL));
  const start = signal(0);
  const view = computed(() => ({ start: start(), count: POOL, rowHeight: ROW_HEIGHT }));
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < 200; cycle++) {
    const dispose = render(
      () =>
        html`<ul>
          ${each(items, (item) => html`<li>${cell(item)}</li>`, view)}
        </ul>`,
      host,
    );

    start.set(cycle);
    flush();
    dispose();
  }

  assert.equal(liveSubscriptions(), before);
  assert.deepEqual([...host.childNodes], []);
});
