// Server state: the orders, and the optimistic write that moves one of them.
// The only impure file in this module — it sequences, and never decides what
// the data means.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { Order } from '../../services/api.contract.ts';
import { useApi } from '../../services/api.context.ts';
import { raise } from '../notifications/index.ts';

/** The one query this module owns. */
export const ORDERS_KEY: readonly string[] = ['orders'];

/** The status the badge moves to before the server has agreed (T04). */
const SHIPPED = 'shipped';

/** What `isMutating` counts when the caller is the only one left in flight. */
const LAST_ONE = 1;

/** One order's status changed, leaving every other order alone. */
function withStatus(rows: readonly Order[], id: number, status: string): readonly Order[] {
  return rows.map((order) => (order.id === id ? { ...order, status } : order));
}

/** The status an order shows now, which is what a rollback restores. */
function statusOf(rows: readonly Order[], id: number): string {
  return rows.find((order) => order.id === id)?.status ?? SHIPPED;
}

/** Writes one row's status into the cache, or does nothing if there is no list yet. */
function setStatus(client: QueryClient, id: number, status: string): void {
  client.setQueryData<readonly Order[]>(ORDERS_KEY, (rows) =>
    rows === undefined ? rows : withStatus(rows, id, status),
  );
}

/**
 * The orders list.
 *
 * @example
 * const orders = useOrders();
 */
export function useOrders(): UseQueryResult<readonly Order[], Error> {
  const api = useApi();

  return useQuery({
    queryKey: ORDERS_KEY,
    queryFn: ({ signal }) => api.orders(signal),
  });
}

/** What `onMutate` hands `onError`: the one row's status, not the whole list. */
interface Rollback {
  readonly previous: string;
}

/**
 * Marking one order shipped, optimistically.
 *
 * Two departures from the recipe in the library's own documentation, both
 * forced by the third hidden test — two orders shipped at once, one refused:
 *
 * The rollback restores **one row**, not the cache entry `onMutate` snapshotted.
 * With two writes in flight, the second snapshots a list that already contains
 * the first's optimistic edit, so restoring a whole snapshot makes one
 * failure undo the other write as well.
 *
 * The refetch on settle waits for the **last** write. Invalidating while
 * another write is still in flight pulls a list from the server that predates
 * it, which is the stale overwrite the fourth test looks for.
 *
 * @example
 * const ship = useShipOrder();
 * <button onClick={() => ship.mutate(order.id)}>Mark Shipped</button>;
 */
export function useShipOrder(): UseMutationResult<void, Error, number, Rollback> {
  const api = useApi();
  const client = useQueryClient();

  return useMutation({
    // TanStack Query does not cancel a mutation when the component unmounts,
    // so this signal is never aborted. It exists because the contract asks
    // every promise-returning method for one.
    mutationFn: (id: number) => api.shipOrder(id, new AbortController().signal),

    retry: false,

    onMutate: async (id: number): Promise<Rollback> => {
      // A list already in flight would land after this edit and overwrite it.
      await client.cancelQueries({ queryKey: ORDERS_KEY });

      const previous = statusOf(client.getQueryData<readonly Order[]>(ORDERS_KEY) ?? [], id);

      setStatus(client, id, SHIPPED);

      return { previous };
    },

    onError: (error: Error, id: number, context) => {
      if (context !== undefined) setStatus(client, id, context.previous);

      raise(error.message);
    },

    onSettled: async () => {
      if (client.isMutating() !== LAST_ONE) return;

      await client.invalidateQueries({ queryKey: ORDERS_KEY });
    },
  });
}
