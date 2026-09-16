// Async in the core (SPEC §6). Written before the implementation: these are
// the guarantees the primitive exists to make — abort on key change, identical
// keys deduplicated, out-of-order responses discarded, and cancellation that
// never looks like failure (SPEC §5b rule 3).
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  resource,
  ResourceStatus,
  signal,
  type FetchContext,
  type Resource,
} from '../src/index.ts';
import { liveSubscriptions, root } from '../src/internal.ts';

/** Mirrors `RETRY_BASE_MS` in the runtime; a retry waits this long first. */
const RETRY_BASE_MS = 100;

const CYCLES = 200;

type Key = readonly [string, number];

interface User {
  name: string;
}

const keyOf = (id: number): Key => ['user', id];

const user = (name: string): User => ({ name });

/** One call to the fetcher, held open until the test decides how it ends. */
interface Call {
  key: Key;
  signal: AbortSignal;
  resolve(value: User): void;
  reject(error: unknown): void;
}

/** A fetcher that never settles on its own, so every race is the test's to run. */
function controlled(): { fetch: (context: FetchContext<Key>) => Promise<User>; calls: Call[] } {
  const calls: Call[] = [];

  const fetch = ({ key, signal: abort }: FetchContext<Key>): Promise<User> =>
    new Promise<User>((resolve, reject) => {
      calls.push({ key, signal: abort, resolve, reject });
    });

  return { fetch, calls };
}

/** Lets every pending microtask run, without touching the clock. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

let close: (() => void) | undefined;

/** A resource needs an owner, the way it has one in `*.effects.ts`. */
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
  mock.timers.reset();
});

test('a resource fetches on creation and hands over the value', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  assert.equal(found.status(), ResourceStatus.Loading);
  assert.equal(found.data(), undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.key, ['user', 1]);

  calls[0]!.resolve(user('ada'));
  await settled();

  assert.equal(found.status(), ResourceStatus.Ready);
  assert.deepEqual(found.data(), { name: 'ada' });
  assert.equal(found.error(), undefined);
});

test('an error is a value, not a throw', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.reject(new Error('no route to host'));
  await settled();

  assert.equal(found.status(), ResourceStatus.Error);
  assert.equal(found.error()?.message, 'no route to host');
  assert.equal(found.data(), undefined);
});

test('a thrown non-Error still arrives as an Error', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.reject('offline');
  await settled();

  assert.ok(found.error() instanceof Error);
  assert.equal(found.error()?.message, 'offline');
});

test('a new key aborts the request in flight and starts over', async () => {
  const { fetch, calls } = controlled();
  const id = signal(1);
  const found = mounted(() => resource({ key: (): Key => keyOf(id()), fetch }));

  calls[0]!.resolve(user('ada'));
  await settled();

  assert.deepEqual(found.data(), { name: 'ada' });

  id.set(2);

  assert.equal(calls.length, 2, 'the key changed, so the request did too');
  assert.deepEqual(calls[1]!.key, ['user', 2]);
  assert.equal(found.status(), ResourceStatus.Loading);
  assert.equal(found.data(), undefined, 'the old value answered a different question');

  calls[1]!.resolve(user('grace'));
  await settled();

  assert.deepEqual(found.data(), { name: 'grace' });
});

test('a key change aborts the request it replaced', () => {
  const { fetch, calls } = controlled();
  const id = signal(1);

  mounted(() => resource({ key: (): Key => keyOf(id()), fetch }));

  assert.equal(calls[0]!.signal.aborted, false);

  id.set(2);

  assert.equal(calls[0]!.signal.aborted, true);
});

test('a key that re-evaluates to the same values does not refetch', () => {
  const { fetch, calls } = controlled();
  const version = signal(0);

  const key = (): Key => {
    version();

    return keyOf(1);
  };

  mounted(() => resource({ key, fetch }));

  version.set(1);
  version.set(2);

  assert.equal(calls.length, 1, 'the same key is the same request');
});

test('a key with a different length is a different key', () => {
  let started = 0;
  const narrowed = signal(true);

  const key = (): readonly unknown[] => (narrowed() ? ['user', 1] : ['user']);

  const pending = (): Promise<User> => {
    started += 1;

    return new Promise<User>(() => {
      // Never settles: this test is only about which keys start a request.
    });
  };

  mounted(() => resource({ key, fetch: pending }));

  assert.equal(started, 1);

  narrowed.set(false);

  assert.equal(started, 2, 'a shorter key is not the same key');
});

