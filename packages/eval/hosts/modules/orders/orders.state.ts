// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor } from 'sheratan';

import type { Order } from '../../services/api.contract.ts';

/** The one status T04 moves an order into, optimistically. */
export const SHIPPED = 'shipped';

const NO_ROWS: readonly Order[] = [];

/** Readable state plus the transitions that may change it. */
export interface OrdersState {
  readonly rows: Accessor<readonly Order[]>;
  readonly loaded: Accessor<boolean>;
  /** Orders whose PATCH has not come back yet, so the list cannot overwrite them. */
  readonly inFlight: Accessor<ReadonlySet<number>>;

  listed(rows: readonly Order[]): void;
  /** Moves one order to `shipped` before the server has agreed (T04). */
  shipping(id: number): void;
  shipped(id: number): void;
  /** Puts one order back to what it was, leaving the others alone. */
  reverted(id: number, status: string): void;
}

function replace(rows: readonly Order[], id: number, status: string): readonly Order[] {
  return rows.map((order) => (order.id === id ? { ...order, status } : order));
}

function without(ids: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const next = new Set(ids);

  next.delete(id);

  return next;
}

/** Builds the module's state. Called once per mount, inside the mount's scope. */
export function createOrdersState(): OrdersState {
  const rows = signal(NO_ROWS);
  const listed = signal(false);
  const inFlight = signal<ReadonlySet<number>>(new Set<number>());

  /** A later list response must not undo an optimistic change still in flight. */
  const keepInFlight = (next: readonly Order[]): readonly Order[] => {
    const pending = inFlight();

    if (pending.size === 0) return next;

    const current = new Map(rows().map((order) => [order.id, order.status]));

    return next.map((order) =>
      pending.has(order.id) ? { ...order, status: current.get(order.id) ?? order.status } : order,
    );
  };

  return {
    rows,
    loaded: listed,
    inFlight,

    listed(next: readonly Order[]): void {
      batch(() => {
        rows.set(keepInFlight(next));
        listed.set(true);
      });
    },

    shipping(id: number): void {
      batch(() => {
        rows.set(replace(rows(), id, SHIPPED));
        inFlight.set(new Set(inFlight()).add(id));
      });
    },

    shipped(id: number): void {
      inFlight.set(without(inFlight(), id));
    },

    reverted(id: number, status: string): void {
      batch(() => {
        rows.set(replace(rows(), id, status));
        inFlight.set(without(inFlight(), id));
      });
    },
  };
}

/** The status an order shows now, which is what a rollback restores. */
export function statusOf(rows: readonly Order[], id: number): string {
  return rows.find((order) => order.id === id)?.status ?? SHIPPED;
}

/** Whether anything is waiting on the server, for the list's busy affordance. */
export function isBusy(state: OrdersState): Accessor<boolean> {
  return computed(() => state.inFlight().size > 0);
}
