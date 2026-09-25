// The queries are the only place a fake transport is needed: the contract is
// an interface, so the fake is an object literal rather than a mocking
// framework.
//
// The hooks are exercised through a probe component rendered with
// `react-dom/client` into happy-dom. No testing library, and no JSX — Node
// strips types from `.ts` but cannot compile `.tsx`, so the tests stay
// runnable by `node --test` with no build step, the way the other arm's are.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  Device,
  DeviceApi,
  Limits,
  Reading,
  Unsubscribe,
} from '../../services/devices.contract.ts';
import { DeviceApiContext } from '../../services/devices.context.ts';
import { boardKey, useBoard, useCalibrate, useLiveReadings, type Board } from './devices.queries.ts';
import { INITIAL, useDevicesStore } from './devices.store.ts';

const browser = new Window({ url: 'http://localhost/' });

Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  // `navigator` is not assignable on Node 24 and is not needed: the global
  // one is enough for anything react-dom reads off it.
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  Event: browser.Event,
  MouseEvent: browser.MouseEvent,
  // React's test path refuses to run effects without this, and warns loudly
  // rather than silently skipping them.
  IS_REACT_ACT_ENVIRONMENT: true,
});

/** Lets the microtask queue and one timer turn, which is when a fetch lands. */
const settled = (after = 0): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, after);
  });

/** Long enough for the whole retry schedule: 100 ms, then 200 ms, plus slack. */
const RETRY_WINDOW_MS = 800;

/** A promise that never settles, for a request that is still in flight. */
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

const LIMITS: Limits = { low: 16, high: 24 };

function device(id: number, name: string): Device {
  return { id, name, room: 'Hall', reading: 20, calibrated: false };
}

const oneDevice = (): Promise<readonly Device[]> => Promise.resolve([device(1, 'a')]);
const calibratedDevice = (id: number): Promise<Device> => Promise.resolve(device(id, 'a'));

/** What a test drives the module with, and what it reads back afterwards. */
interface Fake {
  readonly api: DeviceApi;
  emit(readings: readonly Reading[]): void;
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

/** What the probe reports back out of the render. */
interface Seen {
  board?: ReturnType<typeof useBoard>;
  calibrate?: ReturnType<typeof useCalibrate>;
}

/** What a mount gives a test: the hooks' current values, and a way to end it. */
interface Mounted {
  readonly seen: Seen;
  readonly client: QueryClient;
  unmount(): Promise<void>;
}

async function mountModule(api: DeviceApi): Promise<Mounted> {
  const seen: Seen = {};

  function Probe(): null {
    seen.board = useBoard();
    seen.calibrate = useCalibrate();

    useLiveReadings();

    return null;
  }

  const client = new QueryClient();
  const host = document.createElement('div');

  document.body.append(host);

  const root = createRoot(host);

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DeviceApiContext, { value: api }, createElement(Probe)),
      ),
    );
  });

  return {
    seen,
    client,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });

      client.clear();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  useDevicesStore.setState(INITIAL);
});

test('one load commits the devices and the limits together', async () => {
  const fake = fakeDevices();
  const mounted = await mountModule(fake.api);

  await act(async () => settled());

  // One cache entry holds both, so nothing ever reads this room's devices
  // beside the last room's limits.
  assert.equal(mounted.seen.board?.data?.devices.length, 1);
  assert.deepEqual(mounted.seen.board?.data?.limits, LIMITS);

  await mounted.unmount();
});

test('a load still in flight reads as pending', async () => {
  const fake = fakeDevices({ list: () => never<readonly Device[]>() });
  const mounted = await mountModule(fake.api);

  await act(async () => settled());

  assert.equal(mounted.seen.board?.isPending, true);
  assert.equal(mounted.seen.board?.data, undefined);

  await mounted.unmount();
});

test('every request is given the signal the contract asks for', async () => {
  const fake = fakeDevices();
  const mounted = await mountModule(fake.api);

  await act(async () => settled());

  assert.ok(fake.signals().length > 0, 'nothing was asked for');
  assert.ok(
    fake.signals().every((signal) => signal instanceof AbortSignal),
    'a call was made without an AbortSignal',
  );

  await mounted.unmount();
});

