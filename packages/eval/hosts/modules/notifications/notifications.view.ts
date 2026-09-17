// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { html, type Template } from 'sheratan';

import type { NotificationsState } from './notifications.state.ts';

/** What this view asks the module to do. Intents are plain functions. */
export interface NotificationsIntents {
  dismiss(this: void): void;
}

/** The toast T04 asserts on, rendered only while there is something to say. */
export function notificationsView(
  state: NotificationsState,
  intents: NotificationsIntents,
): Template {
  return html`<div class="toasts">
    ${() =>
      state.showing()
        ? html`<div data-testid="toast" role="status">
            <span>${state.message}</span>
            <button data-testid="dismiss-toast" @click=${intents.dismiss}>Dismiss</button>
          </div>`
        : null}
  </div>`;
}
