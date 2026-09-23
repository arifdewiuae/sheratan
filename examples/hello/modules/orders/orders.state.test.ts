// State is a pure function of its transitions: no mocks, no DOM (SPEC §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Metric } from '../../services/feed.contract.ts';
import { createOrdersState, Status } from './orders.state.ts';

const metric = (id: number, name: string, value: number): Metric => ({
  id,
  name,
  value,
  delta: 0,
});

test('starts empty and loading, with nothing to count', () => {
  const state = createOrdersState();

  assert.deepEqual(state.rows(), []);

  assert.equal(state.status(), Status.Loading);
  assert.equal(state.count(), 0);
  assert.equal(state.error(), '');
});

test('loaded rows are ready, and the count is derived rather than stored', () => {
  const state = createOrdersState();

  state.loaded([metric(1, 'alpha', 10), metric(2, 'beta', 20)]);

  assert.equal(state.status(), Status.Ready);
  assert.equal(state.count(), 2);

  assert.deepEqual(
    state.rows().map((row) => row.name),
    ['alpha', 'beta'],
  );
});

test('a failure carries its reason, and a later load clears it', () => {
  const state = createOrdersState();

  state.failed('the feed said no');

  assert.equal(state.status(), Status.Failed);
  assert.equal(state.error(), 'the feed said no');

  state.loaded([metric(1, 'alpha', 10)]);

  assert.equal(state.status(), Status.Ready);
  assert.equal(state.error(), '', 'a success is not a failure with rows attached');
});
