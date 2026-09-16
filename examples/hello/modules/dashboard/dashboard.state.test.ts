// State is a pure function of its transitions: no mocks, no DOM (SPEC §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { watch } from 'sheratan';

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

test('rising counts the rows that went up on the last batch', () => {
  const state = createDashboardState();

  state.seeded([metric(0, 'a', 10), metric(1, 'b', 20)]);

  state.applyBatch([
    { id: 0, value: 14 },
    { id: 1, value: 15 },
  ]);

  assert.equal(state.rising(), 1);
});

test('live toggles, and sampling records the rate', () => {
  const state = createDashboardState();

  assert.equal(state.live(), true);

  state.toggledLive();
  assert.equal(state.live(), false);

  state.sampled(1234);
  assert.equal(state.rate(), 1234);
});
