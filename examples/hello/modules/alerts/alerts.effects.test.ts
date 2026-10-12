// Effects is handed a fake contract, run, and asked what reached state
// (SPEC §4). `scope()` gives it an owner without a DOM, so unmounting is
// `dispose()`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scope } from 'sheratan';

import type { AlertRule, AlertsApi, NewRule, RuleAnswer } from '../../services/alerts.contract.ts';
import { createAlertsEffects, type AlertsEffects } from './alerts.effects.ts';
import { createAlertsState, type AlertsState } from './alerts.state.ts';

const LATENCY: AlertRule = { id: 1, metric: 'latency', above: 1500, below: 1200 };
const QUEUE = { metric: 'queue', above: '90', below: '60' };

/** Lets a pending promise and its `.then` run before the assertions. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A contract that records what it was asked to add, and answers as told. */
function apiThat(answer: (rule: NewRule) => Promise<RuleAnswer>): {
  readonly api: AlertsApi;
  readonly added: NewRule[];
  readonly signals: AbortSignal[];
} {
  const added: NewRule[] = [];
  const signals: AbortSignal[] = [];

  return {
    added,
    signals,
    api: {
      list: async (signal) => {
        signals.push(signal);

        return [LATENCY];
      },
      add: async (rule) => {
        added.push(rule);

        return answer(rule);
      },
    },
  };
}

const keeps = async (rule: NewRule): Promise<RuleAnswer> => ({ rule: { ...rule, id: 2 } });

/** State and effects as `index.ts` builds them, inside an owner. */
function started(api: AlertsApi): {
  readonly state: AlertsState;
  readonly effects: AlertsEffects;
  readonly dispose: () => void;
} {
  const { value, dispose } = scope(() => {
    const state = createAlertsState();
    const effects = createAlertsEffects(api, state);

    effects.start();

    return { state, effects };
  });

  return { ...value, dispose };
}

test('starting lists the rules already kept', async () => {
  const { state, dispose } = started(apiThat(keeps).api);

  await settled();

  assert.deepEqual(state.rules(), [LATENCY]);

  dispose();
});

test('a submit with something missing sends nothing and shows every message', async () => {
  const fake = apiThat(keeps);
  const { state, effects, dispose } = started(fake.api);

  effects.submit();
  await settled();

  assert.deepEqual(fake.added, []);
  assert.equal(state.rule.errors().metric, 'Choose a metric');

  dispose();
});

test('a kept rule is listed and the form starts over', async () => {
  const fake = apiThat(keeps);
  const { state, effects, dispose } = started(fake.api);

  await settled();
  effects.edited(QUEUE);
  effects.submit();

  assert.equal(state.saving(), true, 'the optimistic transition ran before the request');

  await settled();

  assert.deepEqual(fake.added, [{ metric: 'queue', above: 90, below: 60 }]);

  assert.deepEqual(
    state.rules().map((rule) => rule.metric),
    ['latency', 'queue'],
  );

  assert.equal(state.rule.values().metric, '');

  dispose();
});

test('two submits in one frame send one rule', async () => {
  const fake = apiThat(keeps);
  const { effects, dispose } = started(fake.api);

  effects.edited(QUEUE);
  effects.submit();
  effects.submit();
  await settled();

  assert.equal(fake.added.length, 1);

  dispose();
});

test('a refusal lands under the field it names, and nothing is listed', async () => {
  const fake = apiThat(async () => ({ errors: { metric: 'This metric already has a rule' } }));
  const { state, effects, dispose } = started(fake.api);

  await settled();
  effects.edited({ ...QUEUE, metric: 'latency' });
  effects.submit();
  await settled();

  assert.equal(state.rule.errors().metric, 'This metric already has a rule');
  assert.deepEqual(state.rules(), [LATENCY]);

  dispose();
});

test('a save that fails is rolled back and said', async () => {
  const fake = apiThat(async () => {
    throw new Error('the store is down');
  });

  const { state, effects, dispose } = started(fake.api);

  effects.edited(QUEUE);
  effects.submit();
  await settled();

  assert.equal(state.saving(), false);
  assert.equal(state.failure(), 'The rule was not saved. Try again.');

  dispose();
});

test('a load that fails carries its reason', async () => {
  const fake = apiThat(keeps);

  const { state, dispose } = started({
    ...fake.api,
    list: async () => {
      throw new Error('the store is down');
    },
  });

  await settled();

  assert.equal(state.failure(), 'the store is down');

  dispose();
});

test('unmounting aborts the load', () => {
  const fake = apiThat(keeps);
  const { dispose } = started(fake.api);

  dispose();

  assert.equal(fake.signals[0]?.aborted, true);
});
