// Written before the implementation (TASKS Week 1: glitches and diamonds are
// not caught by eye). Covers SPEC §5 and the parts of §5b the core owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  batch,
  computed,
  ErrorCode,
  flush,
  onDispose,
  signal,
  SheratanError,
  watch,
} from '../src/index.ts';
import { liveSubscriptions, root, watchFrame } from '../src/internal.ts';
import type { Accessor } from '../src/index.ts';

test('signal: read, set, and equal writes do not notify', () => {
  const a = signal(1);
  const seen: number[] = [];

  const stop = watch(() => {
    seen.push(a());
  });

  a.set(2);
  a.set(2);
  assert.equal(a(), 2);
  assert.deepEqual(seen, [1, 2]);
  stop();
});

test('computed: lazy and cached', () => {
  const a = signal(1);
  let runs = 0;

  const b = computed(() => {
    runs++;

    return a() * 2;
  });

  assert.equal(runs, 0, 'not evaluated until read');
  assert.equal(b(), 2);
  assert.equal(b(), 2);
  assert.equal(runs, 1, 'second read uses the cache');

  a.set(5);
  assert.equal(b(), 10);
  assert.equal(runs, 2);
});

test('diamond: the join recomputes once and never sees a partial update', () => {
  const a = signal(1);
  const b = computed(() => a() + 1);
  const c = computed(() => a() * 10);
  let joins = 0;

  const d = computed(() => {
    joins++;

    return `${String(b())}/${String(c())}`;
  });

  const seen: string[] = [];

  const stop = watch(() => {
    seen.push(d());
  });

  a.set(2);
  a.set(3);
  assert.deepEqual(seen, ['2/10', '3/20', '4/30']);
  assert.equal(joins, 3);
  stop();
});

test('glitch-free: a watcher reading a signal and its derivative sees consistent pairs', () => {
  const a = signal(1);
  const double = computed(() => a() * 2);
  const pairs: [number, number][] = [];

  const stop = watch(() => {
    pairs.push([a(), double()]);
  });

  a.set(2);
  a.set(7);

  for (const [value, derived] of pairs) assert.equal(derived, value * 2);

  assert.equal(pairs.length, 3);
  stop();
});

test('computed returning an equal value stops propagation', () => {
  const a = signal(1);
  const parity = computed(() => a() % 2);
  let runs = 0;

  const stop = watch(() => {
    runs++;
    parity();
  });

  a.set(3);
  assert.equal(runs, 1);

  a.set(4);
  assert.equal(runs, 2);
  stop();
});

test('a throwing computed rethrows, then recomputes on the next read', () => {
  const a = signal(0);

  const inverse = computed(() => {
    if (a() === 0) throw new RangeError('zero');

    return 1 / a();
  });

  assert.throws(() => inverse(), RangeError);
  assert.throws(() => inverse(), RangeError, 'still dirty, so it runs again');

  a.set(4);
  assert.equal(inverse(), 0.25);
});

test('a deep chain propagates iteratively: marking 100k nodes does not overflow', () => {
  // The push side is iterative, so dirtiness can cross an arbitrarily deep
  // graph. Evaluation still recurses through the user's own functions, which
  // is inherent to pull-based derivation, so this asserts the push only.
  const depth = 100_000;
  const source = signal(1);
  const chain: Accessor<number>[] = [];
  let node: Accessor<number> = computed(() => source() + 1);

  for (let level = 1; level < depth; level++) {
    const previous = node;

    node = computed(() => previous() + 1);
    chain.push(node);
  }

  // One watcher per link would be 100k watchers; subscribing the tail is
  // enough to make every node in the chain an observed dependency.
  const stop = watchFrame(() => {
    chain[0]?.();
  });

  assert.doesNotThrow(() => {
    source.set(2);
  });

  stop();
});

test('a derivation read lazily re-validates itself: unchanged source, cached value', () => {
  const source = signal(1);
  let parityRuns = 0;
  let labelRuns = 0;

  const parity = computed(() => {
    parityRuns++;

    return source() % 2;
  });

  const label = computed(() => {
    labelRuns++;

    return `parity:${String(parity())}`;
  });

  assert.equal(label(), 'parity:1');
  assert.equal(labelRuns, 1);

  // Nothing observes these, so the write only marks: `label` is pending until
  // it is read, and then settles without recomputing, because parity is equal.
  source.set(3);
  assert.equal(label(), 'parity:1');
  assert.equal(parityRuns, 2, 'parity re-ran to answer the question');
  assert.equal(labelRuns, 1, 'label kept its cached value');

  source.set(2);
  assert.equal(label(), 'parity:0');
  assert.equal(labelRuns, 2);
});

