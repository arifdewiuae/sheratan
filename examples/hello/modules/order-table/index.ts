// The module's only public surface (SPEC §4).

import type { ModuleView } from 'sheratan';

import { orderTableView, type OrderTableProps } from './order-table.view.ts';

export type { OrderTableProps };

/** `view`: markup only, so this module has no state and no effects (SHR-L006). */
export const kind = 'view';

/** Every order the shell loaded, as links into one order's detail. */
export function createOrderTable(): ModuleView<OrderTableProps> {
  return orderTableView;
}
