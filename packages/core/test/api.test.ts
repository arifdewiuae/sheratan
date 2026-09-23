// The public surface (SPEC A5). This list changing is an API change: update
// llms.txt and the SPEC section in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/index.ts';
import {
  ErrorCode,
  html,
  mount,
  MutationStatus,
  ResourceStatus,
  SheratanError,
  type Accessor,
  type EachWindow,
  type ModuleView,
  type Mounted,
  type MutationOptions,
  type ResourceOptions,
  type StreamOptions,
  StreamStatus,
} from '../src/index.ts';

test('the package exports exactly its documented names', () => {
  assert.deepEqual(Object.keys(api).toSorted(), [
    'ErrorCode',
    'MutationStatus',
    'ResourceStatus',
    'SheratanError',
    'StreamStatus',
    'batch',
    'computed',
    'each',
    'flush',
    'html',
    'mount',
    'mutation',
    'onDispose',
    'render',
    'resource',
    'signal',
    'stream',
    'watch',
  ]);
});

// Types are erased before this file runs, so the list above cannot see them.
// This is the shape a caller writes by hand, and it stops compiling if
// `EachWindow` is dropped, renamed or reshaped.
const viewport: EachWindow = { start: 0, count: 32, rowHeight: 28 };

test('the window type is exported in the shape callers write', () => {
  assert.deepEqual(Object.keys(viewport).toSorted(), ['count', 'rowHeight', 'start']);
});

// The same check for async: this is what an effects file writes, and it stops
// compiling if `ResourceOptions` loses a field or changes what `fetch` is given.
const options: ResourceOptions<{ name: string }, readonly [string, number]> = {
  key: () => ['user', 1],
  fetch: async ({ key, signal }) => {
    signal.throwIfAborted();

    return { name: `user ${String(key[1])}` };
  },
  staleAfter: 30_000,
  retry: { attempts: 3, backoff: 'exponential' },
};

test('the resource options type is exported in the shape callers write', () => {
  assert.deepEqual(Object.keys(options).toSorted(), ['fetch', 'key', 'retry', 'staleAfter']);

  assert.deepEqual(Object.values(ResourceStatus).toSorted(), [
    'error',
    'idle',
    'loading',
    'ready',
    'refreshing',
  ]);
});

// And for writes: what an effects file hands `mutation()`, every hook included.
const save: MutationOptions<{ id: number }, { version: number }> = {
  key: (input) => input.id,
  send: async ({ input, signal }) => {
    signal.throwIfAborted();

    return { version: input.id };
  },
  optimistic: () => undefined,
  rollback: () => undefined,
  onSuccess: () => undefined,
};

test('the mutation options type is exported in the shape callers write', () => {
  assert.deepEqual(Object.keys(save).toSorted(), [
    'key',
    'onSuccess',
    'optimistic',
    'rollback',
    'send',
  ]);

  assert.deepEqual(Object.values(MutationStatus).toSorted(), ['done', 'error', 'idle', 'running']);
});

// And for push data: the shape an effects file writes, with the reducer the
// type admits exactly one of.
const feed: StreamOptions<number, { readonly by: number }, readonly [string, number]> = {
  key: () => ['ticks', 1],
  initial: 0,
  reduce: (total, tick) => total + tick.by,
  subscribe: ({ emit, signal }) => {
    signal.throwIfAborted();
    emit({ by: 1 });

    return () => {};
  },
};

test('the stream options type is exported in the shape callers write', () => {
  assert.deepEqual(Object.keys(feed).toSorted(), ['initial', 'key', 'reduce', 'subscribe']);

  assert.deepEqual(Object.values(StreamStatus).toSorted(), ['closed', 'connecting', 'open']);
});

// And composition: what a parent writes to render a child module. It stops
// compiling if `ModuleView` loses its props or `mount` stops passing them.
const ordersTable: ModuleView<{ customerId: Accessor<string> }> = (props) =>
  html`<table data-for=${props.customerId}></table>`;

test('a module view is exported in the shape a parent writes', () => {
  const placed: Mounted = mount(ordersTable, { customerId: () => 'c1' });

  assert.equal(typeof placed, 'object');
  assert.equal(typeof mount(() => html`<p></p>`), 'object');
});

test('every runtime error code is distinct and shaped SHR-Rnnn', () => {
  const codes = Object.values(ErrorCode);

  assert.equal(new Set(codes).size, codes.length);

  for (const code of codes) assert.match(code, /^SHR-R\d{3}$/);
});

test('a runtime error names its code in the message', () => {
  const error = new SheratanError(ErrorCode.EachDuplicateKey, 'why');

  assert.equal(error.name, 'SheratanError');
  assert.equal(error.code, ErrorCode.EachDuplicateKey);
  assert.match(error.message, /^SHR-R007: why$/);
});
