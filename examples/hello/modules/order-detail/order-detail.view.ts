// A `view` module: one order, picked out of the rows the shell already holds
// (SPEC §4). Both props are accessors, so changing `/orders/1` to `/orders/2`
// rewrites the fields rather than the screen.

import { computed, html, type Accessor, type Template } from 'sheratan';

import { money } from '../../lib/format.ts';
import type { Metric } from '../../services/feed.contract.ts';

/** What a parent hands this module. */
export interface OrderDetailProps {
  readonly rows: Accessor<readonly Metric[]>;
  /** The id as the URL spells it. */
  readonly id: Accessor<string>;
}

/** One order's fields, or a note when the id names none. */
export function orderDetailView(props: OrderDetailProps): Template {
  const order = computed((): Metric | undefined =>
    props.rows().find((row) => String(row.id) === props.id()),
  );

  const body = computed(() => {
    const found = order();

    if (found === undefined) return html`<p class="note">No order ${props.id}.</p>`;

    return html`<dl class="order-fields">
      <dt>Name</dt>
      <dd data-field="name">${() => found.name}</dd>
      <dt>Value</dt>
      <dd data-field="value">${() => money(found.value)}</dd>
    </dl>`;
  });

  return html`<article class="order-detail" data-screen="detail" data-order-id=${props.id}>
    <h2>Order ${props.id}</h2>
    ${body}
    <a href="/orders" data-link="back">Back to all orders</a>
  </article>`;
}
