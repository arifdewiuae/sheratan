// State is a pure function of its transitions: no mocks, no DOM (SPEC §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { watch } from 'sheratan';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
import type { Metric } from '../../services/feed.contract.ts';
import { createDashboardState, SortKey, Status } from './dashboard.state.ts';

const metric = (id: number, name: string, value: number, delta = 0): Metric => ({
  id,
  name,
  value,
  delta,
});

test('starts empty and loading', () => {
  const state = createDashboardState();

  assert.deepEqual(state.rows(), []);
  assert.equal(state.status(), Status.Loading);
  assert.equal(state.applied(), 0);
});

test('seeded commits once: status and rows move together', () => {
  const state = createDashboardState();
  const seen: string[] = [];

  const stop = watch(() => {
    seen.push(`${state.status()}:${String(state.rows().length)}`);
  });

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);
  assert.deepEqual(seen, ['loading:0', 'ready:2']);
  stop();
});

test('a batch is one commit: rows and both counters update together', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);

  const seen: string[] = [];

  const stop = watch(() => {
    seen.push(
      `${String(state.applied())}/${String(state.batches())}/${String(state.rows()[0]?.value)}`,
    );
  });

  state.applyBatch([
    { id: 0, value: 14 },
    { id: 1, value: 18 },
  ]);

  assert.deepEqual(seen, ['0/0/10', '2/1/14'], 'one run, never a half-applied batch');
  stop();
});

test('a batch records the change on each row it touches', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);
  state.applyBatch([{ id: 0, value: 14 }]);

  assert.deepEqual(state.rows()[0], metric(0, 'a', 14, 4));
  assert.deepEqual(state.rows()[1], metric(1, 'b', 20), 'an untouched row keeps its identity');
});

test('a value that did not change leaves its row untouched', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 10)]);

  const before = state.rows()[0];

  state.applyBatch([{ id: 0, value: 10 }]);
  assert.equal(state.rows()[0], before, 'same object, so no watcher wakes');
  assert.equal(state.applied(), 1, 'but the value still counts as delivered');
});

test('the order is derived, and starts stable: by name, then by value', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'b', 10), metric(1, 'a', 30), metric(2, 'c', 20)]);

  // Rows hold still by default, so the numbers are what moves.
  assert.equal(state.sortedBy(), SortKey.Name);

  assert.deepEqual(
    state.visible().map((row) => row.name),
    ['a', 'b', 'c'],
  );

  state.applyBatch([{ id: 0, value: 99 }]);

  assert.deepEqual(
    state.visible().map((row) => row.name),
    ['a', 'b', 'c'],
    'still by name',
  );

  state.sorted(SortKey.Value);

  assert.deepEqual(
    state.visible().map((row) => row.name),
    ['b', 'a', 'c'],
  );

  state.applyBatch([{ id: 2, value: 200 }]);

  assert.deepEqual(
    state.visible().map((row) => row.name),
    ['c', 'b', 'a'],
    'the order follows values',
  );
});

test('a batch counts the rows it actually rewrote, not the values it received', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);

  // Three values, two rows, and one of them repeats the value it already has.
  state.applyBatch([
    { id: 0, value: 11 },
    { id: 0, value: 12 },
    { id: 1, value: 20 },
  ]);

  assert.equal(state.applied(), 3, 'three values arrived');
  assert.equal(state.written(), 1, 'one row changed, so one row is rewritten');
  assert.equal(state.skipped(), 2 / 3, 'the other two changed nothing, so they cost nothing');
});

test('nothing has arrived yet, so nothing has been skipped', () => {
  const state = createDashboardState();

  assert.equal(state.skipped(), 0, 'no values in means no claim to make');
});

test('live toggles, and sampling records the rate', () => {
  const state = createDashboardState();

  assert.equal(state.live(), true);

  state.toggledLive();
  assert.equal(state.live(), false);

  state.sampled(1234, 60);
  assert.equal(state.rate(), 1234);
  assert.equal(state.fps(), 60);
});

test('the window is a scroll offset turned into three numbers', () => {
  const state = createDashboardState();

  assert.deepEqual(state.rowWindow(), {
    start: -OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  });

  state.scrolled(ROW_HEIGHT_PX * 40);
  assert.equal(state.rowWindow().start, 40 - OVERSCAN_ROWS);

  // A start above the list is what overscan costs at the top, and `each`
  // clamps it rather than treating a rubber-banding scroll as a mistake.
  state.scrolled(0);
  assert.equal(state.rowWindow().start, -OVERSCAN_ROWS);
});

test('virtualising changes rows in the page, never rows live', () => {
  const state = createDashboardState();
  const total = WINDOW_ROWS * 3;

  state.seeded(Array.from({ length: total }, (_, id) => metric(id, `m${String(id)}`, id)));

  assert.equal(state.windowed(), true);
  assert.equal(state.rows().length, total);
  assert.equal(state.inPage(), WINDOW_ROWS);

  state.toggledWindowing();
  assert.equal(state.rows().length, total);
  assert.equal(state.inPage(), total);
});

test('a list shorter than the window puts every row in the page', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 1), metric(1, 'b', 2)]);
  assert.equal(state.inPage(), 2);
});
