// Effects: the only impure file (SPEC §4). It calls the contract and invokes
// one transition, and it is where the child modules this layout shows are
// constructed — a view may not import another module, so the instances are
// built where their dependencies already exist and handed over (SPEC §9a).

import { onDispose, type ModuleView } from 'sheratan';

import type { FeedApi } from '../../services/feed.contract.ts';
import { createOrderDetail, type OrderDetailProps } from '../order-detail/index.ts';
import { createOrderTable, type OrderTableProps } from '../order-table/index.ts';
import type { OrdersState } from './orders.state.ts';

/** The screens this layout can show, ready for the view to place. */
export interface OrdersScreens {
  readonly table: ModuleView<OrderTableProps>;
  readonly detail: ModuleView<OrderDetailProps>;
}

/** What this module can do. The view declares the same shape for itself. */
export interface OrdersEffects {
  start(this: void): void;
  readonly screens: OrdersScreens;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Loads the rows once, and builds the screens the layout can show. */
export function createOrdersEffects(feed: FeedApi, state: OrdersState): OrdersEffects {
  const controller = new AbortController();

  onDispose(() => {
    controller.abort();
  });

  const load = async (): Promise<void> => {
    try {
      state.loaded(await feed.snapshot(controller.signal));
    } catch (error: unknown) {
      // An abort is the module unmounting, not a failure to report.
      if (controller.signal.aborted) return;

      state.failed(messageOf(error));
    }
  };

  return {
    screens: { table: createOrderTable(), detail: createOrderDetail() },

    start: (): void => {
      void load();
    },
  };
}
