// Writes in the core (SPEC §6). Written before the implementation: what a
// mutation promises is the order things happen in — the optimistic transition
// before the request, the rollback only when the write did not land, one
// request at a time — and that nothing happens at all after the module that
// made it is gone (SPEC §5b rule 1).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ErrorCode,
  mutation,
  MutationStatus,
  SheratanError,
  type MutationContext,
} from '../src/index.ts';
import { liveSubscriptions, root } from '../src/internal.ts';

const CYCLES = 200;

interface Order {
  id: number;
}

interface Saved {
  version: number;
}

/** One call to `send`, held open until the test decides how it ends. */
interface Call {
  input: Order;
  signal: AbortSignal;
  resolve(value: Saved): void;
  reject(error: unknown): void;
}

/** A request that never settles on its own, so every race is the test's to run. */
function controlled(): {
  send: (context: MutationContext<Order>) => Promise<Saved>;
  calls: Call[];
} {
  const calls: Call[] = [];

  const send = ({ input, signal }: MutationContext<Order>): Promise<Saved> =>
    new Promise<Saved>((resolve, reject) => {
      calls.push({ input, signal, resolve, reject });
    });

  return { send, calls };
}

/** Every transition and callback, in the order the mutation made them. */
function journal(): {
  log: string[];
  optimistic: (input: Order) => void;
  rollback: (input: Order) => void;
  onSuccess: (result: Saved, input: Order) => void;
} {
  const log: string[] = [];

  return {
    log,
    optimistic: (input) => log.push(`optimistic ${String(input.id)}`),
    rollback: (input) => log.push(`rollback ${String(input.id)}`),
    onSuccess: (result, input) =>
      log.push(`success ${String(input.id)} v${String(result.version)}`),
  };
}

/** Lets every pending microtask run, without touching the clock. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

let close: (() => void) | undefined;

/** A mutation needs an owner, the way it has one in `*.effects.ts`. */
function mounted<T>(build: () => T): T {
  let made: T | undefined;

  close = root(() => {
    made = build();
  });

  return made as T;
}

afterEach(() => {
  close?.();
  close = undefined;
});

test('a mutation is idle until it is run', () => {
  const { send, calls } = controlled();

  const save = mounted(() => mutation({ send }));

  assert.equal(save.status(), MutationStatus.Idle);
  assert.equal(save.error(), undefined);
  assert.equal(calls.length, 0);
});

test('a run hands over its input and a signal, and settles done', async () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ send }));

  void save.run({ id: 1 });

  assert.equal(save.status(), MutationStatus.Running);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.input, { id: 1 });
  assert.equal(calls[0]!.signal.aborted, false);

  calls[0]!.resolve({ version: 2 });
  await settled();

  assert.equal(save.status(), MutationStatus.Done);
  assert.equal(save.error(), undefined);
});

test('the optimistic transition runs before the request, and success follows it', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();

  const save = mounted(() =>
    mutation({
      send: (context) => {
        log.push(`request ${String(context.input.id)}`);

        return send(context);
      },
      ...callbacks,
    }),
  );

  void save.run({ id: 1 });
  calls[0]!.resolve({ version: 2 });
  await settled();

  assert.deepEqual(log, ['optimistic 1', 'request 1', 'success 1 v2']);
});

test('a failure rolls back and becomes a value, not a throw', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  const done = save.run({ id: 1 });

  calls[0]!.reject(new Error('conflict'));
  await done;

  assert.deepEqual(log, ['optimistic 1', 'rollback 1']);
  assert.equal(save.status(), MutationStatus.Error);
  assert.equal(save.error()?.message, 'conflict');
});

test('a thrown non-Error is wrapped, so error() is always an Error', async () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ send }));

  const done = save.run({ id: 1 });

  calls[0]!.reject('offline');
  await done;

  assert.ok(save.error() instanceof Error);
  assert.equal(save.error()?.message, 'offline');
});

test('run() resolves when that run settles, and never rejects', async () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ send }));

  const first = save.run({ id: 1 });
  const second = save.run({ id: 2 });

  calls[0]!.reject(new Error('conflict'));
  await first;

  assert.equal(calls.length, 2, 'the next run starts once the first has settled');

  calls[1]!.resolve({ version: 3 });
  await second;

  assert.equal(save.status(), MutationStatus.Done);
});

test('runs are serialized: the second request waits for the first', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  void save.run({ id: 1 });
  void save.run({ id: 2 });

  // Both are optimistic at once — that is what optimistic means — but only one
  // request is on the wire.
  assert.deepEqual(log, ['optimistic 1', 'optimistic 2']);
  assert.equal(calls.length, 1);

  calls[0]!.resolve({ version: 2 });
  await settled();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.input, { id: 2 });
  assert.equal(save.status(), MutationStatus.Running);

  calls[1]!.resolve({ version: 3 });
  await settled();

  assert.deepEqual(log, ['optimistic 1', 'optimistic 2', 'success 1 v2', 'success 2 v3']);
  assert.equal(save.status(), MutationStatus.Done);
});

