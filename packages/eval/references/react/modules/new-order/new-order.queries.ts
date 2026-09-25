// Server state: sending the draft, and what came back. The only impure file in
// this module — it sequences, and never decides what the data means.

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { RejectedError, type OrderDraft, type Rejected } from '../../services/api.contract.ts';
import { useApi } from '../../services/api.context.ts';
import { raise } from '../notifications/index.ts';
import { useNewOrder, type FieldErrors } from './new-order.store.ts';

/** The key a refusal with no field of its own is shown under. */
const FORM = 'form';

/** Field messages if the server sent them, or nothing if this is another kind of failure. */
function rejectionOf(error: unknown): FieldErrors | undefined {
  if (error instanceof RejectedError) return error.errors;
  if (typeof error !== 'object' || error === null) return undefined;

  const body = error as Partial<Rejected>;

  return typeof body.errors === 'object' ? body.errors : undefined;
}

/**
 * Sending one draft.
 *
 * `retry` is off, and for a write it is not a preference: asking the server to
 * create the same order again because the first answer was slow is how one
 * submission becomes two orders. The task counts requests for exactly this
 * reason.
 *
 * @example
 * const create = useCreateOrder();
 * create.mutate(draft);
 */
export function useCreateOrder(): UseMutationResult<number, Error, OrderDraft> {
  const api = useApi();
  const rejected = useNewOrder((state) => state.rejected);
  const cleared = useNewOrder((state) => state.cleared);

  return useMutation({
    // TanStack Query does not cancel a mutation when the component unmounts,
    // so this signal is never aborted. It exists because the contract asks
    // every promise-returning method for one.
    mutationFn: (draft: OrderDraft) => api.createOrder(draft, new AbortController().signal),

    retry: false,

    onSuccess: () => {
      cleared();
    },

    onError: (error: Error) => {
      const found = rejectionOf(error);

      if (found !== undefined) {
        rejected(found);

        return;
      }

      rejected({ [FORM]: error.message });
      raise(error.message);
    },
  });
}
