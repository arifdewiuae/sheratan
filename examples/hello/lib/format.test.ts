import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compact, signed } from './format.ts';

test('compact shortens thousands and millions', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(998.6), '999');
  assert.equal(compact(12_400), '12.4k');
  assert.equal(compact(2_500_000), '2.5M');
  assert.equal(compact(-12_400), '-12.4k');
});

test('signed keeps the direction visible', () => {
  assert.equal(signed(12), '+12');
  assert.equal(signed(0), '0');
  assert.equal(signed(-4), '-4');
});
