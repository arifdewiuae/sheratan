// A synthetic feed, so the example needs no server and the load is a number we
// choose. A real app swaps this for a socket adapter and changes nothing else.

import type { FeedApi, Metric, Tick } from './feed.contract.ts';

/** The generator follows the frame clock, so the batch size comes from 60fps. */
const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

/** Only where a host has no frame clock. */
const FALLBACK_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
const SNAPSHOT_LATENCY_MS = 60;
const NAME_DIGITS = 3;
const DEFAULT_ROWS = 500;
const DEFAULT_RATE = 2000;

/**
 * Every row is an oscillator rather than a random walk. The load is identical —
 * the same number of values a second at the same random rows — but a value now
 * follows a continuous function of time, so the table sweeps like a level meter
 * instead of flickering. Noise looks broken; a wave looks fast.
 */
const TAU = 6.283_185_307_179_586;

/** Where a row sits, and how far above and below it swings. */
const BASE = 900;
const BASE_STEP = 40;
const SWING = 700;

/** Seconds for one full swing. Each name group breathes at its own rate. */
const PERIOD_S = 6;
const PERIOD_STEP_S = 0.7;

/**
 * Radians of head start per row id. Rows sit eight ids apart once the table is
 * sorted by name, so this spaces neighbours by ~0.4 rad: a group reads as one
 * wave travelling down the column.
 */
const PHASE_STEP = 0.05;

const NAMES = [
  'orders',
  'latency',
  'queue',
  'errors',
  'sessions',
  'throughput',
  'cache',
  'retries',
] as const;

/** A row's fixed shape. Computed once, never in the tick path. */
interface Oscillator {
  readonly name: string;
  readonly base: number;
  readonly period: number;
  readonly phase: number;
}

function seedRows(count: number): Oscillator[] {
  return Array.from({ length: count }, (_, index) => {
    const group = index % NAMES.length;

    return {
      name: `${NAMES[group] ?? 'metric'}-${String(index).padStart(NAME_DIGITS, '0')}`,
      base: BASE + group * BASE_STEP,
      period: PERIOD_S + group * PERIOD_STEP_S,
      phase: index * PHASE_STEP,
    };
  });
}

function valueAt(row: Oscillator, seconds: number): number {
  return Math.round(row.base + SWING * Math.sin((TAU * seconds) / row.period + row.phase));
}

/**
 * One batch of values, all read from the same instant. Two ticks landing on one
 * row inside a frame therefore carry the same number and cost one DOM write
 * between them, which is the coalescing the dashboard reports.
 */
function ticker(rows: readonly Oscillator[], perBatch: number, startedAt: number): () => Tick[] {
  return () => {
    const seconds = (performance.now() - startedAt) / MS_PER_SECOND;

    return Array.from({ length: perBatch }, () => {
      const id = Math.floor(Math.random() * rows.length);
      // `id` is floor(random × length), so it is always in range.
      const row = rows[id] as Oscillator;

      return { id, value: valueAt(row, seconds) };
    });
  };
}

/**
 * One batch per frame. A real feed keeps its own clock, but a synthetic one
 * should not invent load the screen cannot show — and a background tab then
 * goes quiet instead of queueing work nobody will see.
 */
function stream(
  next: () => Tick[],
  onBatch: (ticks: readonly Tick[]) => void,
  signal: AbortSignal,
): void {
  const frame = globalThis.requestAnimationFrame as ((callback: () => void) => number) | undefined;

  if (typeof frame !== 'function') {
    const timer = setInterval(() => {
      onBatch(next());
    }, FALLBACK_MS);

    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
      },
      { once: true },
    );

    return;
  }

  let live = true;

  const step = (): void => {
    if (!live) return;

    onBatch(next());
    frame(step);
  };

  signal.addEventListener(
    'abort',
    () => {
      live = false;
    },
    { once: true },
  );

  frame(step);
}

/** How big and how fast. Defaults are the dashboard's headline numbers. */
export interface FeedOptions {
  rows?: number;
  updatesPerSecond?: number;
}

/** A feed that invents `updatesPerSecond` values spread over `rows` rows. */
export function createSyntheticFeed(options: FeedOptions = {}): FeedApi {
  const rowCount = options.rows ?? DEFAULT_ROWS;
  const rate = options.updatesPerSecond ?? DEFAULT_RATE;
  const perBatch = Math.max(1, Math.round(rate / FRAMES_PER_SECOND));
  const rows = seedRows(rowCount);
  const startedAt = performance.now();

  return {
    snapshot: async (signal) =>
      new Promise<readonly Metric[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          const seconds = (performance.now() - startedAt) / MS_PER_SECOND;

          resolve(
            rows.map((row, id) => ({ id, name: row.name, value: valueAt(row, seconds), delta: 0 })),
          );
        }, SNAPSHOT_LATENCY_MS);

        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason as Error);
          },
          { once: true },
        );
      }),

    subscribe: (onBatch, signal) => {
      stream(ticker(rows, perBatch, startedAt), onBatch, signal);
    },
  };
}
