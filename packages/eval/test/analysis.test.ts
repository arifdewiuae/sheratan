// The sums the Week 0 gate is decided with, proved for nothing.
//
// The matrix costs money and hours; this file costs a second, and it is where
// the two judgement calls in `analysis.ts` are held to account — censoring at
// the cap, and refusing to read a missing arm as a tie. Both are the kind of
// decision that is invisible in a table and decisive in a verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type ArmResult,
  type Cell,
  quantileOf,
  resultFor,
  spreadOf,
  taskResultOf,
  verdictOf,
} from '../src/analysis.ts';

const PAIR = { subject: 'sheratan', control: 'react' } as const;
const WEEK_0 = ['T01', 'T03', 'T04'];
const ALL_THREE = 3;
const CAP = 10;
const MEDIAN = 0.5;
const FIRST_QUARTILE = 0.25;
const THIRD_QUARTILE = 0.75;
const A_DOLLAR = 1;
const A_SECOND_IN_MS = 1000;

/** One arm's seeds on one task, converged unless they used up the cap. */
function seeds(task: string, arm: string, iterations: readonly number[]): Cell[] {
  return iterations.map((used, index) => ({
    task,
    arm,
    seed: index + 1,
    converged: used < CAP,
    iterations: used,
    costUSD: A_DOLLAR,
    durationMs: A_SECOND_IN_MS,
    tampering: [],
  }));
}

/** The result, insisting there is one, so a test reads without optional chains. */
function resultOf(cells: readonly Cell[], arm: string): ArmResult {
  const found = resultFor(cells, arm);

  assert.ok(found !== undefined, `no scored runs for ${arm}`);

  return found;
}

test('the quartiles of five are the ones R, numpy and Excel report', () => {
  const sorted = [1, 2, 3, 4, 5];

  assert.equal(quantileOf(sorted, MEDIAN), 3);
  assert.equal(quantileOf(sorted, FIRST_QUARTILE), 2);
  assert.equal(quantileOf(sorted, THIRD_QUARTILE), 4);
});

test('an even sample takes the midpoint, and one value is its own spread', () => {
  assert.equal(spreadOf([1, 2, 3, 4]).median, 2.5);
  assert.deepEqual(spreadOf([7]), { median: 7, q1: 7, q3: 7, iqr: 0 });
});

test('a spread of nothing is refused rather than reported as zero', () => {
  assert.throws(() => spreadOf([]), /no values/u);
});

test('a run that reached the cap counts as the cap, and is not silently dropped', () => {
  // Two quick wins and three that never got there. Counting only the wins
  // would report a median of 2; the arm did not do that.
  const result = resultOf(seeds('T01', 'sheratan', [2, 2, CAP, CAP, CAP]), 'sheratan');

  assert.equal(result.scored, 5);
  assert.equal(result.converged, 2);
  assert.equal(result.spread.median, CAP);
});

test('censoring is what decides the verdict, not a presentational choice', () => {
  // The arm on trial converges twice, fast; the control converges every time,
  // slowly. Drop the runs that never converged and the subject wins.
  const cells = [
    ...seeds('T01', 'sheratan', [2, 2, CAP, CAP, CAP]),
    ...seeds('T01', 'react', [4, 4, 4, 5, 5]),
  ];

  assert.equal(taskResultOf('T01', cells, PAIR).noWorse, false);
});

/** The same seeds, with the first one recorded as having reached for evalkit. */
function withOneVoid(cells: readonly Cell[]): Cell[] {
  const [first, ...rest] = cells;

  assert.ok(first !== undefined);

  return [{ ...first, iterations: CAP, converged: false, tampering: ['/__control'] }, ...rest];
}

test('a voided run is set aside and counted, not treated as a slow one', () => {
  const result = resultOf(withOneVoid(seeds('T01', 'sheratan', [2, 3, 3, 4, 4])), 'sheratan');

  assert.equal(result.scored, 4);
  assert.equal(result.voided, 1);
  assert.equal(result.spread.median, 3.5);

  // Money spent on a void run is still money spent.
  assert.equal(result.costUSD, 5);
});

test('an arm with nothing but voided runs has no result at all', () => {
  assert.equal(resultFor(withOneVoid(seeds('T01', 'sheratan', [2])), 'sheratan'), undefined);
});

test('a task missing one arm is not a pass, however well the other did', () => {
  const result = taskResultOf('T01', seeds('T01', 'sheratan', [1, 1, 1, 1, 1]), PAIR);

  assert.equal(result.control, undefined);
  assert.equal(result.noWorse, false);
});

test('an equal median is no worse, because that is what the gate says', () => {
  const cells = [
    ...seeds('T01', 'sheratan', [1, 2, 3, 4, 5]),
    ...seeds('T01', 'react', [3, 3, 3, 3, 3]),
  ];

  assert.equal(taskResultOf('T01', cells, PAIR).noWorse, true);
});

test('the gate needs every Week 0 task, and says which it got', () => {
  const cells = [
    ...seeds('T01', 'sheratan', [2, 2, 2, 2, 2]),
    ...seeds('T01', 'react', [3, 3, 3, 3, 3]),
    ...seeds('T03', 'sheratan', [2, 2, 2, 2, 2]),
    ...seeds('T03', 'react', [3, 3, 3, 3, 3]),
    ...seeds('T04', 'sheratan', [6, 6, 6, 6, 6]),
    ...seeds('T04', 'react', [3, 3, 3, 3, 3]),
  ];

  const verdict = verdictOf(WEEK_0, cells, PAIR, ALL_THREE);

  assert.equal(verdict.noWorse, 2);
  assert.equal(verdict.met, false);

  assert.deepEqual(
    verdict.tasks.map((one) => one.noWorse),
    [true, true, false],
  );
});
