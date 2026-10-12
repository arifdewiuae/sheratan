// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import type { AlertsApi } from '../../services/alerts.contract.ts';
import { createAlertsEffects } from './alerts.effects.ts';
import { createAlertsState } from './alerts.state.ts';
import { alertsView } from './alerts.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/** The alert rules screen: the rules kept so far, and a form to add one. */
export function createAlerts(api: AlertsApi): () => Template {
  return () => {
    const state = createAlertsState();
    const effects = createAlertsEffects(api, state);

    effects.start();

    return alertsView(state, effects);
  };
}
