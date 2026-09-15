// Watchers (SPEC §5, §5b): the only thing that re-runs.

import { asDisposer, type Disposer } from './disposer.ts';
import {
  checkDirty,
  endTracking,
  Flags,
  type Link,
  type Observer,
  purgeDeps,
  setActiveSub,
  startTracking,
} from './graph.ts';
import { OwnerNode, getOwner, setActiveOwner } from './owner.ts';
import { enqueue, enterBatch, exitBatch, type Job } from './scheduler.ts';

class WatcherNode extends OwnerNode implements Observer, Job {
  deps: Link | undefined = undefined;

  depsTail: Link | undefined = undefined;

  drainId = -1;

  reruns = 0;

  private readonly fn: () => void;

  constructor(fn: () => void, frame: boolean) {
    super(getOwner());
    this.fn = fn;
    this.flags |= Flags.Dirty;

    if (frame) this.flags |= Flags.Frame;
  }

  notify(): void {
    enqueue(this);
  }

  update(): void {
    if ((this.flags & Flags.Disposed) !== 0) return;

    if ((this.flags & Flags.Dirty) !== 0) {
      this.run();

      return;
    }

    if ((this.flags & Flags.Pending) === 0) return;

    if (checkDirty(this)) this.run();
    else this.flags &= ~Flags.Pending;
  }

  run(): void {
    // Cleared before the run, so a write the run itself causes queues it again
    // instead of being swallowed.
    this.flags &= ~(Flags.Dirty | Flags.Pending);
    this.reset();

    const previousSub = setActiveSub(this);
    const previousOwner = setActiveOwner(this);

    startTracking(this);

    try {
      this.fn();
    } finally {
      endTracking(this);
      setActiveSub(previousSub);
      setActiveOwner(previousOwner);
    }
  }

  override teardown(): void {
    purgeDeps(this);
  }
}

function start(fn: () => void, frame: boolean): Disposer {
  const node = new WatcherNode(fn, frame);

  enterBatch();

  try {
    node.run();
  } finally {
    exitBatch();
  }

  return asDisposer(() => {
    node.dispose();
  });
}

/**
 * Runs `fn` now, and again whenever something it read changes. Returns the
 * disposer; the owning module disposes it automatically (SPEC §5b).
 *
 * @example
 * const stop = watch(() => log(count()));
 */
export function watch(fn: () => void): Disposer {
  return start(fn, false);
}

/** A watcher whose re-runs wait for the next frame. Template holes use it. */
export function watchFrame(fn: () => void): Disposer {
  return start(fn, true);
}
