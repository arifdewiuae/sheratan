// How a module gets the contract without knowing what implements it. The
// adapter is chosen once, in `main.tsx`.

import { createContext, use } from 'react';

import type { Api } from './api.contract.ts';

/**
 * The contract, provided at the composition root. There is no default: a
 * module rendered outside the provider is a wiring mistake, and failing at
 * once beats falling back to a real transport nobody meant to use.
 */
export const ApiContext = createContext<Api | undefined>(undefined);

/**
 * The contract this module was given.
 *
 * @example
 * const api = useApi();
 * const rows = await api.customers(signal);
 */
export function useApi(): Api {
  const api = use(ApiContext);

  if (api === undefined) throw new Error('no Api: render this inside <ApiContext>');

  return api;
}
