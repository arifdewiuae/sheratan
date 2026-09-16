// Subscriptions in the core (SPEC §6). Written before the implementation. The
// contract that matters is the fold: `reduce` runs once per message and the
// value is committed once per frame, so a thousand messages a second cost a
// thousand O(1) folds and one DOM write, not a thousand of each.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { flush, signal, stream, StreamStatus, watch, type Stream } from '../src/index.ts';
import { liveSubscriptions, root } from '../src/internal.ts';

const CYCLES = 200;

type Key = readonly [string, number];

interface Tick {
  readonly by: number;
}

const keyOf = (id: number): Key => ['ticks', id];

/** A fake transport: the test decides when it emits and when it breaks. */
interface Socket {
  emit(this: void, tick: Tick): void;
  close(this: void, error?: unknown): void;
  keys: Key[];
  torn: number;
  live: boolean;
}

let close: (() => void) | undefined;

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

const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test('a stream subscribes on creation and folds messages into its value', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ key, emit }) => {
        socket.keys.push(key);
        socket.emit = emit;
        socket.live = true;

        return () => {
          socket.torn += 1;
          socket.live = false;
        };
      },
    }),
  );

  assert.deepEqual(socket.keys, [['ticks', 1]]);
  assert.equal(total(), 0, 'the initial value is there before any message');
  assert.equal(total.status(), StreamStatus.Open);

  socket.emit({ by: 3 });
  socket.emit({ by: 4 });

  assert.equal(total(), 0, 'nothing is committed until the frame');

  flush();

  assert.equal(total(), 7, 'and then once, folded');
});

test('a frame of messages is one commit, however many arrive', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  let folds = 0;
  let commits = 0;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => {
        folds += 1;

        return previous + tick.by;
      },
      subscribe: ({ emit }) => {
        socket.emit = emit;

        return () => {};
      },
    }),
  );

  mounted(() => {
    watch(() => {
      total();
      commits += 1;
    });
  });

  const seen = commits;

  for (let index = 0; index < 1000; index++) socket.emit({ by: 1 });

  flush();

  assert.equal(folds, 1000, 'reduce runs once per message: it is the O(1) contract');
  assert.equal(commits - seen, 1, 'and the value is written once');
  assert.equal(total(), 1000);
});

test('reduceMany receives the whole frame, and only when one arrived', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const batches: number[] = [];

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduceMany: (previous: number, ticks: readonly Tick[]) => {
        batches.push(ticks.length);

        return previous + ticks.reduce((sum, tick) => sum + tick.by, 0);
      },
      subscribe: ({ emit }) => {
        socket.emit = emit;

        return () => {};
      },
    }),
  );

  socket.emit({ by: 1 });
  socket.emit({ by: 2 });
  flush();

  assert.deepEqual(batches, [2], 'one call, both messages');
  assert.equal(total(), 3);

  socket.emit({ by: 5 });
  flush();

  assert.deepEqual(batches, [2, 1]);
  assert.equal(total(), 8);

  flush();

  assert.deepEqual(batches, [2, 1], 'a frame with no messages folds nothing');
});

test('a new key tears the subscription down, resubscribes, and starts over', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const id = signal(1);

  const total = mounted(() =>
    stream({
      key: (): Key => keyOf(id()),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ key, emit }) => {
        socket.keys.push(key);
        socket.emit = emit;

        return () => {
          socket.torn += 1;
        };
      },
    }),
  );

  socket.emit({ by: 7 });
  flush();

  assert.equal(total(), 7);

  id.set(2);

  assert.equal(socket.torn, 1, 'the old subscription is torn down');

  assert.deepEqual(socket.keys, [
    ['ticks', 1],
    ['ticks', 2],
  ]);

  assert.equal(total(), 0, 'a different key is a different fold');
});

test('a key that re-evaluates to the same values keeps its subscription', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const version = signal(0);

  const key = (): Key => {
    version();

    return keyOf(1);
  };

  mounted(() =>
    stream({
      key,
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ key: seen }) => {
        socket.keys.push(seen);

        return () => {
          socket.torn += 1;
        };
      },
    }),
  );

  version.set(1);
  version.set(2);

  assert.equal(socket.keys.length, 1);
  assert.equal(socket.torn, 0);
});

test('a message from a torn-down subscription reaches nothing', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const id = signal(1);

  const total = mounted(() =>
    stream({
      key: (): Key => keyOf(id()),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ emit }) => {
        socket.emit = emit;

        return () => {};
      },
    }),
  );

  const stale = socket.emit;

  id.set(2);
  stale({ by: 99 });
  flush();

  assert.equal(total(), 0, 'an adapter that keeps emitting cannot corrupt the new key');
});

