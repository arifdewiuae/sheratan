// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { Api } from '../../services/api.contract.ts';
import type { NotificationsEffects } from '../notifications/index.ts';
import { createCustomersEffects } from './customers.effects.ts';
import { createCustomersState } from './customers.state.ts';
import { customersView } from './customers.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * A factory returning a view function. `render()` calls it inside its own
 * scope, so state, watchers and teardown belong to the mount (SPEC §4).
 */
export function createCustomers(api: Api, notifications: NotificationsEffects): () => Template {
  return () => {
    const state = createCustomersState();
    const effects = createCustomersEffects(api, state, notifications);

    effects.load();

    return customersView(state, effects);
  };
}
