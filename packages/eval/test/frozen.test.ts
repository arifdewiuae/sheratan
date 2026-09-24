// The freeze, enforced. These exist because the whole-file digest recorded in
// TASKS stopped matching and nothing noticed for a week — a number published
// against a task set nobody can prove is the original is not evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readTaskSet, taskNamed, WEEK_ZERO, MEASURED_DIGEST } from '../src/frozen.ts';

const TWELVE = 12;

test('the measured surface still hashes to the frozen digest', async () => {
  const set = await readTaskSet();

  assert.equal(set.digest, MEASURED_DIGEST);
  assert.equal(set.version, 'eval-tasks-v1');
});

test('all twelve tasks are there, with their prompts', async () => {
  const set = await readTaskSet();

  assert.equal(set.tasks.size, TWELVE);

  for (const task of set.tasks.values()) {
    assert.ok(task.prompt.length > 0, `${task.id} has no prompt`);
    assert.ok(task.title.length > 0, `${task.id} has no title`);
    assert.ok(task.tags.length > 0, `${task.id} has no tags`);
  }
});

test('the Week 0 trio reads the way the document writes it', async () => {
  const set = await readTaskSet();

  for (const id of WEEK_ZERO) {
    const task = taskNamed(set, id);

    assert.ok(task.tags.includes('parity'), `${id} is meant to be a parity task`);
    assert.ok(task.hidden.length > 0, `${id} names no hidden tests`);
  }

  const first = taskNamed(set, 'T01');

  assert.match(first.prompt, /^Build a Customers page at the app root\./u);
  assert.match(first.prompt, /data-testid="customer-row"/u);
  assert.ok(!first.prompt.includes('Hidden tests'), 'the prompt stops before the hidden tests');
});

test('a task that is not in the set is named, not guessed at', async () => {
  const set = await readTaskSet();

  assert.throws(() => taskNamed(set, 'T99'), /No task `T99`.*T01/su);
});
