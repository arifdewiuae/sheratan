// The one place a contract meets an adapter, and the only file that knows the
// whole page (SPEC §4). No feature logic lives here.

import { html, type Template } from 'sheratan';

import { createCustomers } from './modules/customers/index.ts';
import { createNewOrder } from './modules/new-order/index.ts';
import { createNotifications } from './modules/notifications/index.ts';
import { createOrders } from './modules/orders/index.ts';
import type { Api } from './services/api.contract.ts';

/** Composes the four modules of the eval host app against one API. */
export function createApp(api: Api): () => Template {
  return () => {
    const notifications = createNotifications();
    const customers = createCustomers(api, notifications.effects);
    const newOrder = createNewOrder(api, notifications.effects);
    const orders = createOrders(api, notifications.effects);

    return html`<main data-testid="app">
      ${notifications.view()} ${customers()} ${newOrder()} ${orders()}
    </main>`;
  };
}
