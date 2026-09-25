// The gate that should have existed before `llms.txt` was written.
//
// It runs over every arm this build knows, so a second arm's documentation is
// held to it the day the arm lands rather than the day someone remembers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { ARMS } from '../src/arms/index.ts';
import { describe, givenTo, hooksOf, leaksIn, type Given } from '../src/contamination.ts';
import { readTaskSet, taskNamed } from '../src/frozen.ts';

/** A scaffold's worth of disk, removed however the test ends. */
async function withScaffold<T>(into: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), 'sheratan-contamination-'));

  try {
    return await into(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a task names its DOM hooks, and those are what may not leak', async () => {
  const set = await readTaskSet();

  assert.deepEqual(hooksOf(taskNamed(set, 'T01')).toSorted(), [
    'customer-row',
    'error',
    'loading',
    'retry',
  ]);

  // T10 is a bug report with no markup of its own, so it names none. A task
  // with no hooks must contribute no leaks rather than match everything.
  assert.deepEqual(hooksOf(taskNamed(set, 'T10')), []);
});

test('nothing an arm is handed contains a task hook', async () => {
  const set = await readTaskSet();

  for (const arm of ARMS.values()) {
    // eslint-disable-next-line no-await-in-loop -- one scaffold on disk at a time
    const leaks = await withScaffold(async (root) =>
      leaksIn(await givenTo(arm, root), set.tasks.values()),
    );

    assert.deepEqual(
      leaks,
      [],
      `${arm.label} is handed the answer to a task it is measured on:\n${describe(leaks)}`,
    );
  }
});

test('the gate fires: a hook in a document is found and named', () => {
  const given: readonly Given[] = [
    { what: 'a document', text: 'show <p data-testid="loading">Loading…</p> while it loads' },
    { what: 'a clean one', text: 'show a spinner while it loads' },
  ];

  const task = {
    id: 'T01',
    title: 'Customer list',
    tags: ['parity'],
    prompt: 'show `data-testid="loading"` while loading',
    hidden: [],
  };

  const leaks = leaksIn(given, [task]);

  assert.deepEqual(leaks, [{ task: 'T01', hook: 'loading', what: 'a document' }]);
  assert.match(describe(leaks), /T01 names data-testid="loading" — found in a document/u);
});