test('a superseded response is discarded, even from a fetch that ignored its signal', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.resolve(user('first'));
  await settled();

  found.invalidate();

  assert.equal(calls.length, 2);

  found.abort();
  found.invalidate();

  assert.equal(calls.length, 3);

  // The second call was aborted but resolves anyway, as a fetcher that drops
  // its signal would. It is two generations behind, so nothing of it lands.
  calls[1]!.resolve(user('stale'));
  await settled();

  assert.deepEqual(found.data(), { name: 'first' });

  calls[2]!.resolve(user('latest'));
  await settled();

  assert.deepEqual(found.data(), { name: 'latest' });
});

test('a superseded failure is discarded too', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.resolve(user('ada'));
  await settled();

  found.invalidate();
  found.abort();
  found.invalidate();

  calls[1]!.reject(new Error('too late'));
  await settled();

  assert.equal(found.error(), undefined);
  assert.equal(found.status(), ResourceStatus.Refreshing);
});

test("a fetch's own AbortError never becomes error()", async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));
  const aborted = new Error('cancelled upstream');

  aborted.name = 'AbortError';

  calls[0]!.reject(aborted);
  await settled();

  assert.equal(found.error(), undefined);
  assert.equal(found.status(), ResourceStatus.Loading);
});

test('disposing the owner aborts the request at the network level', async () => {
  const { fetch, calls } = controlled();

  mounted(() => resource({ key: () => keyOf(1), fetch }));

  assert.equal(calls[0]!.signal.aborted, false);

  close?.();
  close = undefined;

  assert.equal(calls[0]!.signal.aborted, true);
});

test('invalidate() revalidates and keeps the previous value on screen', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.resolve(user('ada'));
  await settled();

  found.invalidate();

  assert.equal(found.status(), ResourceStatus.Refreshing);
  assert.deepEqual(found.data(), { name: 'ada' }, 'the old value stays readable');

  calls[1]!.resolve(user('grace'));
  await settled();

  assert.equal(found.status(), ResourceStatus.Ready);
  assert.deepEqual(found.data(), { name: 'grace' });
});

test('invalidate() while a request is in flight is deduplicated', () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  found.invalidate();
  found.invalidate();
  found.invalidate();

  assert.equal(calls.length, 1, 'a burst of invalidations is one fetch');
});

test('abort() leaves a resource with no value idle, and one with a value ready', async () => {
  const { fetch, calls } = controlled();

  const found = mounted(() => resource({ key: () => keyOf(1), fetch }));

  found.abort();

  assert.equal(found.status(), ResourceStatus.Idle);
  assert.equal(calls[0]!.signal.aborted, true);
  assert.equal(found.error(), undefined);

  found.abort();

  assert.equal(found.status(), ResourceStatus.Idle, 'aborting twice is not an error');

  found.invalidate();
  calls[1]!.resolve(user('ada'));
  await settled();

  found.invalidate();
  found.abort();

  assert.equal(found.status(), ResourceStatus.Ready);
  assert.deepEqual(found.data(), { name: 'ada' });
});

test('is() reads the status and nothing else', async () => {
  const { fetch, calls } = controlled();
  const found: Resource<User> = mounted(() => resource({ key: () => keyOf(1), fetch }));

  assert.equal(found.is(ResourceStatus.Loading), true);
  assert.equal(found.is(ResourceStatus.Ready), false);
  assert.equal(found.is(ResourceStatus.Idle), false);

  calls[0]!.resolve(user('ada'));
  await settled();

  assert.equal(found.is(ResourceStatus.Ready), true);
  assert.equal(found.is(ResourceStatus.Loading), false);
});

test('is("ready") narrows data() to the value', async () => {
  const { fetch, calls } = controlled();
  const found: Resource<User> = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.resolve(user('ada'));
  await settled();

  // The point of the guard is the type, and types are erased before this runs:
  // the annotation below stops compiling if `is()` stops narrowing `data()`.
  if (found.is(ResourceStatus.Ready)) {
    const name: string = found.data().name;

    assert.equal(name, 'ada');
  } else {
    assert.fail('the value arrived, so the resource is ready');
  }
});

test('is("error") narrows error() to the failure', async () => {
  const { fetch, calls } = controlled();
  const found: Resource<User> = mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.reject(new Error('gone'));
  await settled();

  if (found.is(ResourceStatus.Error)) {
    const message: string = found.error().message;

    assert.equal(message, 'gone');
  } else {
    assert.fail('the request failed, so the resource is in error');
  }
});

