// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { Api } from '../../services/api.contract.ts';
import type { NotificationsEffects } from '../notifications/index.ts';
import { createNewOrderEffects } from './new-order.effects.ts';
import { createNewOrderState } from './new-order.state.ts';
import { newOrderView } from './new-order.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * A factory returning a view function. `render()` calls it inside its own
 * scope, so state, watchers and teardown belong to the mount (SPEC §4).
 */
export function createNewOrder(api: Api, notifications: NotificationsEffects): () => Template {
  return () => {
    const state = createNewOrderState();
    const effects = createNewOrderEffects(api, state, notifications);

    return newOrderView(state, effects);
  };
}
