// The module's only public surface (SPEC §4).

import type { ModuleView } from 'sheratan';

import { orderDetailView, type OrderDetailProps } from './order-detail.view.ts';

export type { OrderDetailProps };

/** `view`: markup only, so this module has no state and no effects (SHR-L006). */
export const kind = 'view';

/** One order, read out of the rows its parent already loaded. */
export function createOrderDetail(): ModuleView<OrderDetailProps> {
  return orderDetailView;
}
