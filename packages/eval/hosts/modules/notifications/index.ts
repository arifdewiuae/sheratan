// The module's only public surface (SPEC §4).

import type { Template } from 'sheratan';

import { createNotificationsEffects, type NotificationsEffects } from './notifications.effects.ts';

export type { NotificationsEffects } from './notifications.effects.ts';
import { createNotificationsState } from './notifications.state.ts';
import { notificationsView } from './notifications.view.ts';

/** `full`: this module has state, effects and a view (SHR-L006). */
export const kind = 'full';

/** The toast, plus the handle a sibling module raises it through. */
export interface Notifications {
  readonly view: () => Template;
  readonly effects: NotificationsEffects;
}

/**
 * Builds the module. `render()` calls this inside its own scope, so state,
 * timers and teardown belong to the mount (SPEC §4).
 */
export function createNotifications(): Notifications {
  const state = createNotificationsState();
  const effects = createNotificationsEffects(state);

  return {
    view: () => notificationsView(state, effects),
    effects,
  };
}
