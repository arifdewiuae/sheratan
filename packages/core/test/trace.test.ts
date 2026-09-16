// The causal trace (SPEC §7). Written before the implementation. The property
// that matters is the link: a DOM patch happens a frame after the write that
// caused it, so the chain has to survive the gap between them.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { freshHost } from './dom.ts';
import { computed, each, flush, html, render, signal } from '../src/index.ts';

/** The dev-build debugging surface (SPEC §7). Not a package export. */
interface Sheratan {
  start(): void;
  stop(): void;
  clear(): void;
  trace(): TraceReport;
  format(): string;
}

interface TraceReport {
  readonly depth: number;
  readonly dropped: number;
  readonly entries: readonly TraceEntry[];
}

interface TraceEntry {
  readonly at: number;
  readonly cause: number;
  readonly kind: 'write' | 'compute' | 'patch';
  readonly source: string;
  readonly from?: string;
  readonly to?: string;
}

const dev = (): Sheratan => (globalThis as unknown as { __sheratan: Sheratan }).__sheratan;

let host: Element;

beforeEach(() => {
  host = freshHost();
});

const kinds = (report: TraceReport): string[] => report.entries.map((entry) => entry.kind);

test('render installs the debugging surface, and it records nothing until asked', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);

  assert.equal(typeof dev().trace, 'function', '__sheratan exists in a dev build');

  dev().clear();
  count.set(1);
  flush();

  assert.deepEqual(dev().trace().entries, [], 'off by default: a flag, not a default');
});

test('a write is recorded with where it came from and what it became', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();
  dev().start();

  count.set(7);

  const written = dev()
    .trace()
    .entries.filter((entry) => entry.kind === 'write');

  assert.equal(written.length, 1);
  assert.equal(written[0]!.from, '0');
  assert.equal(written[0]!.to, '7');
  assert.match(written[0]!.source, /trace\.test\.ts/, 'the write names its own call site');

  dev().stop();
});

test('a write that changes a computed records the recompute under the same cause', () => {
  const count = signal(1);
  const doubled = computed(() => count() * 2);

  render(() => html`<p>${doubled}</p>`, host);
  flush();
  dev().clear();
  dev().start();

  count.set(5);
  flush();

  const report = dev().trace();
  const causes = new Set(report.entries.map((entry) => entry.cause));

  assert.deepEqual(kinds(report), ['write', 'compute', 'patch']);
  assert.equal(causes.size, 1, 'one write, one chain');

  dev().stop();
});

test('a patch is linked to the write that caused it, a frame earlier', () => {
  const first = signal('a');
  const second = signal('x');

  render(
    () =>
      html`<p>${first}</p>
        <i>${second}</i>`,
    host,
  );

  flush();
  dev().clear();
  dev().start();

  first.set('b');
  second.set('y');
  flush();

  const report = dev().trace();
  const patches = report.entries.filter((entry) => entry.kind === 'patch');
  const writes = report.entries.filter((entry) => entry.kind === 'write');

  assert.equal(patches.length, 2);
  assert.equal(writes.length, 2);

  // Both writes land before either patch runs, so a single "current cause"
  // would give both patches the same one. Each has to carry its own.
  assert.notEqual(patches[0]?.cause, patches[1]?.cause);
  assert.equal(patches[0]?.cause, writes[0]?.cause);
  assert.equal(patches[1]?.cause, writes[1]?.cause);

  dev().stop();
});

test('an equal write is not a cause, because nothing follows from it', () => {
  const count = signal(3);

  render(() => html`<p>${count}</p>`, host);
  flush();
  dev().clear();
  dev().start();

  count.set(3);
  flush();

  assert.deepEqual(dev().trace().entries, []);

  dev().stop();
});

test('the buffer keeps the last entries and says how many it dropped', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();
  dev().start();

  for (let index = 1; index <= 400; index++) {
    count.set(index);
    flush();
  }

  const report = dev().trace();

  assert.equal(report.entries.length, report.depth, 'bounded, not growing');
  assert.ok(report.dropped > 0, 'and honest about what it lost');

  const last = report.entries.at(-1);

  assert.equal(last?.kind, 'patch');

  assert.equal(
    report.entries.filter((e) => e.to === '400').length > 0,
    true,
    'the newest survived',
  );

  dev().stop();
});

