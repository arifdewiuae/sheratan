// The arithmetic behind the bar. A wrong bar costs nothing, but a time-left
// estimate that invents a number before the first cell, or counts a cell read
// back from disk as instant, is a reason to stop a run that was fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Phase, type Step } from '../src/iterate.ts';
import { barOf, clockOf, remainingMs, statusOf, verdictLineOf } from '../src/progress.ts';

const MINUTE_MS = 60_000;
const CAP = 10;
const GRID = 18;
const DONE = 7;

const CLEAN = { ok: true, output: '' };
const DIRTY = { ok: false, output: 'SHR-L002' };

test('the bar fills in proportion, and an empty grid reads as full rather than dividing by zero', () => {
  assert.equal(barOf(0, 4, 4), '░░░░');
  assert.equal(barOf(1, 2, 4), '██░░');
  assert.equal(barOf(4, 4, 4), '████');
  assert.equal(barOf(0, 0, 4), '████');
});

test('durations read as a person would say them', () => {
  assert.equal(clockOf(42_000), '42s');
  assert.equal(clockOf(65_000), '1m05s');
  assert.equal(clockOf(70 * MINUTE_MS), '1h10m');
  assert.equal(clockOf(-1), '0s');
});

test('no estimate until a cell has run, because a guess before the first is made up', () => {
  assert.equal(remainingMs([], GRID, 0), undefined);
});

test('the estimate is the mean per cell left, less what the running cell has used', () => {
  assert.equal(remainingMs([MINUTE_MS, 3 * MINUTE_MS], 3, 0), 6 * MINUTE_MS);
  assert.equal(remainingMs([MINUTE_MS], 3, MINUTE_MS / 2), 2.5 * MINUTE_MS);
  assert.equal(remainingMs([MINUTE_MS], 1, 5 * MINUTE_MS), 0);
});

test('the status line says where the grid is, what it cost, and what the cell is doing', () => {
  const step: Step = { phase: Phase.Working, n: 3, cap: CAP, spentUSD: 2 };

  const line = statusOf({
    total: GRID,
    done: DONE,
    ranMs: [10 * MINUTE_MS],
    spentUSD: 14.2,
    current: { stem: 'T03-react-seed2', startedAt: 0, step, stepAt: MINUTE_MS },
    now: 2 * MINUTE_MS,
  });

  assert.match(line, /^\[7\/18\] █+░+ 38% · \$14\.20 · ~1h48m left/);
  assert.match(line, /T03-react-seed2 · iteration 3\/10 · agent working 1m00s$/);
});

test('before the first cell ends, the status line says so instead of a number', () => {
  const line = statusOf({ total: GRID, done: 0, ranMs: [], spentUSD: 0, now: 0 });

  assert.match(line, /time left after the first cell/);
});

test('a verdict line names what failed, and says green when nothing did', () => {
  const red: Step = {
    phase: Phase.Judged,
    n: 2,
    cap: CAP,
    spentUSD: 1,
    result: { pass: false, clean: DIRTY, suite: { ok: false, failing: ['a', 'b'], raw: '' } },
  };

  const green: Step = {
    ...red,
    result: { pass: true, clean: CLEAN, suite: { ok: true, failing: [], raw: '' } },
  };

  assert.equal(
    verdictLineOf('T01-react-seed1', red),
    'T01-react-seed1 · iteration 2: checker NOT clean, 2 tests failing',
  );

  assert.equal(verdictLineOf('T01-react-seed1', green), 'T01-react-seed1 · iteration 2: green');
});
