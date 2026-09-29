// `scope()`: an owner for a test, with no DOM. It exists because the only
// other way to get one was to render an empty template into happy-dom, which
// every effects test — the `create` template's included — did, and every agent
// copied. Everything here is through the public API.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ErrorCode,
  flush,
  onDispose,
  resource,
  scope,
  SheratanError,
  signal,
  watch,
} from '../src/index.ts';

const isDisposeOutsideOwner = (error: unknown): boolean =>
  error instanceof SheratanError && error.code === ErrorCode.DisposeOutsideOwner;

test('it returns what the function returned', () => {
  const { value, dispose } = scope(() => 42);

  assert.equal(value, 42);

  dispose();
});

test('onDispose works inside it, and runs in reverse on dispose, once', () => {
  const ran: string[] = [];

  const { dispose } = scope(() => {
    onDispose(() => ran.push('first'));
    onDispose(() => ran.push('second'));
  });

  assert.deepEqual(ran, []);

  dispose();
  dispose();

  assert.deepEqual(ran, ['second', 'first']);
});

test('a resource started in it is aborted by dispose, as an unmount would', () => {
  const signals: AbortSignal[] = [];

  const { dispose } = scope(() =>
    resource({
      key: () => ['one'],
      fetch: ({ signal: abort }) => {
        signals.push(abort);

        return new Promise<number>(() => undefined);
      },
    }),
  );

  const [request, ...more] = signals;

  assert.equal(more.length, 0);
  assert.ok(request !== undefined);
  assert.equal(request.aborted, false);

  dispose();

  assert.equal(request.aborted, true);
});

test('it is detached: ending the scope around it does not end it', () => {
  const ran: string[] = [];

  const outer = scope(() => {
    scope(() => {
      onDispose(() => ran.push('inner'));
    });
  });

  outer.dispose();

  assert.deepEqual(ran, []);
});

test('reading a signal in it does not subscribe the watcher it was called from', () => {
  const count = signal(0);
  let runs = 0;

  const stop = watch(() => {
    runs += 1;
    scope(() => count());
  });

  count.set(1);
  flush();

  assert.equal(runs, 1);

  stop();
});

test('a function that throws leaves no scope active behind it', () => {
  assert.throws(() =>
    scope(() => {
      throw new Error('boom');
    }),
  );

  assert.throws(() => onDispose(() => undefined), isDisposeOutsideOwner);
});
