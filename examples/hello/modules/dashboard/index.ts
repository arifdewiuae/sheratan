// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { FeedApi } from '../../services/feed.contract.ts';
import { createDashboardEffects } from './dashboard.effects.ts';
import { createDashboardState } from './dashboard.state.ts';
import { dashboardView } from './dashboard.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/**
 * A factory returning a view function. `render()` calls it inside its own
 * scope, so state, watchers and teardown belong to the mount (SPEC §4).
 */
export function createDashboard(feed: FeedApi): () => Template {
  return () => {
    const state = createDashboardState();
    const effects = createDashboardEffects(feed, state);

    effects.start();

    return dashboardView(state, effects);
  };
}
