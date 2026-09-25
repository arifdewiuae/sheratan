import assert from 'node:assert/strict';
import { test } from 'node:test';

import { celsius, devices } from './units.ts';

test('a reading is shown to one decimal, with its unit', () => {
  assert.equal(celsius(21.48), '21.5 °C');
  assert.equal(celsius(-3), '-3.0 °C');
});

test('a count agrees with its noun', () => {
  assert.equal(devices(0), '0 devices');
  assert.equal(devices(1), '1 device');
  assert.equal(devices(2), '2 devices');
});