test('re-validation walks past plain signals to the derivation that may have changed', () => {
  const label = signal('label');
  const source = signal(1);
  const parity = computed(() => source() % 2);
  const seen: string[] = [];

  const stop = watch(() => {
    seen.push(`${label()}:${String(parity())}`);
  });

  assert.deepEqual(seen, ['label:1']);

  // The watcher reads a signal first and the derivation second, so settling it
  // has to step over the signal before it reaches the pending derivation.
  source.set(3);
  assert.deepEqual(seen, ['label:1'], 'parity is unchanged, so nothing re-ran');

  source.set(2);
  assert.deepEqual(seen, ['label:1', 'label:0']);
  stop();
});

test('dynamic dependencies: an abandoned branch no longer triggers', () => {
  const flag = signal(true);
  const x = signal('x');
  const y = signal('y');
  let runs = 0;

  const pick = computed(() => {
    runs++;

    return flag() ? x() : y();
  });

  const stop = watch(() => {
    pick();
  });

  flag.set(false);

  const before = runs;

  x.set('x2');
  assert.equal(runs, before, 'x is no longer a dependency');

  y.set('y2');
  assert.equal(runs, before + 1);
  stop();
});

test('re-reading the same sources reuses edges instead of allocating new ones', () => {
  const a = signal(1);
  const b = signal(1);
  const before = liveSubscriptions();

  const stop = watch(() => {
    a();
    b();
    a();
  });

  const afterFirstRun = liveSubscriptions();

  a.set(2);
  a.set(3);
  assert.equal(liveSubscriptions(), afterFirstRun, 'edge count is stable across re-runs');

  stop();
  assert.equal(liveSubscriptions(), before);
});

test('batch: several writes, one watcher run; nested batches commit at the outer end', () => {
  const a = signal(1);
  const b = signal(1);
  const seen: number[] = [];

  const stop = watch(() => {
    seen.push(a() + b());
  });

  batch(() => {
    a.set(2);

    batch(() => {
      b.set(3);
    });

    assert.deepEqual(seen, [2], 'nothing runs inside the batch');
  });

  assert.deepEqual(seen, [2, 5]);
  stop();
});

test('batch returns the callback value', () => {
  assert.equal(
    batch(() => 42),
    42,
  );
});

test('watch: runs immediately; disposer stops it', () => {
  const a = signal(0);
  let runs = 0;

  const stop = watch(() => {
    runs++;
    a();
  });

  assert.equal(runs, 1);

  a.set(1);
  assert.equal(runs, 2);

  stop();
  a.set(2);
  assert.equal(runs, 2);
});

test('a disposer also works with `using`', () => {
  const a = signal(0);
  let runs = 0;

  {
    using stop = watch(() => {
      runs++;
      a();
    });

    assert.equal(typeof stop, 'function');
    a.set(1);
    assert.equal(runs, 2);
  }

  a.set(2);
  assert.equal(runs, 2, 'the block scope ended the subscription');
});

test('a watcher writing a signal settles; a self-feeding one throws', () => {
  const a = signal(1);
  const b = signal(0);

  const stopCopy = watch(() => {
    b.set(a() * 2);
  });

  a.set(4);
  assert.equal(b(), 8);
  stopCopy();

  const n = signal(0);

  assert.throws(
    () =>
      watch(() => {
        n.set(n() + 1);
      }),
    (error: unknown) =>
      error instanceof SheratanError && error.code === ErrorCode.WatchersDidNotSettle,
  );
});

test('ownership: inner watchers are disposed when the outer watcher re-runs', () => {
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;

  const stop = watch(() => {
    outer();

    watch(() => {
      innerRuns++;
      inner();
    });
  });

  outer.set(1); // disposes the first inner watcher, creates a second
  innerRuns = 0;
  inner.set(1);
  assert.equal(innerRuns, 1, 'only the live inner watcher runs');

  stop();
  inner.set(2);
  assert.equal(innerRuns, 1);
});

test('onDispose: runs on disposal, after watchers stop, in reverse registration order', () => {
  const a = signal(0);
  const log: string[] = [];
  const before = liveSubscriptions();

  const dispose = root(() => {
    onDispose(() => {
      log.push('nodes');
    });

    watch(() => {
      a();
    });

    onDispose(() => {
      log.push(`subscription, watcher edges left: ${String(liveSubscriptions() - before)}`);
    });
  });

  dispose();
  assert.deepEqual(log, ['subscription, watcher edges left: 0', 'nodes']);
});

