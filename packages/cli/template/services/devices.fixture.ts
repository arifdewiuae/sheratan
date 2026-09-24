// The adapter a fresh clone runs on: deterministic, in memory, no server. It
// is a service, so it may do I/O and hold a timer; it knows nothing about
// modules, state or the DOM.

import type { Device, DeviceApi, Limits, Reading, Unsubscribe } from './devices.contract.ts';

/** How many devices the board starts with. Enough that the window earns its keep. */
const DEVICE_COUNT = 240;

/** The rooms devices are spread across, in order. */
const ROOMS: readonly string[] = ['Cellar', 'Hall', 'Kitchen', 'Loft', 'Studio'];

/** How often the fixture pushes a batch of readings. */
const TICK_MS = 250;

/** Readings changed per batch. */
const PER_BATCH = 16;

/** The temperature band the fixture wanders inside. */
const MIN_C = 14;

const MAX_C = 26;

/** How far one reading may move from the last, in degrees. */
const DRIFT_C = 0.4;

/** Digits a device number is padded to, so every name is the same width. */
const NAME_DIGITS = 3;

/** `fraction()` is in [0, 1); this recentres it on zero so drift goes both ways. */
const CENTRE = 0.5;

/** Recentring halves the range, so the span is doubled back to ±DRIFT_C. */
const BOTH_WAYS = 2;

/** Milliseconds a request takes, so loading states are visible on a fast machine. */
const LATENCY_MS = 180;

/** The band this site expects its readings to stay inside. */
const LIMITS: Limits = { low: 16, high: 24 };

/* The mixing constants of splitmix32. They are the algorithm, not tunables:
   changing one does not make the generator better, it makes it a different
   generator. Named so that nothing here reads as an arbitrary number. */
const MIX_INCREMENT = 0x6d2b_79f5;

const MIX_SHIFT_A = 15;

const MIX_SHIFT_B = 7;

const MIX_SHIFT_C = 14;

const MIX_ODD = 61;

/** 2 ** 32: what a 32-bit result is divided by to land in [0, 1). */
const UINT32_RANGE = 0x1_0000_0000;

/**
 * A 32-bit mixing step. The fixture is seeded rather than random so that two
 * runs of the same test see the same numbers.
 */
function next(seed: number): number {
  let value = seed + MIX_INCREMENT;

  value = Math.imul(value ^ (value >>> MIX_SHIFT_A), value | 1);
  value ^= value + Math.imul(value ^ (value >>> MIX_SHIFT_B), value | MIX_ODD);

  return (value ^ (value >>> MIX_SHIFT_C)) >>> 0;
}

/** `seed` as a fraction in [0, 1). */
function fraction(seed: number): number {
  return next(seed) / UINT32_RANGE;
}

function startingDevices(): Device[] {
  return Array.from({ length: DEVICE_COUNT }, (_unused, index) => {
    const id = index + 1;
    const room = ROOMS[index % ROOMS.length] ?? '';

    return {
      id,
      name: `Sensor ${String(id).padStart(NAME_DIGITS, '0')}`,
      room,
      reading: MIN_C + fraction(id) * (MAX_C - MIN_C),
      calibrated: false,
    };
  });
}

/** Resolves after `ms`, or the moment the request is cancelled. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function refuseIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

/** Keeps the readings moving, one batch at a time. */
function drift(devices: readonly Device[], step: number): readonly Reading[] {
  return Array.from({ length: PER_BATCH }, (_unused, slot) => {
    const index = next(step * PER_BATCH + slot) % devices.length;
    const device = devices[index];
    const move = (fraction(step + slot) - CENTRE) * BOTH_WAYS * DRIFT_C;
    const moved = (device?.reading ?? MIN_C) + move;

    return { id: device?.id ?? 1, reading: Math.min(MAX_C, Math.max(MIN_C, moved)) };
  });
}

/**
 * The in-memory adapter. It owns the board's data, so a calibration performed
 * through it is still there after the list is refetched.
 *
 * @example
 * const api = createFixtureDevices();
 * const all = await api.list('', new AbortController().signal);
 */
export function createFixtureDevices(): DeviceApi {
  const board = startingDevices();
  let step = 0;

  return {
    list: async (room, signal) => {
      await wait(LATENCY_MS, signal);
      refuseIfAborted(signal);

      return room === '' ? [...board] : board.filter((device) => device.room === room);
    },

    limits: async (signal) => {
      await wait(LATENCY_MS, signal);
      refuseIfAborted(signal);

      return LIMITS;
    },

    calibrate: async (id, signal) => {
      await wait(LATENCY_MS, signal);
      refuseIfAborted(signal);

      const index = board.findIndex((device) => device.id === id);
      const device = board[index];

      if (device === undefined) throw new Error(`no device ${String(id)}`);

      const calibrated = { ...device, calibrated: true };

      board[index] = calibrated;

      return calibrated;
    },

    subscribe: (onReadings, signal): Unsubscribe => {
      const timer = setInterval(() => {
        step += 1;
        onReadings(drift(board, step));
      }, TICK_MS);

      const stop = (): void => {
        clearInterval(timer);
      };

      signal.addEventListener('abort', stop, { once: true });

      return stop;
    },
  };
}
