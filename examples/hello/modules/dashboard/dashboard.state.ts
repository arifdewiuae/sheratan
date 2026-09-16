// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor, type EachWindow, type Signal } from 'sheratan';

import { OVERSCAN_ROWS, ROW_HEIGHT_PX, WINDOW_ROWS } from '../../lib/layout.ts';
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
  /** Values received since the mount. */
  readonly applied: Accessor<number>;
  /** Rows whose value actually changed, which is what reaches the DOM. */
  readonly written: Accessor<number>;
  /** Batches applied since the mount. */
  readonly batches: Accessor<number>;
  /** Values a second, sampled by effects. */
  readonly rate: Accessor<number>;
  /** Frames a second, sampled by effects: the one number anyone can read. */
  readonly fps: Accessor<number>;
  /** Share of arriving values that changed nothing, and so cost nothing. 0…1. */
  readonly skipped: Accessor<number>;
  /** Whether the table renders a window of rows or all of them. */
  readonly windowed: Accessor<boolean>;
  /** Rows that exist in the DOM, which is the number virtualising changes. */
  readonly inPage: Accessor<number>;

  /** The table's order: derived, never stored. */
  readonly visible: Accessor<readonly Metric[]>;
  /** Which rows `each` renders, worked out from the scroll offset (SPEC §9). */
  readonly rowWindow: Accessor<EachWindow>;

  seeded(metrics: readonly Metric[]): void;
  failed(message: string): void;
  /** One commit for a whole batch: rows and counters move together. */
  applyBatch(ticks: readonly Tick[]): void;
  sampled(rate: number, fps: number): void;
  toggledLive(): void;
  sorted(key: SortKey): void;
  toggledWindowing(): void;
  /** The table's scroll offset in CSS pixels, read by effects. */
  scrolled(top: number): void;
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
  written: Signal<number>;
  fps: Signal<number>;
  status: Signal<Status>;
  error: Signal<string>;
  sortKey: Signal<SortKey>;
  live: Signal<boolean>;
  applied: Signal<number>;
  batches: Signal<number>;
  rate: Signal<number>;
  windowed: Signal<boolean>;
  scrollTop: Signal<number>;
}

/** What the feed drives, kept apart from the signals it commits to. */
function feedTransitions(
  state: Signals,
): Pick<DashboardState, 'seeded' | 'failed' | 'applyBatch' | 'sampled'> {
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
      const before = state.rows();
      const next = apply(before, ticks);
      // Several values can land on one row in one batch, and a value can
      // repeat. Only a row that really changed costs a DOM write.
      const changed = next.filter((row, index) => row !== before[index]).length;

      batch(() => {
        state.rows.set(next);
        state.applied.set(state.applied() + ticks.length);
        state.written.set(state.written() + changed);
        state.batches.set(state.batches() + 1);
      });
    },

    sampled: (values, frames) => {
      batch(() => {
        state.rate.set(values);
        state.fps.set(frames);
      });
    },
  };
}

/** What a person drives: two controls and the scrollbar under their thumb. */
function controlTransitions(
  state: Signals,
): Pick<DashboardState, 'toggledLive' | 'sorted' | 'toggledWindowing' | 'scrolled'> {
  return {
    toggledLive: () => {
      state.live.set(!state.live());
    },

    sorted: (key) => {
      state.sortKey.set(key);
    },

    toggledWindowing: () => {
      state.windowed.set(!state.windowed());
    },

    scrolled: (top) => {
      state.scrollTop.set(top);
    },
  };
}

/**
 * The caller's half of a windowed `each` (ADR 0003): a scroll offset in, three
 * numbers out. `start` can come out negative at the top of a rubber-banding
 * scroll, and `each` clamps it rather than treating it as a mistake.
 */
function windowOver(state: Signals): Accessor<EachWindow> {
  return computed(() => ({
    start: Math.floor(state.scrollTop() / ROW_HEIGHT_PX) - OVERSCAN_ROWS,
    count: WINDOW_ROWS,
    rowHeight: ROW_HEIGHT_PX,
  }));
}

/** What virtualising actually changes. "Rows live" stays five hundred either way. */
function rowsInPage(state: Signals): Accessor<number> {
  return computed(() => {
    const total = state.rows().length;

    if (!state.windowed()) return total;

    return Math.min(WINDOW_ROWS, total);
  });
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
    written: signal(0),
    batches: signal(0),
    rate: signal(0),
    fps: signal(0),
    windowed: signal(true),
    scrollTop: signal(0),
  };

  // Sorting on every batch is the point: values churn, so the order churns,
  // and the reconciler moves the minimum number of rows (SPEC §9).
  const visible = computed(() => order(signals.rows(), signals.sortKey()));

  // A lifetime ratio, not a sampled one: it settles instead of jittering, and
  // the claim it makes is about the whole run rather than the last quarter
  // second.
  const skipped = computed(() => {
    const total = signals.applied();

    if (total === 0) return 0;

    return (total - signals.written()) / total;
  });

  return {
    rows: signals.rows,
    status: signals.status,
    error: signals.error,
    sortedBy: signals.sortKey,
    live: signals.live,
    applied: signals.applied,
    written: signals.written,
    batches: signals.batches,
    rate: signals.rate,
    fps: signals.fps,
    skipped,
    windowed: signals.windowed,
    inPage: rowsInPage(signals),
    visible,
    rowWindow: windowOver(signals),
    ...feedTransitions(signals),
    ...controlTransitions(signals),
  };
}
