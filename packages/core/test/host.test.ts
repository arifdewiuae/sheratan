// Behaviour that depends on what the host provides (SPEC §9, §10d): the
// scheduler's frame source, the DOM's state-preserving move, and the mark
// `global.css` scopes to (SPEC §9a, ADR 0008).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { freshHost } from './dom.ts';
import { each, flush, html, render, signal } from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

const ROOT_MARK = 'data-sheratan-root';

let host: Element;

beforeEach(() => {
  host = freshHost();
});

interface Row {
  id: number;
}

test('the scheduler uses requestAnimationFrame when the host has one', async () => {
  const frames: (() => void)[] = [];
  const hostGlobals = globalThis as { requestAnimationFrame?: unknown };

  hostGlobals.requestAnimationFrame = (callback: () => void): number => {
    frames.push(callback);

    return frames.length;
  };

  try {
    const value = signal('a');

    render(() => html`<p>${value}</p>`, host);
    value.set('b');

    assert.equal(frames.length, 1, 'one frame requested, not a timer');
    assert.equal(host.textContent, 'a', 'nothing written before the frame runs');

    (frames[0] as () => void)();
    assert.equal(host.textContent, 'b');
  } finally {
    delete hostGlobals.requestAnimationFrame;
  }
});

test('a row moves with moveBefore where the browser has it, so state survives', async () => {
  const items = signal<Row[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);

  render(
    () =>
      html`<ul>
        ${each(items, (item) => html`<li>${() => String(item().id)}</li>`)}
      </ul>`,
    host,
  );

  const list = host.querySelector('ul') as Element & { moveBefore?: unknown; isConnected: boolean };
  const moved: string[] = [];
  const insertBefore = list.insertBefore.bind(list);

  list.moveBefore = (node: Node, anchor: Node | null): void => {
    moved.push(String(node.textContent).trim());
    insertBefore(node, anchor);
  };

  const [first, ...rest] = items() as Row[];

  items.set([...rest, first] as Row[]);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(moved, ['1'], 'the moved row went through moveBefore');

  assert.deepEqual(
    [...list.querySelectorAll('li')].map((li) => li.textContent.trim()),
    ['2', '3', '1'],
  );
});

test('render() marks the element it mounts into, and dispose removes the mark', () => {
  const dispose = render(() => html`<p>widget</p>`, host);

  assert.equal(host.getAttribute(ROOT_MARK), '', 'global.css styles under this mark');

  dispose();

  assert.equal(host.hasAttribute(ROOT_MARK), false, "the host page's element is as it was");
});

test('a host already marked keeps its mark after dispose', () => {
  // index.html writes <body data-sheratan-root>, so the first paint is styled.
  host.setAttribute(ROOT_MARK, '');

  const dispose = render(() => html`<p>page</p>`, host);

  dispose();

  assert.equal(host.hasAttribute(ROOT_MARK), true);
});

test('1000 widgets mounted and disposed on one host leave no mark and no subscription', () => {
  const before = liveSubscriptions();
  const value = signal('a');

  for (let i = 0; i < 1000; i++) {
    const dispose = render(() => html`<p>${value}</p>`, host);

    dispose();
  }

  value.set('b');
  flush();

  assert.equal(liveSubscriptions(), before);
  assert.equal(host.hasAttribute(ROOT_MARK), false);
  assert.equal(host.childNodes.length, 0);
});
