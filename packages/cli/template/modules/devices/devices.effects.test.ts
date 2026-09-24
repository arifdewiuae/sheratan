// Effects are the only place a fake transport is needed (SPEC §4 Tests): the
// contract is an interface, so the fake is an object literal rather than a
// mocking framework.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { Window } from 'happy-dom';
import { flush, html, render, type Disposer } from 'sheratan';

import type {
  Device,
  DeviceApi,
  Limits,
  Reading,
  Unsubscribe,
} from '../../services/devices.contract.ts';
import { createDevicesEffects, type DevicesEffects } from './devices.effects.ts';
import { createDevicesState, Status, type DevicesState } from './devices.state.ts';

const window = new Window();

globalThis.document = window.document as unknown as Document;

let host: Element;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

/** Lets the microtask queue and one timer turn, which is when a fetch lands. */
const settled = (after = 0): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, after);
  });

/**
 * Long enough for the module's whole retry schedule: three attempts, the
 * first wait 100 ms and the second 200 ms, plus slack for a loaded machine.
 */
const RETRY_WINDOW_MS = 600;

/** A promise that never settles, for a request that is still in flight. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const LIMITS: Limits = { low: 16, high: 24 };

function device(id: number, name: string): Device {
  return { id, name, room: 'Hall', reading: 20, calibrated: false };
}

/** The list every test gets unless it asks for something else. */
const oneDevice = (): Promise<readonly Device[]> => Promise.resolve([device(1, 'a')]);

/** The calibration every test gets unless it asks for a failing one. */
const calibratedDevice = (id: number): Promise<Device> => Promise.resolve(device(id, 'a'));

/** What a test drives the module with, and what it reads back afterwards. */
interface Fake {
  readonly api: DeviceApi;
  /** Pushes a batch the way a live feed would. */
  emit(readings: readonly Reading[]): void;
  /** Every signal the module handed to the contract. */
  signals(): readonly AbortSignal[];
  rooms(): readonly string[];
}

interface FakeOptions {
  readonly list?: (room: string) => Promise<readonly Device[]>;
  readonly calibrate?: (id: number) => Promise<Device>;
}

function fakeDevices(options: FakeOptions = {}): Fake {
  const handlers: ((readings: readonly Reading[]) => void)[] = [];
  const signals: AbortSignal[] = [];
  const rooms: string[] = [];

  const list = options.list ?? oneDevice;
  const calibrate = options.calibrate ?? calibratedDevice;

  return {
    api: {
      list: async (room, signal) => {
        rooms.push(room);
        signals.push(signal);

        return list(room);
      },
      limits: async (signal) => {
        signals.push(signal);

        return LIMITS;
      },
      calibrate: async (id, signal) => {
        signals.push(signal);

        return calibrate(id);
      },
      subscribe: (onReadings, signal): Unsubscribe => {
        handlers.push(onReadings);
        signals.push(signal);

        return () => handlers.splice(handlers.indexOf(onReadings), 1);
      },
    },
    emit: (readings) => {
      for (const handler of handlers) handler(readings);
    },
    signals: () => signals,
    rooms: () => rooms,
  };
}

/** What a mount gives a test: the module's two halves, and a way to end it. */
interface Mounted {
  readonly state: DevicesState;
  readonly effects: DevicesEffects;
  readonly dispose: Disposer;
}

function mountModule(api: DeviceApi): Mounted {
  let state: DevicesState | undefined;
  let effects: DevicesEffects | undefined;

  const dispose = render(() => {
    state = createDevicesState();
    effects = createDevicesEffects(api, state);

    effects.start();

    return html`<div></div>`;
  }, host);

  if (state === undefined || effects === undefined) throw new Error('the module did not mount');

  return { state, effects, dispose };
}

test('one load commits the devices and the limits together', async () => {
  const fake = fakeDevices();
  const { state, dispose } = mountModule(fake.api);

  assert.equal(state.status(), Status.Loading);

  await settled();

  assert.equal(state.status(), Status.Ready);
  assert.equal(state.count(), 1);
  assert.deepEqual(state.limits(), LIMITS);

  dispose();
});

test('changing the room refetches, and abandons the request it replaced', async () => {
  const fake = fakeDevices();
  const { state, effects, dispose } = mountModule(fake.api);

  await settled();

  const before = fake.signals().length;

  effects.filterBy('Loft');

  await settled();

  assert.ok(fake.signals().length > before, 'the new room was not asked for');
  assert.deepEqual(fake.rooms(), ['', 'Loft']);
  assert.equal(state.room(), 'Loft');

  dispose();
});

test('a load that keeps failing is retried, and then reported', async () => {
  const fake = fakeDevices({ list: () => Promise.reject(new Error('the hub is unreachable')) });
  const { state, dispose } = mountModule(fake.api);

  await settled();

  // Still trying: a resource with a retry policy does not give up on the
  // first refusal, and the module says "loading" for as long as that lasts.
  assert.equal(state.status(), Status.Loading);

  await settled(RETRY_WINDOW_MS);

  assert.equal(state.status(), Status.Failed);
  assert.match(state.error(), /unreachable/u);
  assert.ok(fake.rooms().length > 1, 'the load was not retried');

  dispose();
});

test('a calibration marks the row before the request lands', async () => {
  const fake = fakeDevices();
  const { state, effects, dispose } = mountModule(fake.api);

  await settled();

  const target = state.visible()[0];

  assert.notEqual(target, undefined);

  effects.calibrate('', target as Device);

  assert.deepEqual(state.calibrating(), [1]);
  assert.equal(state.visible()[0]?.calibrated, true);

  await settled();

  assert.deepEqual(state.calibrating(), []);
  assert.equal(state.visible()[0]?.calibrated, true);

  dispose();
});

test('a calibration that fails puts the row back', async () => {
  const fake = fakeDevices({ calibrate: () => Promise.reject(new Error('the device refused')) });
  const { state, effects, dispose } = mountModule(fake.api);

  await settled();

  const target = state.visible()[0];

  effects.calibrate('', target as Device);

  await settled();

  assert.equal(state.visible()[0]?.calibrated, false);
  assert.deepEqual(state.calibrating(), []);

  dispose();
});

test('live readings are folded and reach state', async () => {
  const fake = fakeDevices();
  const { state, dispose } = mountModule(fake.api);

  await settled();

  fake.emit([{ id: 1, reading: 21.5 }]);
  fake.emit([{ id: 1, reading: 22.5 }]);

  // A stream commits once per frame, so both batches fold into one write.
  // `flush()` is how a test reaches that frame without waiting for one.
  flush();

  assert.equal(state.readings()[1], 22.5);

  dispose();
});

test('unmounting aborts what is still in flight', async () => {
  // Requests that never settle, so the mount ends while they are still open —
  // a request that has already answered has nothing left to cancel.
  const fake = fakeDevices({ list: () => never<readonly Device[]>() });
  const { dispose } = mountModule(fake.api);

  await settled();

  assert.ok(
    fake.signals().every((signal) => !signal.aborted),
    'a signal aborted while the module was still mounted',
  );

  dispose();

  assert.ok(
    fake.signals().every((signal) => signal.aborted),
    'a request outlived the mount',
  );
});
