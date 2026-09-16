// A synthetic feed, so the example needs no server and the load is a number we
// choose. A real app swaps this for a socket adapter and changes nothing else.

import type { FeedApi, Metric, Tick } from './feed.contract.ts';

/** The generator follows the frame clock, so the batch size comes from 60fps. */
const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

/** Only where a host has no frame clock. */
const FALLBACK_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
const SNAPSHOT_LATENCY_MS = 60;
const BASE_VALUE = 200;
const SPREAD = 1400;
const DRIFT = 140;
const HALF = 0.5;
const NAME_DIGITS = 3;
const DEFAULT_ROWS = 500;
const DEFAULT_RATE = 2000;

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

/** Produces one batch of new values, and remembers them for the next one. */
function ticker(rows: Metric[], perBatch: number): () => Tick[] {
  return () =>
    Array.from({ length: perBatch }, () => {
      const id = Math.floor(Math.random() * rows.length);
      const previous = rows[id]?.value ?? BASE_VALUE;
      const value = Math.max(0, Math.round(previous + (Math.random() - HALF) * DRIFT));

      rows[id] = { id, name: rows[id]?.name ?? '', value, delta: value - previous };

      return { id, value };
    });
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

function seedRows(count: number): Metric[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    name: `${NAMES[index % NAMES.length] ?? 'metric'}-${String(index).padStart(NAME_DIGITS, '0')}`,
    value: BASE_VALUE + Math.round(Math.random() * SPREAD),
    delta: 0,
  }));
}

/** A feed that invents `updatesPerSecond` values spread over `rows` rows. */
export function createSyntheticFeed(options: FeedOptions = {}): FeedApi {
  const rowCount = options.rows ?? DEFAULT_ROWS;
  const rate = options.updatesPerSecond ?? DEFAULT_RATE;
  const perBatch = Math.max(1, Math.round(rate / FRAMES_PER_SECOND));
  const rows = seedRows(rowCount);

  return {
    snapshot: async (signal) =>
      new Promise<readonly Metric[]>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(rows.map((row) => ({ ...row }))),
          SNAPSHOT_LATENCY_MS,
        );

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
      stream(ticker(rows, perBatch), onBatch, signal);
    },
  };
}
