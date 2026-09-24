// The module's only public surface (SPEC §4). Nothing outside this directory
// imports a state, effects or view file directly (SHR-L001).

import type { Template } from 'sheratan';

import type { DeviceApi } from '../../services/devices.contract.ts';
import { createDevicesEffects } from './devices.effects.ts';
import { createDevicesState } from './devices.state.ts';
import { devicesView } from './devices.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * A factory returning a view function. `render()` and `mount()` call it inside
 * their own scope, so the signals, watchers and teardown created here belong
 * to the mount and die with it (SPEC §5b).
 *
 * @example
 * render(createDevices(createFixtureDevices()), host);
 */
export function createDevices(api: DeviceApi): () => Template {
  return () => {
    const state = createDevicesState();
    const effects = createDevicesEffects(api, state);

    effects.start();

    return devicesView(state, effects, effects.screens);
  };
}
