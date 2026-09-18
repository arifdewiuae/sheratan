// The two apps in this repo are written in the canonical shape. A finding on
// either is a false positive — or a real violation, which is worse to leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { checkProject } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');

test('examples/hello is clean', () => {
  assert.deepEqual(checkProject({ tsconfig: resolve(REPO, 'examples/hello/tsconfig.json') }), []);
});

test("the Week 0 eval's host app is clean", () => {
  const findings = checkProject({
    tsconfig: resolve(REPO, 'packages/eval/tsconfig.json'),
    root: resolve(REPO, 'packages/eval/hosts'),
  });

  assert.deepEqual(findings, []);
});

test('a project TypeScript cannot open fails loudly, not as a clean result', () => {
  assert.throws(
    () => checkProject({ tsconfig: resolve(REPO, 'no/such/tsconfig.json') }),
    /could not open/,
  );
});
