// The store and its derivations are pure, so they need no mocks, no DOM and
// no React. Everything here is a transition in and a value out.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
import type { Device } from '../../services/devices.contract.ts';
import {
  byName,
  EVERY_ROOM,
  foldReadings,
  INITIAL,
  roomsOf,
  rowWindowOf,
  useDevicesStore,
  withCalibration,
} from './devices.store.ts';

function device(id: number, name: string, room: string): Device {
  return { id, name, room, reading: 20, calibrated: false };
}

const BOARD: readonly Device[] = [
  device(2, 'Sensor 002', 'Loft'),
  device(1, 'Sensor 001', 'Hall'),
];

// The store is one per application, so a test that left it dirty would be a
// test the next one depends on.
beforeEach(() => {
  useDevicesStore.setState(INITIAL);
});

test('a fresh store shows every room and nothing in flight', () => {
  const state = useDevicesStore.getState();

  assert.equal(state.room, EVERY_ROOM);
  assert.equal(state.scrollTop, 0);
  assert.deepEqual(state.readings, {});
  assert.deepEqual(state.calibrating, []);
});

test('the display order is derived, never stored', () => {
  assert.deepEqual(
    byName(BOARD).map((row) => row.name),
    ['Sensor 001', 'Sensor 002'],
  );
});

test('the filter lists each room once, in order', () => {
  const rooms = roomsOf([device(1, 'a', 'Loft'), device(2, 'b', 'Hall'), device(3, 'c', 'Loft')]);

  assert.deepEqual(rooms, ['Hall', 'Loft']);
});

test('one device calibrates without touching the others', () => {
  const after = withCalibration(BOARD, 1, true);

  assert.equal(after.find((one) => one.id === 1)?.calibrated, true);
  assert.equal(after.find((one) => one.id === 2)?.calibrated, false);
  assert.equal(BOARD[0]?.calibrated, false, 'the input was mutated');
});

test('an optimistic calibration records the wait', () => {
  useDevicesStore.getState().calibrationStarted(1);

  assert.deepEqual(useDevicesStore.getState().calibrating, [1]);

  useDevicesStore.getState().calibrationSettled(1);

  assert.deepEqual(useDevicesStore.getState().calibrating, []);
});

test('the row window follows the scroll offset', () => {
  assert.deepEqual(rowWindowOf(0), {
    start: -OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  });

  assert.equal(rowWindowOf(ROW_HEIGHT_PX * 10).start, 10 - OVERSCAN_ROWS);
});

test('scrolling is a transition, and nothing else moves with it', () => {
  useDevicesStore.getState().scrolled(ROW_HEIGHT_PX * 3);

  assert.equal(useDevicesStore.getState().scrollTop, ROW_HEIGHT_PX * 3);
  assert.equal(useDevicesStore.getState().room, EVERY_ROOM);
});

test('the room filter is a transition, and nothing else moves with it', () => {
  useDevicesStore.getState().filtered('Loft');

  assert.equal(useDevicesStore.getState().room, 'Loft');
  assert.deepEqual(useDevicesStore.getState().calibrating, []);
});

test('a batch of readings is folded into what is already known', () => {
  assert.deepEqual(foldReadings({}, [{ id: 1, reading: 21.5 }]), { 1: 21.5 });

  // Later readings for an id win; ids the batch did not mention are kept.
  assert.deepEqual(
    foldReadings({ 1: 21.5, 3: 18 }, [
      { id: 1, reading: 22.5 },
      { id: 2, reading: 19 },
    ]),
    { 1: 22.5, 2: 19, 3: 18 },
  );
});

test('the feed writes through the store, not around it', () => {
  useDevicesStore.getState().readingsArrived([{ id: 1, reading: 21.5 }]);
  useDevicesStore.getState().readingsArrived([{ id: 1, reading: 22.5 }]);

  assert.deepEqual(useDevicesStore.getState().readings, { 1: 22.5 });
});
