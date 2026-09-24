// Effects: the only impure file in the module (SPEC §4). It sequences — calls
// a service contract, then invokes one transition — and never decides what a
// number means. `resource`, `mutation`, `stream`, `watch` and `onDispose` are
// legal here and nowhere else (SHR-L004).

import {
  Backoff,
  mutation,
  onDispose,
  resource,
  stream,
  watch,
  type ModuleView,
  type Mutation,
  type Resource,
  type Stream,
} from 'sheratan';

import type { Device, DeviceApi, Reading } from '../../services/devices.contract.ts';
import { createReading, type ReadingProps } from '../reading/index.ts';
import type { Board, DevicesState, Readings } from './devices.state.ts';

/** One try and two retries, for a list that is worth asking for twice. */
const LOAD_ATTEMPTS = 3;

/** The one element on the page that scrolls its own content. */
const LIST_CLASS = 'devices';

/** The child modules this module shows, ready for the view to place. */
export interface DevicesScreens {
  readonly reading: ModuleView<ReadingProps>;
}

/** What this module can do. The view declares the same shape for itself. */
export interface DevicesEffects {
  start(this: void): void;
  filterBy(this: void, room: string): void;
  /** Inside a row a handler is given the row's item as its second argument. */
  calibrate(this: void, payload: string, device: Device): void;
  retry(this: void): void;
  /**
   * The child modules the view places. Effects may import another module's
   * `index.ts`; a view may not, so the instances are built here (SHR-L001).
   */
  readonly screens: DevicesScreens;
}

/** What the listener needs from whatever was scrolled; `document` has neither. */
interface Scrolled {
  readonly classList?: DOMTokenList;
  readonly scrollTop?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * The board, on a reactive key. Changing the room aborts the request the old
 * room asked for, so a slow answer for "Cellar" can never land after a fast
 * one for "Loft".
 */
function loadBoard(api: DeviceApi, state: DevicesState): Resource<Board> {
  return resource<Board, readonly [string]>({
    key: () => [state.room()],
    fetch: async ({ key: [room], signal }) => {
      // Two calls, one payload, so the module commits them in one transition
      // and never renders this room's devices beside the last room's limits.
      const [devices, limits] = await Promise.all([api.list(room, signal), api.limits(signal)]);

      return { devices, limits };
    },
    retry: { attempts: LOAD_ATTEMPTS, backoff: Backoff.Exponential },
  });
}

/**
 * The live feed, folded once per frame. `reduceMany` rather than `reduce`
 * because merging a batch into a record is not O(1) per message, and the
 * contract on `reduce` is that it is.
 */
function liveReadings(api: DeviceApi, state: DevicesState): Stream<Readings> {
  return stream<Readings, readonly Reading[], readonly [string]>({
    key: () => [state.room()],
    initial: {},
    subscribe: ({ emit, signal }) => api.subscribe(emit, signal),
    reduceMany: (previous, batches) => {
      const next: Record<number, number> = { ...previous };

      for (const batch of batches) {
        for (const reading of batch) next[reading.id] = reading.reading;
      }

      return next;
    },
  });
}

/**
 * The write path. `optimistic` and `rollback` are transitions passed by
 * reference, so the screen moves before the request does and puts itself back
 * if the request fails. Keyed by device id: two rows calibrate at once, one
 * row twice does not.
 */
function calibration(api: DeviceApi, state: DevicesState): Mutation<number> {
  return mutation<number, unknown>({
    send: ({ input, signal }) => api.calibrate(input, signal),
    key: (id) => id,
    optimistic: state.calibrationStarted,
    rollback: state.calibrationRolledBack,
    onSuccess: (_result, id) => {
      state.calibrationSettled(id);
    },
  });
}

/**
 * Where the window comes from. `each` is handed numbers and never a container,
 * and a scroll offset is DOM state, so it is read here and nowhere else. On
 * capture, because `scroll` does not bubble.
 */
function watchScrolling(state: DevicesState): () => void {
  const onScroll = (event: Event): void => {
    const target = event.target as Scrolled | null;

    if (target?.classList?.contains(LIST_CLASS) !== true) return;

    state.scrolled(target.scrollTop ?? 0);
  };

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
  };
}

/** Moves the resource's answer into state, as one transition either way. */
function commitBoard(board: Resource<Board>, state: DevicesState): void {
  if (board.is('ready')) {
    state.loaded(board.data());

    return;
  }

  if (board.is('error')) state.failed(messageOf(board.error()));
}

/**
 * Dependencies arrive as parameters (SPEC §4b), so a test passes a fake API
 * and needs no network, no mocking framework and no browser.
 *
 * @example
 * const state = createDevicesState();
 * const effects = createDevicesEffects(fakeApi, state);
 */
export function createDevicesEffects(api: DeviceApi, state: DevicesState): DevicesEffects {
  const board = loadBoard(api, state);
  const live = liveReadings(api, state);
  const calibrate = calibration(api, state);
  const stopScrolling = watchScrolling(state);

  // The runtime cannot see an `addEventListener`, so this teardown is by hand.
  // The resource, the stream and the mutation clean themselves up (SPEC §5b).
  onDispose(stopScrolling);

  return {
    screens: { reading: createReading() },

    start: () => {
      watch(() => {
        commitBoard(board, state);
      });

      watch(() => {
        state.readingsArrived(live());
      });
    },

    filterBy: (room) => {
      state.filtered(room);
    },

    calibrate: (_payload, device) => {
      void calibrate.run(device.id);
    },

    retry: () => {
      board.invalidate();
    },
  };
}
