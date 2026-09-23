// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { FeedApi } from '../../services/feed.contract.ts';
import { createOrdersEffects } from './orders.effects.ts';
import { createOrdersState } from './orders.state.ts';
import { ordersView } from './orders.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * The layout every screen under `/orders` sits inside. It loads the rows once
 * and holds them, so moving between the table and one order's detail does not
 * fetch them again — which is the whole reason the shell is a screen of its
 * own rather than part of each page.
 */
export function createOrders(feed: FeedApi): () => Template {
  return () => {
    const state = createOrdersState();
    const effects = createOrdersEffects(feed, state);

    effects.start();

    return ordersView(state, effects.screens);
  };
}
