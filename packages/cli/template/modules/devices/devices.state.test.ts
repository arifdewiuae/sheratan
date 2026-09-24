// State is a pure function, so it needs no mocks, no DOM and no browser
// (SPEC §4 Tests). Everything here is a transition in and an accessor out.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
import type { Device, Limits } from '../../services/devices.contract.ts';
import { createDevicesState, EVERY_ROOM, Status, type Board } from './devices.state.ts';

const LIMITS: Limits = { low: 16, high: 24 };

function device(id: number, name: string, room: string): Device {
  return { id, name, room, reading: 20, calibrated: false };
}

const BOARD: Board = {
  devices: [device(2, 'Sensor 002', 'Loft'), device(1, 'Sensor 001', 'Hall')],
  limits: LIMITS,
};

test('a fresh state is loading, with nothing to show', () => {
  const state = createDevicesState();

  assert.equal(state.status(), Status.Loading);
  assert.equal(state.count(), 0);
  assert.equal(state.room(), EVERY_ROOM);
  assert.deepEqual(state.visible(), []);
});

test('one load commits devices and limits together', () => {
  const state = createDevicesState();

  state.failed('the last attempt went wrong');
  state.loaded(BOARD);

  assert.equal(state.status(), Status.Ready);
  assert.deepEqual(state.limits(), LIMITS);
  assert.equal(state.count(), 2);
  // The error from the previous attempt goes in the same commit, so nothing
  // ever renders a fresh board beside a stale complaint.
  assert.equal(state.error(), '');
});

test('a failure records what went wrong', () => {
  const state = createDevicesState();

  state.failed('the hub is unreachable');

  assert.equal(state.status(), Status.Failed);
  assert.equal(state.error(), 'the hub is unreachable');
});

test('the display order is derived, never stored', () => {
  const state = createDevicesState();

  state.loaded(BOARD);

  assert.deepEqual(
    state.visible().map((row) => row.name),
    ['Sensor 001', 'Sensor 002'],
  );
});

test('the filter lists each room once, in order', () => {
  const state = createDevicesState();

  state.loaded({
    devices: [device(1, 'a', 'Loft'), device(2, 'b', 'Hall'), device(3, 'c', 'Loft')],
    limits: LIMITS,
  });

  assert.deepEqual(state.rooms(), ['Hall', 'Loft']);
});

test('an optimistic calibration marks the row and records the wait', () => {
  const state = createDevicesState();

  state.loaded(BOARD);
  state.calibrationStarted(1);

  assert.equal(state.visible()[0]?.calibrated, true);
  assert.deepEqual(state.calibrating(), [1]);
});

test('a rollback undoes both halves of it', () => {
  const state = createDevicesState();

  state.loaded(BOARD);
  state.calibrationStarted(1);
  state.calibrationRolledBack(1);

  assert.equal(state.visible()[0]?.calibrated, false);
  assert.deepEqual(state.calibrating(), []);
});

test('settling clears the wait and leaves the row calibrated', () => {
  const state = createDevicesState();

  state.loaded(BOARD);
  state.calibrationStarted(1);
  state.calibrationSettled(1);

  assert.equal(state.visible()[0]?.calibrated, true);
  assert.deepEqual(state.calibrating(), []);
});

test('the row window follows the scroll offset', () => {
  const state = createDevicesState();

  assert.deepEqual(state.rowWindow(), {
    start: -OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  });

  state.scrolled(ROW_HEIGHT_PX * 10);

  assert.equal(state.rowWindow().start, 10 - OVERSCAN_ROWS);
});

test('readings replace the fold rather than accumulating beside it', () => {
  const state = createDevicesState();

  state.readingsArrived({ 1: 21.5 });
  state.readingsArrived({ 1: 22.5, 2: 19 });

  assert.deepEqual(state.readings(), { 1: 22.5, 2: 19 });
});

test('the room filter is a transition, and nothing else moves with it', () => {
  const state = createDevicesState();

  state.loaded(BOARD);
  state.filtered('Loft');

  assert.equal(state.room(), 'Loft');
  assert.equal(state.status(), Status.Ready);
});
