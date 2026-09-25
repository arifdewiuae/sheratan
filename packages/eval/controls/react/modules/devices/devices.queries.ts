// Server state: everything that came from the contract, and when it is stale.
// This is the only impure file in the module — it sequences, and it never
// decides what a number means.
//
// The two halves of the screen are deliberately kept apart. The devices and
// the limits are a query, so refetching, retrying and cancelling are the
// library's problem; the room, the scroll offset and the in-flight ids are in
// the Zustand store, because nothing outside this browser tab knows them.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import type { Device, Limits } from '../../services/devices.contract.ts';
import { useDeviceApi } from '../../services/devices.context.ts';
import { useDevicesStore, withCalibration } from './devices.store.ts';

/** Retries after the first attempt, for a list worth asking for three times. */
const LOAD_RETRIES = 2;

/** The first wait. The second is twice it, the third twice that. */
const RETRY_BASE_MS = 100;

const BACKOFF_FACTOR = 2;

/** The one query this module owns. */
const BOARD = 'board';

/** Everything one load produces, so the screen never shows half of it. */
export interface Board {
  readonly devices: readonly Device[];
  readonly limits: Limits;
}

/** How the board is cached: one entry per room. */
export type BoardKey = readonly [typeof BOARD, string];

/** The cache key for one room's board. */
export function boardKey(room: string): BoardKey {
  return [BOARD, room];
}

/**
 * The board, keyed by room. Changing the room asks for a different key, and
 * the query for the room being left is cancelled through the `AbortSignal`
 * `queryFn` is handed — so a slow answer for "Cellar" can never land after a
 * fast one for "Loft".
 *
 * @example
 * const board = useBoard();
 * if (board.isPending) return <p>Loading…</p>;
 */
export function useBoard(): UseQueryResult<Board, Error> {
  const api = useDeviceApi();
  const room = useDevicesStore((state) => state.room);

  return useQuery({
    queryKey: boardKey(room),

    queryFn: async ({ signal }): Promise<Board> => {
      // Two calls, one cache entry, so the screen never shows this room's
      // devices beside the last room's limits.
      const [devices, limits] = await Promise.all([api.list(room, signal), api.limits(signal)]);

      return { devices, limits };
    },

    retry: LOAD_RETRIES,
    retryDelay: (attempt) => RETRY_BASE_MS * BACKOFF_FACTOR ** attempt,
  });
}

/** What `onMutate` hands `onError`, so a failed write can be undone. */
interface Rollback {
  readonly key: BoardKey;
  readonly previous: Board | undefined;
}

/**
 * The write path, optimistic. `onMutate` edits the cache before the request
 * goes out and returns the entry it replaced; `onError` puts that entry back.
 *
 * @example
 * const calibrate = useCalibrate();
 * <button onClick={() => calibrate.mutate(device.id)}>Calibrate</button>;
 */
export function useCalibrate(): UseMutationResult<Device, Error, number, Rollback> {
  const api = useDeviceApi();
  const client = useQueryClient();
  const room = useDevicesStore((state) => state.room);
  const started = useDevicesStore((state) => state.calibrationStarted);
  const settled = useDevicesStore((state) => state.calibrationSettled);

  return useMutation({
    // TanStack Query does not cancel a mutation when the component unmounts,
    // so this signal is never aborted. It exists because the contract asks
    // every promise-returning method for one.
    mutationFn: (id: number) => api.calibrate(id, new AbortController().signal),

    onMutate: async (id: number): Promise<Rollback> => {
      const key = boardKey(room);

      // A refetch already in flight would land after this edit and overwrite
      // it, so it is cancelled first. This is the documented recipe.
      await client.cancelQueries({ queryKey: key });

      const previous = client.getQueryData<Board>(key);

      started(id);

      client.setQueryData<Board>(key, (board) =>
        board === undefined
          ? board
          : { ...board, devices: withCalibration(board.devices, id, true) },
      );

      return { key, previous };
    },

    onError: (_error, _id, context) => {
      if (context !== undefined) client.setQueryData(context.key, context.previous);
    },

    onSettled: (_device, _error, id) => {
      settled(id);
    },
  });
}

/**
 * The live feed, folded into the store. React batches the writes, so a burst
 * of messages costs one render rather than one each.
 *
 * @example
 * useLiveReadings();
 */
export function useLiveReadings(): void {
  const api = useDeviceApi();
  const arrived = useDevicesStore((state) => state.readingsArrived);

  useEffect(() => {
    const controller = new AbortController();
    const stop = api.subscribe(arrived, controller.signal);

    return () => {
      stop();
      controller.abort();
    };
  }, [api, arrived]);
}