test('retry backs off exponentially and gives up after the last attempt', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  const found = mounted(() =>
    resource({ key: () => keyOf(1), fetch, retry: { attempts: 3, backoff: 'exponential' } }),
  );

  calls[0]!.reject(new Error('flaky'));
  await settled();

  assert.equal(calls.length, 1, 'the first retry waits');

  mock.timers.tick(RETRY_BASE_MS);
  await settled();

  assert.equal(calls.length, 2);

  calls[1]!.reject(new Error('flaky'));
  await settled();
  mock.timers.tick(RETRY_BASE_MS);
  await settled();

  assert.equal(calls.length, 2, 'the second wait is twice as long');

  mock.timers.tick(RETRY_BASE_MS);
  await settled();

  assert.equal(calls.length, 3);

  calls[2]!.reject(new Error('flaky'));
  await settled();
  mock.timers.tick(RETRY_BASE_MS * 4);
  await settled();

  assert.equal(calls.length, 3, 'three attempts means three');
  assert.equal(found.status(), ResourceStatus.Error);
  assert.equal(found.error()?.message, 'flaky');
});

test('fixed backoff waits the same time every attempt', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  mounted(() => resource({ key: () => keyOf(1), fetch, retry: { attempts: 3, backoff: 'fixed' } }));

  calls[0]!.reject(new Error('flaky'));
  await settled();
  mock.timers.tick(RETRY_BASE_MS);
  await settled();

  assert.equal(calls.length, 2);

  calls[1]!.reject(new Error('flaky'));
  await settled();
  mock.timers.tick(RETRY_BASE_MS);
  await settled();

  assert.equal(calls.length, 3, 'the wait did not grow');
});

test('a retry waiting out its backoff stops when the resource is aborted', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  const found = mounted(() =>
    resource({ key: () => keyOf(1), fetch, retry: { attempts: 3, backoff: 'fixed' } }),
  );

  calls[0]!.reject(new Error('flaky'));
  await settled();

  found.abort();
  mock.timers.tick(RETRY_BASE_MS * 4);
  await settled();

  assert.equal(calls.length, 1, 'an aborted resource does not try again');
  assert.equal(found.status(), ResourceStatus.Idle);
  assert.equal(found.error(), undefined);
});

test('a request that fails after the resource was aborted does not retry', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  const found = mounted(() =>
    resource({ key: () => keyOf(1), fetch, retry: { attempts: 3, backoff: 'fixed' } }),
  );

  found.abort();
  calls[0]!.reject(new Error('flaky'));
  await settled();

  mock.timers.tick(RETRY_BASE_MS * 4);
  await settled();

  assert.equal(calls.length, 1, 'there is nothing left to retry for');
  assert.equal(found.error(), undefined);
});

test('staleAfter revalidates in the background without clearing the value', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  const found = mounted(() =>
    resource({ key: () => keyOf(1), fetch, staleAfter: RETRY_BASE_MS * 10 }),
  );

  calls[0]!.resolve(user('ada'));
  await settled();

  assert.equal(found.status(), ResourceStatus.Ready);

  mock.timers.tick(RETRY_BASE_MS * 10);
  await settled();

  assert.equal(calls.length, 2, 'stale data revalidates itself');
  assert.equal(found.status(), ResourceStatus.Refreshing);
  assert.deepEqual(found.data(), { name: 'ada' }, 'and the page keeps showing what it had');

  calls[1]!.resolve(user('grace'));
  await settled();

  assert.equal(found.status(), ResourceStatus.Ready);

  mock.timers.tick(RETRY_BASE_MS * 10);
  await settled();

  assert.equal(calls.length, 3, 'the value that replaced it goes stale on its own clock');
});

test('a disposed resource stops going stale', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  mounted(() => resource({ key: () => keyOf(1), fetch, staleAfter: RETRY_BASE_MS * 10 }));

  calls[0]!.resolve(user('ada'));
  await settled();

  close?.();
  close = undefined;

  mock.timers.tick(RETRY_BASE_MS * 100);
  await settled();

  assert.equal(calls.length, 1, 'an unmounted module makes no requests');
});

test('without staleAfter a key is fetched once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  const { fetch, calls } = controlled();

  mounted(() => resource({ key: () => keyOf(1), fetch }));

  calls[0]!.resolve(user('ada'));
  await settled();

  mock.timers.tick(RETRY_BASE_MS * 1000);
  await settled();

  assert.equal(calls.length, 1);
});

test('mount and dispose cycles leak no subscriptions', () => {
  const { fetch } = controlled();
  const id = signal(1);
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const stop = root(() => {
      resource({ key: (): Key => keyOf(id()), fetch });
    });

    stop();
  }

  assert.equal(liveSubscriptions(), before);
});
