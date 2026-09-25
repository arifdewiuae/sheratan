// Client state: what this screen is doing, and the pure functions that derive
// from it. Server state — the devices and the limits — is not here. It lives
// in the TanStack Query cache (`devices.queries.ts`), which is the split the
// two libraries exist to make: Query owns what came from the API and when it
// is stale, Zustand owns what the person did.
//
// Nothing in this file does I/O, touches the DOM, or knows a component exists.

import { create } from 'zustand';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
import type { Device, Reading } from '../../services/devices.contract.ts';

/** The latest live reading per device id. */
export type Readings = Readonly<Record<number, number>>;

/** The room filter's "every room" value. Empty, so it is also the select's default. */
export const EVERY_ROOM = '';

/** Which rows the list actually renders, worked out from the scroll offset. */
export interface RowWindow {
  /** First row index. Negative at the top of a rubber-banding scroll. */
  readonly start: number;
  /** How many rows the pool holds. */
  readonly count: number;
  readonly rowHeight: number;
}

/** What the person is doing, and the transitions that may change it. */
export interface DevicesStore {
  readonly room: string;
  readonly scrollTop: number;
  /** The latest reading per id, folded from the live feed. */
  readonly readings: Readings;
  /** Ids with a calibration in flight, so a row can say so. */
  readonly calibrating: readonly number[];

  readonly filtered: (room: string) => void;
  readonly scrolled: (top: number) => void;
  /** Folds one batch from the feed into what is already known. */
  readonly readingsArrived: (batch: readonly Reading[]) => void;
  /** Marks a calibration in flight. The optimistic row edit is the cache's. */
  readonly calibrationStarted: (id: number) => void;
  /** Clears the mark, however the write ended. */
  readonly calibrationSettled: (id: number) => void;
}

/** A fresh screen. Exported so a test can put the store back between cases. */
export const INITIAL: Pick<DevicesStore, 'room' | 'scrollTop' | 'readings' | 'calibrating'> = {
  room: EVERY_ROOM,
  scrollTop: 0,
  readings: {},
  calibrating: [],
};

/** One batch merged into the fold. Later readings for an id win. */
export function foldReadings(into: Readings, batch: readonly Reading[]): Readings {
  const next: Record<number, number> = { ...into };

  for (const reading of batch) next[reading.id] = reading.reading;

  return next;
}

/** The rows, in display order: derived from the cache, never stored. */
export function byName(devices: readonly Device[]): readonly Device[] {
  return devices.toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Every room the current devices sit in, once each, for the filter. */
export function roomsOf(devices: readonly Device[]): readonly string[] {
  return [...new Set(devices.map((device) => device.room))].toSorted();
}

/** One device's calibrated flag changed, leaving every other device alone. */
export function withCalibration(
  devices: readonly Device[],
  id: number,
  calibrated: boolean,
): readonly Device[] {
  return devices.map((device) => (device.id === id ? { ...device, calibrated } : device));
}

/**
 * A scroll offset in, three numbers out. `start` can come out negative at the
 * top of a rubber-banding scroll; the list clamps it rather than treating it
 * as a mistake.
 *
 * @example
 * rowWindowOf(0); // { start: -OVERSCAN_ROWS, count: WINDOW_ROWS, rowHeight: 32 }
 */
export function rowWindowOf(scrollTop: number): RowWindow {
  return {
    start: Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  };
}

function without(ids: readonly number[], id: number): readonly number[] {
  return ids.filter((waiting) => waiting !== id);
}

/**
 * The store. One per application, which is how Zustand is normally used: a
 * component subscribes with a selector and re-renders only when that slice
 * changes.
 *
 * @example
 * const room = useDevicesStore((state) => state.room);
 */
export const useDevicesStore = create<DevicesStore>()((set) => ({
  ...INITIAL,

  filtered: (room) => set({ room }),

  scrolled: (top) => set({ scrollTop: top }),

  readingsArrived: (batch) =>
    set((current) => ({ readings: foldReadings(current.readings, batch) })),

  calibrationStarted: (id) => set((current) => ({ calibrating: [...current.calibrating, id] })),

  calibrationSettled: (id) => set((current) => ({ calibrating: without(current.calibrating, id) })),
}));