test('changing the room asks for the new one', async () => {
  const fake = fakeDevices();
  const mounted = await mountModule(fake.api);

  await act(async () => settled());
  await act(async () => {
    useDevicesStore.getState().filtered('Loft');
  });
  await act(async () => settled());

  assert.deepEqual(fake.rooms(), ['', 'Loft']);
  assert.equal(useDevicesStore.getState().room, 'Loft');

  await mounted.unmount();
});

test('a load that keeps failing is retried, and then reported', async () => {
  const fake = fakeDevices({ list: () => Promise.reject(new Error('the hub is unreachable')) });
  const mounted = await mountModule(fake.api);

  await act(async () => settled());

  // `Boolean(…)` is load-bearing. `assert/strict`'s `equal` carries an
  // assertion signature, and TypeScript treats a const read off a discriminant
  // as an alias of it — so asserting on the raw `isPending` would narrow the
  // query result to "pending" for the rest of the test, and the reads after
  // the retry window would be looking at a variant with no `error` on it.
  const trying = Boolean(mounted.seen.board?.isPending);

  // Still trying: a query with a retry policy does not give up on the first
  // refusal, and the screen says "loading" for as long as that lasts.
  assert.equal(trying, true);

  await act(async () => settled(RETRY_WINDOW_MS));

  const failed = Boolean(mounted.seen.board?.isError);
  const complaint = mounted.seen.board?.error?.message ?? '';

  assert.equal(failed, true);
  assert.match(complaint, /unreachable/u);
  assert.ok(fake.rooms().length > 1, 'the load was not retried');

  await mounted.unmount();
});

test('a calibration marks the row before the request lands', async () => {
  // A write that never answers, so the optimistic window stays open long
  // enough to look at. With a fake that resolves at once there is no window.
  const fake = fakeDevices({ calibrate: () => never<Device>() });
  const mounted = await mountModule(fake.api);

  await act(async () => settled());
  await act(async () => {
    mounted.seen.calibrate?.mutate(1);
  });

  assert.equal(mounted.client.getQueryData<Board>(boardKey(''))?.devices[0]?.calibrated, true);
  assert.deepEqual(useDevicesStore.getState().calibrating, [1]);

  await mounted.unmount();
});

test('a calibration that lands keeps the row and clears the wait', async () => {
  const fake = fakeDevices();
  const mounted = await mountModule(fake.api);

  await act(async () => settled());
  await act(async () => {
    mounted.seen.calibrate?.mutate(1);
  });
  await act(async () => settled());

  assert.equal(mounted.client.getQueryData<Board>(boardKey(''))?.devices[0]?.calibrated, true);
  assert.deepEqual(useDevicesStore.getState().calibrating, []);

  await mounted.unmount();
});

test('a calibration that fails puts the row back', async () => {
  const fake = fakeDevices({ calibrate: () => Promise.reject(new Error('the device refused')) });
  const mounted = await mountModule(fake.api);

  await act(async () => settled());
  await act(async () => {
    mounted.seen.calibrate?.mutate(1);
  });
  await act(async () => settled());

  assert.equal(mounted.client.getQueryData<Board>(boardKey(''))?.devices[0]?.calibrated, false);
  assert.deepEqual(useDevicesStore.getState().calibrating, []);

  await mounted.unmount();
});

test('live readings reach the store', async () => {
  const fake = fakeDevices();
  const mounted = await mountModule(fake.api);

  await act(async () => settled());
  await act(async () => {
    fake.emit([{ id: 1, reading: 21.5 }]);
    fake.emit([{ id: 1, reading: 22.5 }]);
  });

  assert.equal(useDevicesStore.getState().readings[1], 22.5);

  await mounted.unmount();
});

test('unmounting ends the subscription', async () => {
  const fake = fakeDevices({ list: () => never<readonly Device[]>() });
  const mounted = await mountModule(fake.api);

  await act(async () => settled());

  const feed = fake.signals().at(-1);

  assert.equal(feed?.aborted, false, 'the feed aborted while the module was mounted');

  await mounted.unmount();

  assert.equal(feed?.aborted, true, 'the feed outlived the mount');
});