test('format renders the chain as a tree a person can read', () => {
  const count = signal(1);
  const doubled = computed(() => count() * 2);

  render(() => html`<p>${doubled}</p>`, host);
  flush();
  dev().clear();
  dev().start();

  count.set(2);
  flush();

  const text = dev().format();
  const lines = text.split('\n');

  assert.match(lines[0] ?? '', /^write\(1 → 2\) @ .*trace\.test\.ts/);
  assert.match(lines[1] ?? '', /computed .*recomputed/);
  assert.match(lines[2] ?? '', /patched/);
  assert.ok(lines[1]!.startsWith(' '), 'a consequence is indented under its cause');

  dev().stop();
});

test('a write the runtime makes itself continues the chain it is part of', () => {
  const rows = signal([{ id: 1, name: 'widget' }]);

  render(
    () =>
      html`<ul>
        ${each(rows, (item) => html`<li>${computed(() => item().name)}</li>`)}
      </ul>`,
    host,
  );

  flush();
  dev().clear();
  dev().start();

  rows.set([{ id: 1, name: 'gadget' }]);
  flush();

  const report = dev().trace();
  const writes = report.entries.filter((entry) => entry.kind === 'write');
  const causes = new Set(report.entries.map((entry) => entry.cause));

  // `each` rewrites the row's item signal. That is the list update, not a
  // second one, so it belongs to the chain rather than starting another.
  assert.equal(writes.length, 2);
  assert.equal(causes.size, 1, 'one cause, however many writes it took');
  assert.equal(writes[1]!.source, 'sheratan', 'named as the runtime, not a frame inside it');

  dev().stop();
});

test('a flood is sampled, so the trace cannot make the problem it is watching worse', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();
  dev().start();

  // Past the burst threshold the buffer keeps one write in twenty, and counts
  // the rest. Without this a 20k/sec feed would spend its frame on tracing.
  for (let index = 1; index <= 2000; index++) count.set(index);

  const report = dev().trace();
  const writes = report.entries.filter((entry) => entry.kind === 'write').length;

  assert.ok(writes < 2000, 'not every write was recorded');
  assert.ok(report.dropped > 0, 'and the ones skipped are counted');

  dev().stop();
});

test('the sampling window reopens, so a quiet second records everything again', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();

  mock.timers.enable({ apis: ['Date'] });

  try {
    dev().start();

    for (let index = 1; index <= 1500; index++) count.set(index);

    const sampled = dev()
      .trace()
      .entries.filter((entry) => entry.kind === 'write').length;

    mock.timers.tick(1001);
    count.set(9001);

    const last = dev()
      .trace()
      .entries.findLast((entry) => entry.kind === 'write');

    assert.ok(sampled < 1500, 'the burst was sampled');

    // Counting entries would prove nothing: the buffer is full, so it stays at
    // its depth whatever arrives. What matters is that this write got in, and
    // at 1501 writes into a sampled burst it would not have.
    assert.equal(last?.to, '9001', 'the next second starts fresh');
  } finally {
    dev().stop();
    mock.timers.reset();
  }
});

test('a host that gives no stack still records the write', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();

  // `Error.stack` is not in the language, and a host may hand back no frames
  // at all. The chain is still worth having without a call site on it.
  const limit = Error.stackTraceLimit;

  Error.stackTraceLimit = 0;

  try {
    dev().start();
    count.set(1);

    const [written] = dev().trace().entries;

    assert.equal(written!.kind, 'write');
    assert.equal(written!.source, 'unknown');
    assert.equal(written!.to, '1', 'and the chain is recorded either way');
  } finally {
    dev().stop();
    Error.stackTraceLimit = limit;
  }
});

test('stop leaves what was recorded, and clear empties it', () => {
  const count = signal(0);

  render(() => html`<p>${count}</p>`, host);
  dev().clear();
  dev().start();

  count.set(1);
  flush();
  dev().stop();

  assert.ok(dev().trace().entries.length > 0);

  count.set(2);
  flush();

  const after = dev().trace().entries.length;

  count.set(3);
  flush();

  assert.equal(dev().trace().entries.length, after, 'stopped means stopped');

  dev().clear();

  assert.deepEqual(dev().trace().entries, []);
});
