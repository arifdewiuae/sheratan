// How a module gets the contract without knowing what implements it. The
// adapter is chosen once, in `main.tsx`; everything above that asks for
// `DeviceApi` and is given whatever was provided, which is what makes a fake
// one in a test free.

import { createContext, use } from 'react';

import type { DeviceApi } from './devices.contract.ts';

/**
 * The contract, provided at the composition root. There is no default: a
 * module rendered outside the provider is a wiring mistake, and failing at
 * once beats falling back to a real transport nobody meant to use.
 */
export const DeviceApiContext = createContext<DeviceApi | undefined>(undefined);

/**
 * The contract this module was given.
 *
 * @example
 * const api = useDeviceApi();
 * const devices = await api.list('', signal);
 */
export function useDeviceApi(): DeviceApi {
  const api = use(DeviceApiContext);

  if (api === undefined) throw new Error('no DeviceApi: render this inside <DeviceApiContext>');

  return api;
}
