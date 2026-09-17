// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { Api } from '../../services/api.contract.ts';
import type { NotificationsEffects } from '../notifications/index.ts';
import { createOrdersEffects } from './orders.effects.ts';
import { createOrdersState } from './orders.state.ts';
import { ordersView } from './orders.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * A factory returning a view function. `render()` calls it inside its own
 * scope, so state, watchers and teardown belong to the mount (SPEC §4).
 */
export function createOrders(api: Api, notifications: NotificationsEffects): () => Template {
  return () => {
    const state = createOrdersState();
    const effects = createOrdersEffects(api, state, notifications);

    effects.load();

    return ordersView(state, effects);
  };
}
