// Effects: the only impure file (SPEC §4). It subscribes, samples a clock, and
// invokes transitions; it never decides what a number means.

import { onDispose } from 'sheratan';

import type { FeedApi } from '../../services/feed.contract.ts';
import { SortKey, type DashboardState } from './dashboard.state.ts';

const MS_PER_SECOND = 1000;

/** Sampled four times a second, so the rate tile is meaningful immediately. */
const SAMPLE_MS = 250;

/** What this module can do. The view declares the same shape for itself. */
export interface DashboardEffects {
  start(this: void): void;
  toggleLive(this: void): void;
  sortBy(this: void, value: string): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** A running count of the frames the host has painted. */
interface Frames {
  read(this: void): number;
  stop(this: void): void;
}

/**
 * Counts painted frames. Deliberately its own clock rather than the feed's
 * batch counter: a paused dashboard still renders, and the tile should still
 * read 60. A host without a frame clock reports zero and the tile says so.
 */
function frameCounter(): Frames {
  const frame = globalThis.requestAnimationFrame as ((callback: () => void) => number) | undefined;
  let painted = 0;
  let live = true;

  if (typeof frame === 'function') {
    const step = (): void => {
      if (!live) return;

      painted += 1;
      frame(step);
    };

    frame(step);
  }

  return {
    read: () => painted,
    stop: () => {
      live = false;
    },
  };
}

/** Samples per-second rates from counters that only ever grow. */
function sampler(state: DashboardState, frames: Frames): () => void {
  const windowsPerSecond = MS_PER_SECOND / SAMPLE_MS;
  let lastApplied = 0;
  let lastPainted = 0;

  const timer = setInterval(() => {
    const applied = state.applied();
    const painted = frames.read();

    state.sampled(
      (applied - lastApplied) * windowsPerSecond,
      (painted - lastPainted) * windowsPerSecond,
    );

    lastApplied = applied;
    lastPainted = painted;
  }, SAMPLE_MS);

  return () => {
    clearInterval(timer);
  };
}

/** Dependencies arrive as parameters (SPEC §4b): tests pass a fake feed. */
export function createDashboardEffects(feed: FeedApi, state: DashboardState): DashboardEffects {
  const controller = new AbortController();
  const { signal } = controller;
  const frames = frameCounter();
  const stopSampling = sampler(state, frames);

  // The runtime cannot see an interval or a socket, so teardown is by hand.
  // After this, the feed is unsubscribed and no late batch reaches a discarded
  // state (SPEC §5b).
  onDispose(() => {
    frames.stop();
    stopSampling();
    controller.abort();
  });

  return {
    start: () => {
      void (async () => {
        try {
          const metrics = await feed.snapshot(signal);

          if (signal.aborted) return;

          state.seeded(metrics);

          feed.subscribe((ticks) => {
            // Two reasons to drop a batch, and they are not the same thing:
            // the mount is gone (a write then reaches discarded state, SPEC
            // §5b rule 1 — an adapter that ignores its signal must not be able
            // to corrupt us), or the user paused, which stops applying without
            // dropping the subscription.
            if (signal.aborted || !state.live()) return;

            state.applyBatch(ticks);
          }, signal);
        } catch (error: unknown) {
          if (!signal.aborted) state.failed(messageOf(error));
        }
      })();
    },

    toggleLive: () => {
      state.toggledLive();
    },

    sortBy: (value) => {
      state.sorted(value === SortKey.Name ? SortKey.Name : SortKey.Value);
    },
  };
}