test('with a key, runs for different keys are in flight at once', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ key: (order) => order.id, send, ...callbacks }));

  void save.run({ id: 1 });
  void save.run({ id: 2 });

  assert.equal(calls.length, 2, 'two different orders do not wait for each other');

  // The second answers first; the first failing afterwards reverts only itself.
  calls[1]!.resolve({ version: 3 });
  await settled();

  assert.equal(save.status(), MutationStatus.Running, 'order 1 is still in flight');

  calls[0]!.reject(new Error('conflict'));
  await settled();

  assert.deepEqual(log, ['optimistic 1', 'optimistic 2', 'success 2 v3', 'rollback 1']);
  assert.equal(save.status(), MutationStatus.Error, 'the last run to settle decides');
});

test('with a key, runs for the same key still wait their turn', async () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ key: (order) => order.id, send }));

  void save.run({ id: 1 });
  void save.run({ id: 1 });
  void save.run({ id: 2 });

  assert.deepEqual(
    calls.map((call) => call.input.id),
    [1, 2],
    'the second save of order 1 waits; order 2 does not',
  );

  calls[0]!.resolve({ version: 2 });
  await settled();

  assert.deepEqual(
    calls.map((call) => call.input.id),
    [1, 2, 1],
  );
});

test('unmounting aborts every key in flight', () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ key: (order) => order.id, send }));

  void save.run({ id: 1 });
  void save.run({ id: 2 });

  close?.();
  close = undefined;

  assert.ok(calls.every((call) => call.signal.aborted));
});

test('a failed run does not stop the queue behind it', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  void save.run({ id: 1 });
  void save.run({ id: 2 });

  calls[0]!.reject(new Error('conflict'));
  await settled();

  // The failure is reported while the next run is still in flight.
  assert.equal(save.status(), MutationStatus.Running);
  assert.equal(save.error()?.message, 'conflict');

  calls[1]!.resolve({ version: 3 });
  await settled();

  assert.deepEqual(log, ['optimistic 1', 'optimistic 2', 'rollback 1', 'success 2 v3']);
});

test('status and error describe the last run to settle', async () => {
  const { send, calls } = controlled();
  const save = mounted(() => mutation({ send }));

  void save.run({ id: 1 });
  calls[0]!.reject(new Error('conflict'));
  await settled();

  assert.equal(save.status(), MutationStatus.Error);

  void save.run({ id: 2 });

  // A new run does not erase the old failure; it is still the latest outcome.
  assert.equal(save.status(), MutationStatus.Running);
  assert.equal(save.error()?.message, 'conflict');

  calls[1]!.resolve({ version: 3 });
  await settled();

  assert.equal(save.status(), MutationStatus.Done);
  assert.equal(save.error(), undefined);
});

test('a request cancelled by its adapter rolls back but is not an error', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  const done = save.run({ id: 1 });

  calls[0]!.reject(abortError());
  await done;

  // The write did not land, so the optimistic change has to go; but
  // cancellation is not failure (SPEC §5b rule 3).
  assert.deepEqual(log, ['optimistic 1', 'rollback 1']);
  assert.equal(save.error(), undefined);
  assert.equal(save.status(), MutationStatus.Idle);
});

test('onSuccess throwing is reported without rolling back a write that landed', async () => {
  const { send, calls } = controlled();
  const { log, rollback } = journal();

  const save = mounted(() =>
    mutation({
      send,
      rollback,
      onSuccess: () => {
        throw new Error('refresh failed');
      },
    }),
  );

  const done = save.run({ id: 1 });

  calls[0]!.resolve({ version: 2 });
  await done;

  assert.deepEqual(log, []);
  assert.equal(save.status(), MutationStatus.Error);
  assert.equal(save.error()?.message, 'refresh failed');
});

test('unmounting aborts the request in flight and drops the queue', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  const first = save.run({ id: 1 });
  const second = save.run({ id: 2 });

  close?.();
  close = undefined;

  assert.equal(calls[0]!.signal.aborted, true);

  // A late answer from an adapter that ignored its signal lands nowhere.
  calls[0]!.resolve({ version: 2 });
  await Promise.all([first, second]);

  assert.equal(calls.length, 1, 'a queued run never starts');
  assert.deepEqual(log, ['optimistic 1', 'optimistic 2']);
  assert.equal(save.status(), MutationStatus.Running, 'a discarded mutation is never written to');
});

test('a late failure after unmount rolls nothing back', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  const done = save.run({ id: 1 });

  close?.();
  close = undefined;

  calls[0]!.reject(new Error('conflict'));
  await done;

  assert.deepEqual(log, ['optimistic 1']);
  assert.equal(save.error(), undefined);
});

test('run() after unmount does nothing, and says so by resolving', async () => {
  const { send, calls } = controlled();
  const { log, ...callbacks } = journal();
  const save = mounted(() => mutation({ send, ...callbacks }));

  close?.();
  close = undefined;

  await save.run({ id: 1 });

  assert.equal(calls.length, 0);
  assert.deepEqual(log, []);
  assert.equal(save.status(), MutationStatus.Idle);
});

test('a mutation outside an owner fails loudly with SHR-R001', () => {
  const { send } = controlled();

  assert.throws(
    () => mutation({ send }),
    (error: unknown) =>
      error instanceof SheratanError && error.code === ErrorCode.DisposeOutsideOwner,
  );
});

test('mount and dispose cycles leak no subscriptions', async () => {
  const { send, calls } = controlled();
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const stop = root(() => {
      void mutation({ send }).run({ id: cycle });
    });

    stop();
  }

  await settled();

  assert.equal(liveSubscriptions(), before);
  assert.ok(calls.every((call) => call.signal.aborted));
});
