// The workload both arms run, defined once so neither can be measured on an
// easier version of it: EVAL's Week 1 gate names 500 rows reordered 20 swaps
// at a time, and Docs/TASKS.md fixes p95 frame time over 5 runs as the number.
//
// This file runs in the browser. It holds no framework import on purpose —
// the arms differ only in how they render the same rows and apply the same
// swaps, in the same order, from the same seed.

/** Rows in the list. The gate's number, not a tunable. */
export const ROWS = 500;

/** Swaps applied before each commit. The gate's number. */
export const SWAPS_PER_FRAME = 20;

/**
 * Frames measured per run. 600 at 60 Hz is ten seconds: at 300 the per-run p95
 * swung by a third between sessions, which is too loose to rule on a 2x gate.
 */
export const FRAMES = 600;

/** Frames run and discarded first, so the number is steady-state and not the JIT warming up. */
export const WARMUP_FRAMES = 120;

/** One seed for every arm and every run, so the swap sequence is the same everywhere. */
export const SEED = 0x5ceb_a7a4;

/** A row. `id` is what a keyed list reconciles on, so it has to be on the item. */
export interface Row {
  readonly id: number;
  readonly label: string;
  readonly value: number;
}

const LABEL_BASE = 36;

/** The starting list. Identical across arms: same ids, same labels, same order. */
export function makeRows(): Row[] {
  return Array.from({ length: ROWS }, (_unused, index) => ({
    id: index,
    label: `row-${index.toString(LABEL_BASE)}`,
    value: index * index,
  }));
}

/** mulberry32 constants. A named PRNG beats `Math.random()`: the two arms must swap alike. */
const MIX_1 = 0x6d2b_79f5;
const MIX_2 = 61;
const MIX_3 = 7;
const MIX_4 = 14;
const MIX_5 = 15;
const SHIFT_32 = 4_294_967_296;

/**
 * A stream of index pairs to swap. Deterministic from `seed`, so run 3 of the
 * Solid arm reorders exactly as run 3 of the Sheratan arm did.
 */
export function swaps(seed: number): () => readonly [number, number] {
  let state = seed;

  const random = (): number => {
    state = (state + MIX_1) | 0;

    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> MIX_5), 1 | mixed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> MIX_3), MIX_2 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> MIX_4)) >>> 0) / SHIFT_32;
  };

  return () => [Math.floor(random() * ROWS), Math.floor(random() * ROWS)];
}
