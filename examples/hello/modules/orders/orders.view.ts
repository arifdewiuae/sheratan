// Markup as a pure function of state (SPEC §4), and the layout every screen
// under /orders sits inside. The nested table is what makes this a layout:
// moving between its rows leaves this view, and the rows it loaded, in place.
//
// The child modules arrive as parameters. A view constructs nothing and
// imports no module (SHR-L001); it only places what it was handed.

import { computed, html, location, mount, routes, type ModuleView, type Template } from 'sheratan';

import type { OrderDetailProps } from '../order-detail/index.ts';
import type { OrderTableProps } from '../order-table/index.ts';
import { Status, type OrdersState } from './orders.state.ts';

/** The screens this view may place, built where their dependencies were. */
export interface OrdersScreens {
  readonly table: ModuleView<OrderTableProps>;
  readonly detail: ModuleView<OrderDetailProps>;
}

/** A row's id as the URL spells it, which is a string until state says otherwise. */
const NO_ID = '';

const CURRENT = 'page';

const NOT_CURRENT = 'false';

/** The layout: a nav, whatever the inner table matched, and nothing else. */
export function ordersView(state: OrdersState, screens: OrdersScreens): Template {
  // Props carry accessors, not values (SPEC §9a): /orders/1 to /orders/2
  // rewrites the fields, and the shell around them never re-renders.
  const inner = routes({
    '/orders': () => mount(screens.table, { rows: state.rows }),
    '/orders/:id': (params) =>
      mount(screens.detail, {
        rows: state.rows,
        id: computed(() => params()['id'] ?? NO_ID),
      }),
  });

  const note = computed(() => {
    if (state.status() === Status.Loading) return html`<p class="note">Loading orders…</p>`;

    if (state.status() === Status.Failed) {
      return html`<p class="note error">Could not load orders: ${state.error}</p>`;
    }

    return undefined;
  });

  // `inner()`, not `inner`: a hole reads an accessor, and one returned from
  // another computed would arrive as a function with nothing to render. The
  // memoisation still holds, because an unchanged pattern returns the same
  // placement object and the hole is never told to re-commit.
  const screen = computed(() => (state.status() === Status.Ready ? inner() : undefined));

  const listing = computed(() => (location().pathname === '/orders' ? CURRENT : NOT_CURRENT));

  return html`<section class="module-orders" data-module="orders">
    <nav class="orders-nav">
      <a href="/" data-link="home">Dashboard</a>
      <a href="/orders" data-link="orders" aria-current=${listing}>All orders</a>
      <span class="orders-count" data-count>${state.count} loaded</span>
    </nav>
    ${note} ${screen}
  </section>`;
}
