// Written before the implementation (TASKS Week 1: glitches and diamonds are
// not caught by eye). Covers SPEC §5 and the parts of §5b the core owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, watch, batch, onDispose, flush } from '../src/index.js';
import { root, watchFrame, liveSubscriptions } from '../src/internal.js';

test('signal: read, set, and equal writes do not notify', () => {
  const a = signal(1);
  const seen = [];
  const stop = watch(() => seen.push(a()));
  a.set(2);
  a.set(2);
  assert.equal(a(), 2);
  assert.deepEqual(seen, [1, 2]);
  stop();
});

test('computed: lazy and cached', () => {
  const a = signal(1);
  let runs = 0;
  const b = computed(() => (runs++, a() * 2));
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
  let dRuns = 0;
  const d = computed(() => (dRuns++, `${b()}/${c()}`));
  const seen = [];
  const stop = watch(() => seen.push(d()));
  a.set(2);
  a.set(3);
  assert.deepEqual(seen, ['2/10', '3/20', '4/30']);
  assert.equal(dRuns, 3);
  stop();
});

test('glitch-free: a watcher reading a signal and its derivative sees consistent pairs', () => {
  const a = signal(1);
  const double = computed(() => a() * 2);
  const pairs = [];
  const stop = watch(() => pairs.push([a(), double()]));
  a.set(2);
  a.set(7);
  for (const [x, y] of pairs) assert.equal(y, x * 2);
  assert.equal(pairs.length, 3);
  stop();
});

test('computed returning an equal value stops propagation', () => {
  const a = signal(1);
  const parity = computed(() => a() % 2);
  let runs = 0;
  const stop = watch(() => (runs++, parity()));
  a.set(3);
  assert.equal(runs, 1);
  a.set(4);
  assert.equal(runs, 2);
  stop();
});

test('dynamic dependencies: an abandoned branch no longer triggers', () => {
  const flag = signal(true);
  const x = signal('x');
  const y = signal('y');
  let runs = 0;
  const pick = computed(() => (runs++, flag() ? x() : y()));
  const stop = watch(() => pick());
  flag.set(false);
  const before = runs;
  x.set('x2');
  assert.equal(runs, before, 'x is no longer a dependency');
  y.set('y2');
  assert.equal(runs, before + 1);
  stop();
});

test('batch: several writes, one watcher run; nested batches commit at the outer end', () => {
  const a = signal(1);
  const b = signal(1);
  const seen = [];
  const stop = watch(() => seen.push(a() + b()));
  batch(() => {
    a.set(2);
    batch(() => b.set(3));
    assert.deepEqual(seen, [2], 'nothing runs inside the batch');
  });
  assert.deepEqual(seen, [2, 5]);
  stop();
});

test('batch returns the callback value', () => {
  assert.equal(batch(() => 42), 42);
});

test('watch: runs immediately; disposer stops it', () => {
  const a = signal(0);
  let runs = 0;
  const stop = watch(() => (runs++, a()));
  assert.equal(runs, 1);
  stop();
  a.set(1);
  assert.equal(runs, 1);
});

test('a watcher writing a signal settles; a self-feeding one throws', () => {
  const a = signal(1);
  const b = signal(0);
  const stopCopy = watch(() => b.set(a() * 2));
  a.set(4);
  assert.equal(b(), 8);
  stopCopy();

  const n = signal(0);
  assert.throws(() => watch(() => n.set(n() + 1)), /did not settle/);
});

test('ownership: inner watchers are disposed when the outer watcher re-runs', () => {
  const outer = signal(0);
  const inner = signal(0);
  let innerRuns = 0;
  const stop = watch(() => {
    outer();
    watch(() => (innerRuns++, inner()));
  });
  outer.set(1);          // disposes the first inner watcher, creates a second
  innerRuns = 0;
  inner.set(1);
  assert.equal(innerRuns, 1, 'only the live inner watcher runs');
  stop();
  inner.set(2);
  assert.equal(innerRuns, 1);
});

test('onDispose: runs on disposal, after watchers stop, in reverse registration order', () => {
  const a = signal(0);
  const log = [];
  const before = liveSubscriptions();
  const dispose = root(() => {
    onDispose(() => log.push('nodes'));
    watch(() => a());
    onDispose(() => log.push(`subscription, watcher edges left: ${liveSubscriptions() - before}`));
  });
  dispose();
  assert.deepEqual(log, ['subscription, watcher edges left: 0', 'nodes']);
});

test('onDispose outside an owner throws', () => {
  assert.throws(() => onDispose(() => {}), /owner/);
});

test('onDispose inside a watcher runs before each re-run', () => {
  const a = signal(0);
  const log = [];
  const stop = watch(() => {
    const v = a();
    onDispose(() => log.push(v));
  });
  a.set(1);
  assert.deepEqual(log, [0]);
  stop();
  assert.deepEqual(log, [0, 1]);
});

test('post-disposal: a watcher queued in a batch does not run once disposed', () => {
  const a = signal(0);
  let runs = 0;
  const stop = watch(() => (runs++, a()));
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
    root(() => a());
  });
  a.set(1);
  assert.equal(outerRuns, 1);
  stop();
});

test('leak: 1000 root mount/dispose cycles leave no live subscriptions', () => {
  const before = liveSubscriptions();
  const shared = signal(0);
  for (let i = 0; i < 1000; i++) {
    const dispose = root(() => {
      const local = signal(i);
      const sum = computed(() => shared() + local());
      watch(() => sum());
      watchFrame(() => shared());
    });
    dispose();
  }
  flush();
  assert.equal(liveSubscriptions(), before);
});

// Scheduler (SPEC §5): computeds are synchronous, DOM-side watchers are
// coalesced per frame, last value wins.

test('scheduler: frame watchers coalesce writes; computeds stay synchronous', () => {
  const a = signal(0);
  const double = computed(() => a() * 2);
  const written = [];
  const stop = watchFrame(() => written.push(double()));
  assert.deepEqual(written, [0], 'initial run is synchronous (mount)');
  for (let i = 1; i <= 1000; i++) a.set(i);
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
  const stop = watchFrame(() => (runs++, a()));
  a.set(1);
  stop();
  flush();
  assert.equal(runs, 1);
});

test('scheduler: runs on its own without flush()', async () => {
  const a = signal(0);
  const written = [];
  const stop = watchFrame(() => written.push(a()));
  a.set(1);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(written, [0, 1]);
  stop();
});
