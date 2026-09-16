// The view is a snapshot of state (SPEC §4 Tests).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Window } from 'happy-dom';
import { flush, render } from 'sheratan';

import type { Metric } from '../../services/feed.contract.ts';
import { createDashboardState, SortKey, type DashboardState } from './dashboard.state.ts';
import { dashboardView, type DashboardIntents } from './dashboard.view.ts';

const window = new Window();

globalThis.document = window.document as unknown as Document;

let host: Element;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

const metric = (id: number, name: string, value: number): Metric => ({ id, name, value, delta: 0 });

const text = (selector: string): string =>
  (host.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The heading row is markup, not data. */
const ROW = '.metric:not(.heading)';

const names = (): string[] =>
  [...host.querySelectorAll(`${ROW} .metric-name`)].map((node) => node.textContent.trim());

function mounted(): { state: DashboardState; calls: [string, unknown][] } {
  const state = createDashboardState();
  const calls: [string, unknown][] = [];

  const intents: DashboardIntents = {
    toggleLive: () => {
      calls.push(['toggleLive', undefined]);
    },
    sortBy: (value) => {
      calls.push(['sortBy', value]);
    },
  };

  render(() => dashboardView(state, intents), host);

  return { state, calls };
}

test('connects first, then shows the table in value order', () => {
  const { state } = mounted();

  assert.equal(text('.note'), 'Connecting…');

  state.seeded([metric(0, 'b', 10), metric(1, 'a', 30)]);
  flush();
  assert.deepEqual(names(), ['a', 'b']);
  assert.equal(host.querySelector('.note'), null);
});

test('a failed feed shows the reason', () => {
  const { state } = mounted();

  state.failed('feed unreachable');
  flush();
  assert.equal(text('.note.error'), 'Feed stopped: feed unreachable');
});

test('the stat tiles read from state', () => {
  const { state } = mounted();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);

  // Two values for one row, and the second repeats the first: one write, one
  // skip, which is the claim the third tile makes.
  state.applyBatch([
    { id: 0, value: 12 },
    { id: 0, value: 12 },
  ]);

  state.sampled(12_400, 60);
  flush();

  assert.equal(text('.tile.headline .tile-value'), '60', 'frames a second');
  assert.equal(text('.tiles .tile:nth-child(2) .tile-value'), '12.4k', 'values in');
  assert.equal(text('.tiles .tile:nth-child(3) .tile-value'), '50%', 'updates skipped');
  assert.equal(text('.tiles .tile:nth-child(4) .tile-value'), '2', 'rows live');
});

test('a new value writes one cell and keeps the row', () => {
  const { state } = mounted();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 5)]);
  flush();

  const row = host.querySelectorAll(ROW)[0] as Element;
  const valueCell = row.querySelector('.metric-value') as Element;
  const textNode = valueCell.firstChild;

  state.applyBatch([{ id: 0, value: 14 }]);
  flush();

  assert.equal(host.querySelectorAll(ROW)[0], row, 'same row element');
  assert.equal(valueCell.firstChild, textNode, 'same text node, rewritten in place');
  assert.equal(valueCell.textContent.trim(), '14');
  assert.equal(row.getAttribute('class'), 'metric up');
});

test('the controls ask for the intents, and the button follows state', () => {
  const { state, calls } = mounted();

  state.seeded([metric(0, 'a', 10)]);
  flush();
  assert.equal(text('.toggle'), 'Pause');

  (host.querySelector('.toggle') as HTMLElement).click();
  assert.deepEqual(calls, [['toggleLive', undefined]]);

  state.toggledLive();
  flush();
  assert.equal(text('.toggle'), 'Resume');

  const select = host.querySelector('select') as HTMLSelectElement;

  select.value = SortKey.Name;
  select.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event);
  assert.deepEqual(calls[1], ['sortBy', SortKey.Name]);
});
