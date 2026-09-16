// The scheduler (SPEC §5). Propagation through computeds is synchronous;
// DOM-side watchers are coalesced to the next animation frame, last value
// wins, because the screen cannot show more than that.

import { ErrorCode } from './codes.ts';
import { fail } from './errors.ts';
import { DEV } from './env.ts';
import { Flags, type ReactiveNode } from './graph.ts';
import { traceIdle, traceQueued, traceRunning } from './trace.ts';

/** A watcher re-running this often in one drain is feeding itself. */
const MAX_RERUNS_PER_DRAIN = 100;

const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;

/** Used only where a host has no `requestAnimationFrame`, such as Node tests. */
const FRAME_FALLBACK_MS = MS_PER_SECOND / FRAMES_PER_SECOND;

/** Work the scheduler can run: a watcher, today. */
export interface Job extends ReactiveNode {
  drainId: number;
  reruns: number;
  update(): void;
}

const syncQueue: Job[] = [];
const frameQueue: Job[] = [];

let batchDepth = 0;
let drainId = 0;
let frameRequested = false;

/** Opens a batch; writes commit when the outermost one closes. */
export function enterBatch(): void {
  batchDepth++;
}

/** Closes a batch, draining synchronous work if it was the outermost. */
export function exitBatch(): void {
  batchDepth--;

  if (batchDepth === 0) drain(syncQueue);
}

/**
 * Writes inside `fn` commit once, when the outermost batch ends.
 *
 * @example
 * batch(() => { first.set(1); second.set(2); }); // one watcher run
 */
export function batch<T>(fn: () => T): T {
  enterBatch();

  try {
    return fn();
  } finally {
    exitBatch();
  }
}

/** Queues a watcher, or reports a watcher that will never settle. */
export function enqueue(job: Job): void {
  if ((job.flags & Flags.Queued) !== 0) return;

  if (job.drainId === drainId) {
    job.reruns++;

    if (job.reruns > MAX_RERUNS_PER_DRAIN) {
      fail(ErrorCode.WatchersDidNotSettle, MAX_RERUNS_PER_DRAIN);
    }
  } else {
    job.drainId = drainId;
    job.reruns = 0;
  }

  // A patch runs a frame after the write that caused it, so the chain is
  // stamped here and read back in the drain (SPEC §7).
  if (DEV) traceQueued(job);

  job.flags |= Flags.Queued;

  if ((job.flags & Flags.Frame) === 0) {
    syncQueue.push(job);

    return;
  }

  frameQueue.push(job);
  requestFrame();
}

// Jobs queued during the drain join the same pass, so a watcher that writes
// what another reads settles before control returns.
function drain(queue: Job[]): void {
  drainId++;
  batchDepth++;

  let index = 0;

  try {
    for (; index < queue.length; index++) {
      const job = queue[index] as Job;

      job.flags &= ~Flags.Queued;

      if (DEV) traceRunning(job);

      job.update();
    }
  } finally {
    queue.splice(0, Math.min(index + 1, queue.length));
    batchDepth--;

    if (DEV) traceIdle();
  }
}

function requestFrame(): void {
  if (frameRequested) return;

  frameRequested = true;

  const raf = globalThis.requestAnimationFrame as ((callback: () => void) => number) | undefined;

  if (typeof raf === 'function') {
    raf(onFrame);

    return;
  }

  setTimeout(onFrame, FRAME_FALLBACK_MS);
}

function onFrame(): void {
  if (frameRequested) flush();
}

/**
 * Applies pending DOM updates now, for tests and for code that must read
 * layout immediately after a write.
 */
export function flush(): void {
  frameRequested = false;
  enterBatch();

  try {
    drain(frameQueue);
  } finally {
    exitBatch();
  }
}
