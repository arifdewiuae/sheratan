// The public surface (SPEC A5). This list changing is an API change: update
// llms.txt and the SPEC section in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/index.ts';
import {
  ErrorCode,
  ResourceStatus,
  SheratanError,
  type EachWindow,
  type ResourceOptions,
} from '../src/index.ts';

test('the package exports exactly its documented names', () => {
  assert.deepEqual(Object.keys(api).toSorted(), [
    'ErrorCode',
    'ResourceStatus',
    'SheratanError',
    'batch',
    'computed',
    'each',
    'flush',
    'html',
    'onDispose',
    'render',
    'resource',
    'signal',
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
