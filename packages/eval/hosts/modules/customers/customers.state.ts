// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor } from 'sheratan';

import type { Customer } from '../../services/api.contract.ts';

/** Where the list is in its load cycle. Exactly one of these is true (T01). */
export const Status = {
  Loading: 'loading',
  Ready: 'ready',
  Failed: 'failed',
} as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

/** Readable state plus the transitions that may change it. */
export interface CustomersState {
  readonly rows: Accessor<readonly Customer[]>;
  readonly status: Accessor<Status>;
  readonly error: Accessor<string>;
  readonly isLoading: Accessor<boolean>;
  readonly hasFailed: Accessor<boolean>;

  started(): void;
  loaded(rows: readonly Customer[]): void;
  failed(message: string): void;
}

const NO_ERROR = '';

const NO_ROWS: readonly Customer[] = [];

/** Builds the module's state. Called once per mount, inside the mount's scope. */
export function createCustomersState(): CustomersState {
  const rows = signal(NO_ROWS);
  const status = signal<Status>(Status.Loading);
  const error = signal(NO_ERROR);

  return {
    rows,
    status,
    error,
    isLoading: computed(() => status() === Status.Loading),
    hasFailed: computed(() => status() === Status.Failed),

    started(): void {
      batch(() => {
        status.set(Status.Loading);
        error.set(NO_ERROR);
      });
    },

    loaded(next: readonly Customer[]): void {
      batch(() => {
        rows.set(next);
        status.set(Status.Ready);
      });
    },

    failed(message: string): void {
      batch(() => {
        rows.set(NO_ROWS);
        error.set(message);
        status.set(Status.Failed);
      });
    },
  };
}