test('onDispose outside an owner throws SHR-R001', () => {
  assert.throws(
    () => {
      onDispose(() => undefined);
    },
    (error: unknown) =>
      error instanceof SheratanError && error.code === ErrorCode.DisposeOutsideOwner,
  );
});

test('onDispose inside a watcher runs before each re-run', () => {
  const a = signal(0);
  const log: number[] = [];

  const stop = watch(() => {
    const value = a();

    onDispose(() => {
      log.push(value);
    });
  });

  a.set(1);
  assert.deepEqual(log, [0]);

  stop();
  assert.deepEqual(log, [0, 1]);
});

test('post-disposal: a watcher queued in a batch does not run once disposed', () => {
  const a = signal(0);
  let runs = 0;

  const stop = watch(() => {
    runs++;
    a();
  });

  batch(() => {
    a.set(1);
    stop();
  });

  assert.equal(runs, 1);
});

test('root: reads inside are untracked by an enclosing watcher', () => {
  const a = signal(0);
  let outerRuns = 0;

  const stop = watch(() => {
    outerRuns++;

    root(() => {
      a();
    });
  });

  a.set(1);
  assert.equal(outerRuns, 1);
  stop();
});

test('leak: 1000 root mount/dispose cycles leave no live subscriptions', () => {
  const before = liveSubscriptions();
  const shared = signal(0);

  for (let cycle = 0; cycle < 1000; cycle++) {
    const dispose = root(() => {
      const local = signal(cycle);
      const sum = computed(() => shared() + local());

      watch(() => {
        sum();
      });

      watchFrame(() => {
        shared();
      });
    });

    dispose();
  }

  flush();
  assert.equal(liveSubscriptions(), before);
});

test('a derivation nobody observes drops its sources', () => {
  const before = liveSubscriptions();
  const a = signal(1);
  const doubled = computed(() => a() * 2);

  const stop = watch(() => {
    doubled();
  });

  assert.ok(liveSubscriptions() > before);

  stop();
  assert.equal(liveSubscriptions(), before, 'the derivation unsubscribed too');
  assert.equal(doubled(), 2, 'and still computes on demand');
});

// Scheduler (SPEC §5): computeds are synchronous, DOM-side watchers are
// coalesced per frame, last value wins.

test('scheduler: frame watchers coalesce writes; computeds stay synchronous', () => {
  const a = signal(0);
  const double = computed(() => a() * 2);
  const written: number[] = [];

  const stop = watchFrame(() => {
    written.push(double());
  });

  assert.deepEqual(written, [0], 'initial run is synchronous (mount)');

  for (let value = 1; value <= 1000; value++) a.set(value);

  assert.equal(double(), 2000, 'propagation is synchronous');
  assert.deepEqual(written, [0], 'no DOM-side run before the frame');

  flush();
  assert.deepEqual(written, [0, 2000], 'one run, last value wins');

  flush();
  assert.deepEqual(written, [0, 2000], 'flush with nothing pending is a no-op');
  stop();
});

test('scheduler: a frame watcher disposed before the frame never runs', () => {
  const a = signal(0);
  let runs = 0;

  const stop = watchFrame(() => {
    runs++;
    a();
  });

  a.set(1);
  stop();
  flush();
  assert.equal(runs, 1);
});

test('scheduler: runs on its own without flush()', async () => {
  const a = signal(0);
  const written: number[] = [];

  const stop = watchFrame(() => {
    written.push(a());
  });

  a.set(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(written, [0, 1]);
  stop();
});

// Immutability (SPEC §5): enforced, not requested.

test('state is frozen: mutating a signal value throws, replacing works', () => {
  const items = signal([{ id: 1, title: 'a' }]);

  assert.throws(() => {
    (items() as { id: number; title: string }[]).push({ id: 2, title: 'b' });
  }, TypeError);

  assert.throws(() => {
    (items()[0] as { title: string }).title = 'changed';
  }, TypeError);

  items.set([...items(), { id: 2, title: 'b' }]);
  assert.equal(items().length, 2);
});

test('freezing skips what it would break, and subtrees it already froze', () => {
  const shared = { id: 1, tags: ['x'] };
  const first = signal([shared]);

  assert.ok(Object.isFrozen(shared.tags));

  const date = new Date();
  const holder = signal({ id: 2, at: date, seen: new Set([1]) });

  assert.equal(Object.isFrozen(date), false, 'a Date would break when frozen');
  assert.equal(Object.isFrozen(holder().seen), false, 'so would a Set');
  assert.equal(first()[0]?.id, 1);
});

test('a cyclic value freezes without looping forever', () => {
  const node: Record<string, unknown> = { id: 1 };

  node['self'] = node;

  const held = signal(node);

  assert.ok(Object.isFrozen(held()));
});
