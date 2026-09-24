// The instrument. It runs in the page and is identical for both arms: the
// sample is the time from "apply the swaps" to "the page is laid out again",
// taken inside one animation frame.
//
// Why not the interval between frames: at 60 Hz a framework that finishes in
// 2 ms and one that finishes in 12 ms both produce 16.7 ms frames, and the
// number says nothing until one of them drops below the refresh rate. What a
// reordering costs is the work inside the frame, so that is what is timed.

import { FRAMES, WARMUP_FRAMES } from './workload.ts';

/** A frame budget at 60 Hz, for counting the samples that would have dropped one. */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * Runs `step` once per animation frame and returns the steady-state samples in
 * milliseconds. The first {@link WARMUP_FRAMES} are run and thrown away.
 */
export function measure(step: () => void): Promise<readonly number[]> {
  return new Promise((resolve) => {
    const samples: number[] = [];
    let frames = 0;

    const frame = (): void => {
      const started = performance.now();

      step();

      // Inside the sample on purpose: a runtime that only queues DOM writes
      // has not paid for them until the page is styled and laid out again.
      void document.body.offsetHeight;

      const elapsed = performance.now() - started;

      frames += 1;

      if (frames > WARMUP_FRAMES) samples.push(elapsed);

      if (samples.length < FRAMES) {
        requestAnimationFrame(frame);

        return;
      }

      resolve(samples);
    };

    requestAnimationFrame(frame);
  });
}
