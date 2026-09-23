// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor, type Signal } from 'sheratan';

import type { Metric } from '../../services/feed.contract.ts';

/** Where the module is in its load cycle. */
export const Status = {
  Loading: 'loading',
  Ready: 'ready',
  Failed: 'failed',
} as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

/** Readable state plus the transitions that may change it (SHR-L010). */
export interface OrdersState {
  readonly rows: Accessor<readonly Metric[]>;
  readonly status: Accessor<Status>;
  readonly error: Accessor<string>;
  /** How many rows arrived, derived rather than stored. */
  readonly count: Accessor<number>;
  loaded(this: void, rows: readonly Metric[]): void;
  failed(this: void, reason: string): void;
}

/** The writable handles, which never leave this file. */
interface Signals {
  readonly rows: Signal<readonly Metric[]>;
  readonly status: Signal<Status>;
  readonly error: Signal<string>;
}

const NO_ERROR = '';

/** Signals and the transitions that may write them; nothing else leaves. */
export function createOrdersState(): OrdersState {
  const signals: Signals = {
    rows: signal<readonly Metric[]>([]),
    status: signal<Status>(Status.Loading),
    error: signal(NO_ERROR),
  };

  const count = computed(() => signals.rows().length);

  return {
    rows: signals.rows,
    status: signals.status,
    error: signals.error,
    count,

    loaded: (rows: readonly Metric[]): void => {
      batch(() => {
        signals.rows.set(rows);
        signals.status.set(Status.Ready);
        signals.error.set(NO_ERROR);
      });
    },

    failed: (reason: string): void => {
      batch(() => {
        signals.status.set(Status.Failed);
        signals.error.set(reason);
      });
    },
  };
}
