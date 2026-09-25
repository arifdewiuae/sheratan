// Server state: the customer list, and when it is stale. The only impure file
// in this module — it sequences, and never decides what the data means.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Customer } from '../../services/api.contract.ts';
import { useApi } from '../../services/api.context.ts';

/** The one query this module owns. Shared with the order form's select. */
export const CUSTOMERS_KEY: readonly string[] = ['customers'];

/**
 * The customer list.
 *
 * `retry` is off deliberately, and it is the one setting here that is a
 * decision rather than a default. The task asks for an error state with a
 * Retry button the person presses; a library that quietly asks again three
 * times first has taken that decision away from them, and the error the task
 * describes would never appear. Retrying is what the button is for.
 *
 * @example
 * const customers = useCustomers();
 * if (customers.isPending) return <p>Loading…</p>;
 */
export function useCustomers(): UseQueryResult<readonly Customer[], Error> {
  const api = useApi();

  return useQuery({
    queryKey: CUSTOMERS_KEY,
    queryFn: ({ signal }) => api.customers(signal),
    retry: false,
  });
}
