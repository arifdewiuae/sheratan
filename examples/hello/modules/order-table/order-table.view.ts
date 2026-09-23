// A `view` module: markup as a pure function of the props its parent passes
// (SPEC §4). It owns no state, so it has no state or effects file, and the
// rows arrive as an accessor rather than a value — the child's own holes read
// them, so a change rewrites cells instead of the screen (SPEC §9a).

import { each, html, type Accessor, type Template } from 'sheratan';

import { money } from '../../lib/format.ts';
import type { Metric } from '../../services/feed.contract.ts';

/** What a parent hands this module. */
export interface OrderTableProps {
  readonly rows: Accessor<readonly Metric[]>;
}

/** Every order the shell loaded, as links into one order's detail. */
export function orderTableView(props: OrderTableProps): Template {
  // Rows are keyed by `id` on the item itself, so a reorder moves nodes
  // instead of rewriting them, and the row runs once per order.
  const rows = each(
    props.rows,
    (row) => html`<li class="order-row">
      <a href=${() => `/orders/${String(row().id)}`} data-order=${() => String(row().id)}>
        ${() => row().name}
      </a>
      <span class="order-value">${() => money(row().value)}</span>
    </li>`,
  );

  return html`<ul class="order-table" data-screen="table">
    ${rows}
  </ul>`;
}
