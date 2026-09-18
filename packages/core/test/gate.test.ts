// The Week 2 gate (TASKS): "correct and leak-free first — 1000 cycles leave
// zero live subscriptions". Each primitive has its own leak test; this one
// mounts all of them in one module, the way an app does, so a leak that only
// appears when they share an owner has nowhere to hide. Beyond subscriptions
// it checks what a subscription count cannot see: every request aborted,
// every stream torn down, every hand-registered cleanup run, no timer left
// behind, and no node left in the host.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  computed,
  each,
  flush,
  html,
  mutation,
  onDispose,
  render,
  resource,
  signal,
  stream,
  watch,
  type Accessor,
  type Signal,
  type Template,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';
import { freshHost } from './dom.ts';

const CYCLES = 1000;

const ROWS = 50;

const POOL = 8;

const ROW_HEIGHT = 20;

const STALE_AFTER_MS = 1000;

interface Row {
  readonly id: number;
  readonly value: number;
}

/** Everything the module opened, so the test can check each was closed. */
interface Ledger {
  readonly requests: AbortSignal[];
  readonly writes: AbortSignal[];
  subscribed: number;
  tornDown: number;
  cleanups: number;
  fetches: number;
}

/** Lets pending microtasks and the resource's response land. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const rowsOf = (offset: number): Row[] =>
  Array.from({ length: ROWS }, (_, index) => ({ id: index, value: index + offset }));

const valueOf = (row: Accessor<Row>): Accessor<number> => computed(() => row().value);

/** One module with every owner-scoped primitive the runtime has. */
function module(ledger: Ledger, rows: Accessor<readonly Row[]>, start: Accessor<number>): Template {
  const user = resource({
    key: () => ['user', start()] as const,
    fetch: ({ signal: abort }) => {
      ledger.fetches += 1;
      ledger.requests.push(abort);

      return Promise.resolve({ name: 'ada' });
    },
    staleAfter: STALE_AFTER_MS,
  });

  const ticks = stream({
    key: () => ['ticks'] as const,
    initial: 0,
    reduce: (total: number, by: number) => total + by,
    subscribe: ({ emit }) => {
      ledger.subscribed += 1;
      emit(1);

      return () => {
        ledger.tornDown += 1;
      };
    },
  });

  const save = mutation({
    // Never answers, so unmount always finds a write in flight.
    send: ({ signal: abort }) =>
      new Promise<never>(() => {
        ledger.writes.push(abort);
      }),
  });

  void save.run(start());

  const seen = signal(0);

  watch(() => {
    seen.set(ticks() + start());
  });

  onDispose(() => {
    ledger.cleanups += 1;
  });

  const name = computed(() => user.data()?.name ?? '');
  const window = computed(() => ({ start: start() % ROWS, count: POOL, rowHeight: ROW_HEIGHT }));

  return html`<section>
    <h1>${name}</h1>
    <p>${seen}</p>
    <ul>
      ${each(rows, (row) => html`<li>${valueOf(row)}</li>`)}
    </ul>
    <ol>
      ${each(rows, (row) => html`<li>${valueOf(row)}</li>`, window)}
    </ol>
  </section>`;
}

/** What one run of the gate mounts into and writes to. */
interface Rig {
  readonly host: Element;
  readonly rows: Signal<readonly Row[]>;
  readonly start: Signal<number>;
  readonly ledger: Ledger;
  readonly inFlightAtUnmount: AbortSignal[];
}

/**
 * Mount, let the response land, write, unmount — then the next cycle.
 * Recursive rather than a loop: each cycle has to wait for its own response,
 * and a loop that awaits reads as an accident.
 */
async function cycles(rig: Rig, cycle: number): Promise<void> {
  if (cycle === CYCLES) return;

  const { host, rows, start, ledger } = rig;
  const dispose = render(() => module(ledger, rows, start), host);

  // The response lands, which arms the stale timer that unmount must clear.
  await settled();

  const answered = ledger.requests.length;

  // A new key refetches; that request is still in flight when unmount comes.
  rows.set(rowsOf(cycle).toReversed());
  start.set(cycle + 1);
  flush();
  dispose();

  rig.inFlightAtUnmount.push(...ledger.requests.slice(answered));

  return cycles(rig, cycle + 1);
}

test('Week 2 gate: 1000 mounts of every primitive together leave nothing behind', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const ledger: Ledger = {
    requests: [],
    writes: [],
    subscribed: 0,
    tornDown: 0,
    cleanups: 0,
    fetches: 0,
  };

  const rig: Rig = {
    host: freshHost(),
    rows: signal<readonly Row[]>(rowsOf(0)),
    start: signal(0),
    ledger,
    inFlightAtUnmount: [],
  };

  const before = liveSubscriptions();

  await cycles(rig, 0);

  const fetchesAtEnd = ledger.fetches;

  // Every stale timer that was armed must be gone: nothing fetches afterwards.
  mock.timers.tick(STALE_AFTER_MS * 10);
  await settled();

  mock.timers.reset();

  assert.equal(liveSubscriptions(), before, 'no subscription outlives its mount');
  assert.equal(ledger.fetches, fetchesAtEnd, 'no stale timer survived an unmount');

  assert.equal(
    rig.inFlightAtUnmount.length,
    CYCLES,
    'each cycle unmounts with a request in flight',
  );

  assert.ok(
    rig.inFlightAtUnmount.every((request) => request.aborted),
    'every request in flight was aborted',
  );

  assert.equal(ledger.writes.length, CYCLES);

  assert.ok(
    ledger.writes.every((write) => write.aborted),
    'every write in flight was aborted',
  );

  assert.equal(ledger.subscribed, CYCLES);
  assert.equal(ledger.tornDown, CYCLES, 'every stream was torn down');
  assert.equal(ledger.cleanups, CYCLES, 'every onDispose ran');
  assert.equal(rig.host.childNodes.length, 0, 'every node was removed');
});
