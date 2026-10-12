// State is a pure function of its transitions: no mocks, no DOM (SPEC §4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AlertRule } from '../../services/alerts.contract.ts';
import { createAlertsState } from './alerts.state.ts';

const LATENCY: AlertRule = { id: 1, metric: 'latency', above: 1500, below: 1200 };
const TAKEN = 'This metric already has a rule';

/** A state whose draft is a rule the checks accept. */
function filledIn(): ReturnType<typeof createAlertsState> {
  const state = createAlertsState();

  state.rule.edited({ metric: 'queue', above: '90', below: '60' });

  return state;
}

test('starts with no rules, an empty draft, nothing shown and nothing to send', () => {
  const state = createAlertsState();

  assert.deepEqual(state.rules(), []);
  assert.deepEqual(state.rule.errors(), { metric: '', above: '', below: '' });
  assert.equal(state.ready(), false);
  assert.equal(state.saving(), false);
  assert.equal(state.failure(), '');
});

test('a submit attempt shows what every field still needs', () => {
  const state = createAlertsState();

  state.rule.attempted();

  assert.deepEqual(state.rule.errors(), {
    metric: 'Choose a metric',
    above: 'Enter a number',
    below: 'Enter a number',
  });
});

test('going off again needs a smaller number than the alarm', () => {
  const state = createAlertsState();

  state.rule.edited({ metric: 'queue', above: '60', below: '90' });

  assert.equal(state.rule.errors().below, 'Must be under the alarm level');
  assert.equal(state.ready(), false);
});

test('the draft the server takes has its numbers parsed', () => {
  const state = filledIn();

  assert.deepEqual(state.draft(), { metric: 'queue', above: 90, below: 60 });
  assert.equal(state.ready(), true);
});

test('a save in flight is not ready for another, and clears an old failure', () => {
  const state = filledIn();

  state.notSent();
  state.sending();

  assert.equal(state.saving(), true);
  assert.equal(state.ready(), false);
  assert.equal(state.failure(), '');
});

test('a kept rule joins the list and the form starts over', () => {
  const state = filledIn();

  state.listed([LATENCY]);
  state.sending();
  state.answered({ rule: { id: 2, metric: 'queue', above: 90, below: 60 } });

  assert.deepEqual(
    state.rules().map((rule) => rule.metric),
    ['latency', 'queue'],
  );

  assert.deepEqual(state.rule.values(), { metric: '', above: '', below: '' });
  assert.equal(state.saving(), false);
});

test("a refusal shows the server's message and keeps what was typed", () => {
  const state = filledIn();

  state.sending();
  state.answered({ errors: { metric: TAKEN } });

  assert.equal(state.rule.errors().metric, TAKEN);
  assert.equal(state.rule.values().metric, 'queue');
  assert.equal(state.saving(), false);
  assert.deepEqual(state.rules(), []);
});

test('a save that did not land says so and keeps the draft', () => {
  const state = filledIn();

  state.sending();
  state.notSent();

  assert.equal(state.failure(), 'The rule was not saved. Try again.');
  assert.equal(state.ready(), true);
  assert.equal(state.rule.values().metric, 'queue');
});

test('a failed load carries its reason', () => {
  const state = createAlertsState();

  state.failed('the store is down');

  assert.equal(state.failure(), 'the store is down');
});
