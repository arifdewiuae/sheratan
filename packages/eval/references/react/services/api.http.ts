// The adapter that puts this app in front of `evalkit` over HTTP, and the only
// file in the tree that knows `/api` exists.

import {
  RejectedError,
  type Api,
  type Customer,
  type Order,
  type OrderDraft,
} from './api.contract.ts';

/** Where `evalkit` answers, at the origin the page was served from. */
const API = '/api';

/** The one status that explains itself field by field (evalkit CONTRACT.md). */
const UNPROCESSABLE = 422;

/** The wire value `PATCH /api/orders/:id` takes, which CONTRACT.md fixes. */
const SHIPPED = 'shipped';

const JSON_BODY = { 'content-type': 'application/json' } as const;

/** Either failure shape CONTRACT.md defines, read without deciding which. */
interface Refusal {
  readonly error?: string;
  readonly errors?: Readonly<Record<string, string>>;
}

/** Whatever the body says went wrong, as the error the modules are written for. */
async function refusalOf(answer: Response): Promise<Error> {
  const body = (await answer.json().catch(() => ({}))) as Refusal;

  if (answer.status === UNPROCESSABLE && body.errors !== undefined) {
    return new RejectedError(body.errors);
  }

  return new Error(body.error ?? `The server answered ${String(answer.status)}.`);
}

/** One call, parsed, with a refusal raised as the error the contract names. */
async function ask<T>(path: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const answer = await fetch(`${API}${path}`, { ...init, signal });

  if (!answer.ok) throw await refusalOf(answer);

  return (await answer.json()) as T;
}

/**
 * The API over HTTP. Nothing above this line changes when it is swapped for a
 * fake, which is the whole point of the contract.
 *
 * @example
 * <ApiContext value={createHttpApi()}>…</ApiContext>
 */
export function createHttpApi(): Api {
  return {
    customers: (signal: AbortSignal) => ask<readonly Customer[]>('/customers', signal),
    orders: (signal: AbortSignal) => ask<readonly Order[]>('/orders', signal),

    createOrder: async (draft: OrderDraft, signal: AbortSignal) => {
      const created = await ask<{ readonly id: number }>('/orders', signal, {
        method: 'POST',
        headers: JSON_BODY,
        body: JSON.stringify(draft),
      });

      return created.id;
    },

    shipOrder: async (id: number, signal: AbortSignal) => {
      await ask<Order>(`/orders/${String(id)}`, signal, {
        method: 'PATCH',
        headers: JSON_BODY,
        body: JSON.stringify({ status: SHIPPED }),
      });
    },
  };
}
