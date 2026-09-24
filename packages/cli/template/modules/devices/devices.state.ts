// State: signals and pure transitions (SPEC §4). No I/O, no DOM, no imports of
// effects or a view. Everything derivable is a `computed`, so there is one
// source of truth and nothing to keep in sync by hand.

import { batch, computed, signal, type Accessor, type EachWindow, type Signal } from 'sheratan';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
import type { Device, Limits } from '../../services/devices.contract.ts';

/** Where the module is in its load cycle. */
export const Status = {
  Loading: 'loading',
  Ready: 'ready',
  Failed: 'failed',
} as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

/** The latest live reading per device id. */
export type Readings = Readonly<Record<number, number>>;

/** Everything one load produces, so it can be committed in one go. */
export interface Board {
  readonly devices: readonly Device[];
  readonly limits: Limits;
}

/** The room filter's "every room" value. Empty, so it is also the select's default. */
export const EVERY_ROOM = '';

/** Readable state plus the transitions that may change it (SHR-L010). */
export interface DevicesState {
  readonly status: Accessor<Status>;
  readonly error: Accessor<string>;
  readonly limits: Accessor<Limits>;
  readonly room: Accessor<string>;
  /** The latest reading per id, folded from the live feed. */
  readonly readings: Accessor<Readings>;
  /** Ids with a calibration in flight, so a row can say so. */
  readonly calibrating: Accessor<readonly number[]>;

  /** The rows, in display order: derived, never stored. */
  readonly visible: Accessor<readonly Device[]>;
  /** Every room the current devices sit in, for the filter. */
  readonly rooms: Accessor<readonly string[]>;
  /** How many rows there are, for the caption. */
  readonly count: Accessor<number>;
  /** Which rows `each` renders, worked out from the scroll offset (SPEC §9). */
  readonly rowWindow: Accessor<EachWindow>;

  // Transitions are properties rather than methods, and each says `this: void`.
  // A transition is handed to `mutation()` by reference, so it has to work
  // detached from the object it was read off.

  /** One commit for a whole load: devices and limits move together. */
  readonly loaded: (this: void, board: Board) => void;
  readonly failed: (this: void, message: string) => void;
  readonly readingsArrived: (this: void, readings: Readings) => void;
  readonly filtered: (this: void, room: string) => void;
  readonly scrolled: (this: void, top: number) => void;
  /** Marks a device calibrated before the write lands (the optimistic half). */
  readonly calibrationStarted: (this: void, id: number) => void;
  /** Undoes the optimistic half when the write did not land. */
  readonly calibrationRolledBack: (this: void, id: number) => void;
  /** Clears the in-flight mark once a write has landed. */
  readonly calibrationSettled: (this: void, id: number) => void;
}

/** The writable handles, private to this file (SHR-L010). */
interface Signals {
  readonly devices: Signal<readonly Device[]>;
  readonly status: Signal<Status>;
  readonly error: Signal<string>;
  readonly limits: Signal<Limits>;
  readonly room: Signal<string>;
  readonly readings: Signal<Readings>;
  readonly calibrating: Signal<readonly number[]>;
  readonly scrollTop: Signal<number>;
}

/** The band a fresh board assumes until the real one arrives. */
const NO_LIMITS: Limits = { low: 0, high: 0 };

function without(ids: readonly number[], id: number): readonly number[] {
  return ids.filter((waiting) => waiting !== id);
}

function withCalibration(devices: readonly Device[], id: number, calibrated: boolean): Device[] {
  return devices.map((device) => (device.id === id ? { ...device, calibrated } : device));
}

/** What the feed and the loader drive, kept apart from the signals they commit to. */
function loadTransitions(
  state: Signals,
): Pick<DevicesState, 'loaded' | 'failed' | 'readingsArrived'> {
  return {
    loaded: (board) => {
      // Two responses, one commit: nothing ever renders with the devices from
      // this load and the limits from the last one (SPEC §4).
      batch(() => {
        state.devices.set(board.devices);
        state.limits.set(board.limits);
        state.status.set(Status.Ready);
        state.error.set('');
      });
    },

    failed: (message) => {
      batch(() => {
        state.status.set(Status.Failed);
        state.error.set(message);
      });
    },

    readingsArrived: (readings) => {
      state.readings.set(readings);
    },
  };
}

/** What a person drives: a filter, a scrollbar, and a button per row. */
function controlTransitions(
  state: Signals,
): Pick<
  DevicesState,
  'filtered' | 'scrolled' | 'calibrationStarted' | 'calibrationRolledBack' | 'calibrationSettled'
> {
  return {
    filtered: (room) => {
      state.room.set(room);
    },

    scrolled: (top) => {
      state.scrollTop.set(top);
    },

    calibrationStarted: (id) => {
      batch(() => {
        state.devices.set(withCalibration(state.devices(), id, true));
        state.calibrating.set([...state.calibrating(), id]);
      });
    },

    calibrationRolledBack: (id) => {
      // Both halves of the optimistic update come off together, so a failed
      // write never leaves a row marked calibrated *and* still in flight.
      batch(() => {
        state.devices.set(withCalibration(state.devices(), id, false));
        state.calibrating.set(without(state.calibrating(), id));
      });
    },

    calibrationSettled: (id) => {
      state.calibrating.set(without(state.calibrating(), id));
    },
  };
}

/**
 * The caller's half of a windowed `each`: a scroll offset in, three numbers
 * out. `start` can come out negative at the top of a rubber-banding scroll,
 * and `each` clamps it rather than treating it as a mistake.
 */
function windowOver(state: Signals): Accessor<EachWindow> {
  return computed(() => ({
    start: Math.floor(state.scrollTop() / ROW_HEIGHT_PX) - OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  }));
}

/** A factory, so every mount and every test starts clean (SPEC §4). */
export function createDevicesState(): DevicesState {
  const signals: Signals = {
    devices: signal<readonly Device[]>([]),
    status: signal<Status>(Status.Loading),
    error: signal(''),
    limits: signal<Limits>(NO_LIMITS),
    room: signal(EVERY_ROOM),
    readings: signal<Readings>({}),
    calibrating: signal<readonly number[]>([]),
    scrollTop: signal(0),
  };

  // Derived, never stored: the filter is applied here rather than written into
  // a second signal that could disagree with the one above it.
  const visible = computed(() =>
    signals.devices().toSorted((left, right) => left.name.localeCompare(right.name)),
  );

  const rooms = computed(() =>
    [...new Set(signals.devices().map((device) => device.room))].toSorted(),
  );

  return {
    status: signals.status,
    error: signals.error,
    limits: signals.limits,
    room: signals.room,
    readings: signals.readings,
    calibrating: signals.calibrating,
    visible,
    rooms,
    count: computed(() => visible().length),
    rowWindow: windowOver(signals),
    ...loadTransitions(signals),
    ...controlTransitions(signals),
  };
}