test('messages held for the frame are dropped when the key changes first', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const id = signal(1);
  const batches: number[] = [];

  const total = mounted(() =>
    stream({
      key: (): Key => keyOf(id()),
      initial: 0,
      reduceMany: (previous: number, ticks: readonly Tick[]) => {
        batches.push(ticks.length);

        return previous + ticks.reduce((sum, tick) => sum + tick.by, 0);
      },
      subscribe: ({ emit }) => {
        socket.emit = emit;

        return () => {};
      },
    }),
  );

  socket.emit({ by: 5 });
  id.set(2);
  flush();

  assert.equal(total(), 0, 'they belonged to the key that went away');
  assert.deepEqual(batches, []);
});

test('the owner disposing runs the teardown the adapter returned', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;

  mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: () => () => {
        socket.torn += 1;
      },
    }),
  );

  assert.equal(socket.torn, 0);

  close?.();
  close = undefined;

  assert.equal(socket.torn, 1);
});

test('an adapter that closes says so, and the value it had stays readable', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ emit, close: closed }) => {
        socket.emit = emit;
        socket.close = closed;

        return () => {};
      },
    }),
  );

  socket.emit({ by: 4 });
  flush();

  socket.close(new Error('socket hung up'));

  assert.equal(total.status(), StreamStatus.Closed);
  assert.equal(total.error()?.message, 'socket hung up');
  assert.equal(total(), 4, 'a view can show the last value and say it is stale');
});

test('closing without a reason is not an error', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ close: closed }) => {
        socket.close = closed;

        return () => {};
      },
    }),
  );

  socket.close();

  assert.equal(total.status(), StreamStatus.Closed);
  assert.equal(total.error(), undefined);
});

test('a subscribe that throws is a closed stream, not a thrown error', () => {
  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: () => {
        throw new Error('no route to host');
      },
    }),
  );

  assert.equal(total.status(), StreamStatus.Closed);
  assert.equal(total.error()?.message, 'no route to host');
  assert.equal(total(), 0);
});

test('a subscription that takes a moment to open reports connecting', async () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  let open: ((teardown: () => void) => void) | undefined;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: async ({ emit }) => {
        socket.emit = emit;

        return new Promise<() => void>((resolve) => {
          open = resolve;
        });
      },
    }),
  );

  assert.equal(total.status(), StreamStatus.Connecting);

  socket.emit({ by: 2 });
  flush();

  assert.equal(total(), 2, 'a message before the handshake finishes still counts');

  open?.(() => {
    socket.torn += 1;
  });

  await settled();

  assert.equal(total.status(), StreamStatus.Open);
});

test('a subscription that fails to open reports closed', async () => {
  let fail: ((error: Error) => void) | undefined;

  const total = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: async () =>
        new Promise<() => void>((_resolve, reject) => {
          fail = reject;
        }),
    }),
  );

  fail?.(new Error('handshake refused'));
  await settled();

  assert.equal(total.status(), StreamStatus.Closed);
  assert.equal(total.error()?.message, 'handshake refused');
});

test('a subscription that opens after its key changed is torn down at once', async () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const id = signal(1);
  let open: ((teardown: () => void) => void) | undefined;

  mounted(() =>
    stream({
      key: (): Key => keyOf(id()),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: async ({ key }) => {
        socket.keys.push(key);

        return new Promise<() => void>((resolve) => {
          open = resolve;
        });
      },
    }),
  );

  const first = open;

  id.set(2);

  first?.(() => {
    socket.torn += 1;
  });

  await settled();

  assert.equal(socket.torn, 1, 'nobody wants it, so it is closed as soon as it exists');
});

test('a close from a torn-down subscription reaches nothing', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;
  const id = signal(1);

  const total = mounted(() =>
    stream({
      key: (): Key => keyOf(id()),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ close: closed }) => {
        socket.close = closed;

        return () => {};
      },
    }),
  );

  const stale = socket.close;

  id.set(2);
  stale(new Error('the old socket hung up'));

  assert.equal(total.status(), StreamStatus.Open, 'the new subscription is fine');
  assert.equal(total.error(), undefined);
});

test('mount and dispose cycles leak no subscriptions', () => {
  const id = signal(1);
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const stop = root(() => {
      stream({
        key: (): Key => keyOf(id()),
        initial: 0,
        reduce: (previous: number, tick: Tick) => previous + tick.by,
        subscribe: () => () => {},
      });
    });

    stop();
  }

  assert.equal(liveSubscriptions(), before);
});

test('a stream reads like any other value', () => {
  const socket = { keys: [], torn: 0, live: false } as unknown as Socket;

  const total: Stream<number> = mounted(() =>
    stream({
      key: () => keyOf(1),
      initial: 0,
      reduce: (previous: number, tick: Tick) => previous + tick.by,
      subscribe: ({ emit }) => {
        socket.emit = emit;

        return () => {};
      },
    }),
  );

  const doubled = (): number => total() * 2;

  socket.emit({ by: 21 });
  flush();

  assert.equal(doubled(), 42);
});
