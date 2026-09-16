// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor, type Signal } from 'sheratan';

import type { Metric, Tick } from '../../services/feed.contract.ts';

/** Which column the table is ordered by. */
export const SortKey = {
  Value: 'value',
  Name: 'name',
} as const;

/** One of {@link SortKey}. */
export type SortKey = (typeof SortKey)[keyof typeof SortKey];

/** Where the module is in its load cycle. */
export const Status = {
  Loading: 'loading',
  Ready: 'ready',
  Failed: 'failed',
} as const;

/** One of {@link Status}. */
export type Status = (typeof Status)[keyof typeof Status];

/** Readable state plus the transitions that may change it. */
export interface DashboardState {
  readonly rows: Accessor<readonly Metric[]>;
  readonly status: Accessor<Status>;
  readonly error: Accessor<string>;
  readonly sortedBy: Accessor<SortKey>;
  readonly live: Accessor<boolean>;
  /** Values applied since the mount. */
  readonly applied: Accessor<number>;
  /** Batches applied since the mount. */
  readonly batches: Accessor<number>;
  /** Values per second, sampled once a second by effects. */
  readonly rate: Accessor<number>;

  /** The table's order: derived, never stored. */
  readonly visible: Accessor<readonly Metric[]>;
  /** How many rows moved up on the last batch. */
  readonly rising: Accessor<number>;

  seeded(metrics: readonly Metric[]): void;
  failed(message: string): void;
  /** One commit for a whole batch: rows and counters move together. */
  applyBatch(ticks: readonly Tick[]): void;
  sampled(rate: number): void;
  toggledLive(): void;
  sorted(key: SortKey): void;
}

function apply(rows: readonly Metric[], ticks: readonly Tick[]): readonly Metric[] {
  const latest = new Map<number, number>();

  for (const tick of ticks) latest.set(tick.id, tick.value);

  return rows.map((row) => {
    const value = latest.get(row.id);

    if (value === undefined || value === row.value) return row;

    return { ...row, value, delta: value - row.value };
  });
}

function order(rows: readonly Metric[], key: SortKey): readonly Metric[] {
  if (key === SortKey.Name) {
    return rows.toSorted((left, right) => left.name.localeCompare(right.name));
  }

  return rows.toSorted((left, right) => right.value - left.value);
}

interface Signals {
  rows: Signal<readonly Metric[]>;
  status: Signal<Status>;
  error: Signal<string>;
  sortKey: Signal<SortKey>;
  live: Signal<boolean>;
  applied: Signal<number>;
  batches: Signal<number>;
  rate: Signal<number>;
}

/** The transitions, kept apart from the signals they commit to. */
function transitions(
  state: Signals,
): Pick<DashboardState, 'seeded' | 'failed' | 'applyBatch' | 'sampled' | 'toggledLive' | 'sorted'> {
  return {
    seeded: (metrics) => {
      batch(() => {
        state.rows.set(metrics);
        state.status.set(Status.Ready);
        state.error.set('');
      });
    },

    failed: (message) => {
      batch(() => {
        state.status.set(Status.Failed);
        state.error.set(message);
      });
    },

    applyBatch: (ticks) => {
      batch(() => {
        state.rows.set(apply(state.rows(), ticks));
        state.applied.set(state.applied() + ticks.length);
        state.batches.set(state.batches() + 1);
      });
    },

    sampled: (next) => {
      state.rate.set(next);
    },

    toggledLive: () => {
      state.live.set(!state.live());
    },

    sorted: (key) => {
      state.sortKey.set(key);
    },
  };
}

/** A factory, so every mount and every test starts clean (SPEC §4). */
export function createDashboardState(): DashboardState {
  const signals: Signals = {
    rows: signal<readonly Metric[]>([]),
    status: signal<Status>(Status.Loading),
    error: signal(''),
    sortKey: signal<SortKey>(SortKey.Name),
    live: signal(true),
    applied: signal(0),
    batches: signal(0),
    rate: signal(0),
  };

  // Sorting on every batch is the point: values churn, so the order churns,
  // and the reconciler moves the minimum number of rows (SPEC §9).
  const visible = computed(() => order(signals.rows(), signals.sortKey()));
  const rising = computed(() => signals.rows().filter((row) => row.delta > 0).length);

  return {
    rows: signals.rows,
    status: signals.status,
    error: signals.error,
    sortedBy: signals.sortKey,
    live: signals.live,
    applied: signals.applied,
    batches: signals.batches,
    rate: signals.rate,
    visible,
    rising,
    ...transitions(signals),
  };
}
