// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import type { Order } from '../../services/api.contract.ts';
import type { OrdersState } from './orders.state.ts';

/** What this view asks the module to do. Intents are plain functions. */
export interface OrdersIntents {
  ship(this: void, payload: unknown, order?: unknown): void;
}

function row(order: Accessor<Order>, intents: OrdersIntents): Template {
  // Every cell is a computed in the row, so a status change writes one text
  // node and never rebuilds the row (SPEC §9).
  const id = computed(() => String(order().id));
  const customer = computed(() => order().customer);
  const status = computed(() => order().status);

  return html`<tr data-testid="order-row" data-order=${id}>
    <td>${id}</td>
    <td>${customer}</td>
    <td><span data-testid="status">${status}</span></td>
    <td><button data-testid="ship" @click=${intents.ship}>Mark Shipped</button></td>
  </tr>`;
}

/** The Orders list (T04): the badge moves before the server answers. */
export function ordersView(state: OrdersState, intents: OrdersIntents): Template {
  return html`<section class="orders">
    <h2>Orders</h2>
    <table>
      <tbody>
        ${each(state.rows, (order) => row(order, intents))}
      </tbody>
    </table>
  </section>`;
}
