// The reordering core (SPEC §9 each): rows outside the longest increasing run
// are exactly the rows that must move.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { longestIncreasing } from '../src/lis.ts';

const valuesOf = (sequence: readonly number[]): number[] =>
  longestIncreasing(sequence).map((index) => sequence[index] as number);

test('empty and single sequences', () => {
  assert.deepEqual(longestIncreasing([]), []);
  assert.deepEqual(longestIncreasing([7]), [0]);
});

test('an already increasing sequence keeps every element', () => {
  assert.deepEqual(longestIncreasing([0, 1, 2, 3]), [0, 1, 2, 3]);
});

test('a reversed sequence keeps one element', () => {
  assert.equal(longestIncreasing([3, 2, 1, 0]).length, 1);
});

test('picks a longest run, and the indices point at it', () => {
  const sequence = [2, 5, 1, 8, 3, 9, 4];
  const indices = longestIncreasing(sequence);
  const values = valuesOf(sequence);

  assert.equal(indices.length, 4);

  assert.deepEqual(
    values,
    values.toSorted((left, right) => left - right),
  );

  assert.deepEqual(
    indices,
    indices.toSorted((left, right) => left - right),
  );
});

test('negative entries are new rows and never join the run', () => {
  const sequence = [-1, 0, -1, 1];

  assert.deepEqual(valuesOf(sequence), [0, 1]);
  assert.deepEqual(longestIncreasing([-1, -1]), []);
});

test('moving one element out of a long run costs one move', () => {
  const rotated = [...Array.from({ length: 500 }, (_, index) => index + 1), 0];

  assert.equal(longestIncreasing(rotated).length, 500, '500 stay, 1 moves');
});
