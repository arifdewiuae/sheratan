// Forms (SPEC §6, ADR 0006). Written before the implementation: what `form()`
// promises is when a message is shown — a field's own message once that field
// has changed, every message after `attempted()`, a server's message until its
// field changes — and that its transitions are ordinary state transitions,
// which commit once and write nothing after their owner is gone.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { dom, freshHost } from './dom.ts';
import { flush, form, html, render, scope, watch, type Form } from '../src/index.ts';

const NUMBER = /^\d+$/;
const ENTER_A_NUMBER = 'Enter a number';
const UNDER_THE_ALARM = 'Must be under the alarm level';
const ALREADY_TAKEN = 'A rule for this metric exists';

interface RuleFields {
  readonly metric: string;
  readonly above: string;
  readonly below: string;
}

/** A rule with a check on one field and a check that relates two of them. */
function createRule(): Form<RuleFields> {
  return form({
    fields: { metric: 'cpu', above: '', below: '' },
    check: ({ above, below }) => ({
      above: NUMBER.test(above) ? '' : ENTER_A_NUMBER,
      below: Number(below) < Number(above) ? '' : UNDER_THE_ALARM,
    }),
  });
}

const NOTHING_SHOWN = { metric: '', above: '', below: '' };

let host: Element;

beforeEach(() => {
  host = freshHost();
});

test('a new form holds its initial values and shows nothing', () => {
  const rule = createRule();

  assert.deepEqual(rule.values(), { metric: 'cpu', above: '', below: '' });
  assert.deepEqual(rule.errors(), NOTHING_SHOWN);
  assert.equal(rule.valid(), false, 'invalid whether or not a message is shown');
});

test("a field's message shows once that field has changed, and no other's", () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: 'x', below: '' });

  assert.deepEqual(rule.errors(), { metric: '', above: ENTER_A_NUMBER, below: '' });
});

test('a message goes as soon as the value passes, and comes back if it stops passing', () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: 'x', below: '' });
  rule.edited({ metric: 'cpu', above: '90', below: '' });

  assert.equal(rule.errors().above, '');

  rule.edited({ metric: 'cpu', above: '', below: '' });

  assert.equal(rule.errors().above, ENTER_A_NUMBER, 'changed back to empty is still changed');
});

test('an event that changes nothing shows nothing', () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: '', below: '' });

  assert.deepEqual(rule.errors(), NOTHING_SHOWN);
});

test('edited() replaces the values: a field the form did not report becomes empty', () => {
  const rule = createRule();

  rule.edited({ metric: 'memory', above: '90', below: '10' });
  rule.edited({ above: '90', below: '10' });

  assert.deepEqual(rule.values(), { metric: '', above: '90', below: '10' });
});

test('a name the form declares no field for is not a value', () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: '90', below: '10', submitter: 'save' });

  assert.deepEqual(Object.keys(rule.values()).toSorted(), ['above', 'below', 'metric']);
});

test('attempted() shows every message, including for fields never touched', () => {
  const rule = createRule();

  rule.attempted();

  assert.deepEqual(rule.errors(), { metric: '', above: ENTER_A_NUMBER, below: UNDER_THE_ALARM });
});

test('valid is the check alone: true once every message is empty', () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: '90', below: '10' });

  assert.equal(rule.valid(), true);
  assert.deepEqual(rule.errors(), NOTHING_SHOWN);
});

test("a server's message shows until its own field changes", () => {
  const rule = createRule();

  rule.edited({ metric: 'cpu', above: '90', below: '10' });
  rule.rejected({ metric: ALREADY_TAKEN });

  assert.equal(rule.errors().metric, ALREADY_TAKEN);
  assert.equal(rule.valid(), true, 'the server judged what was sent, not what is typed');

  rule.edited({ metric: 'cpu', above: '95', below: '10' });

  assert.equal(rule.errors().metric, ALREADY_TAKEN, 'another field changing keeps it');

  rule.edited({ metric: 'disk', above: '95', below: '10' });

  assert.equal(rule.errors().metric, '');
});

test("a server's message wins over the check's for the same field", () => {
  const rule = createRule();

  rule.attempted();
  rule.rejected({ above: 'Too high for this metric' });

  assert.equal(rule.errors().above, 'Too high for this metric');
  assert.equal(rule.errors().below, UNDER_THE_ALARM);
});

test('reset() restores the initial values and shows nothing at all', () => {
  const rule = createRule();

  rule.edited({ metric: 'disk', above: 'x', below: '' });
  rule.attempted();
  rule.rejected({ metric: ALREADY_TAKEN });
  rule.reset();

  assert.deepEqual(rule.values(), { metric: 'cpu', above: '', below: '' });
  assert.deepEqual(rule.errors(), NOTHING_SHOWN);

  rule.edited({ metric: 'cpu', above: 'x', below: '' });

  assert.deepEqual(
    rule.errors(),
    { metric: '', above: ENTER_A_NUMBER, below: '' },
    'after a reset, only a changed field shows again',
  );
});

test('a form with no check is always valid and shows only the server', () => {
  const note = form({ fields: { text: '' } });

  note.attempted();

  assert.equal(note.valid(), true);
  assert.deepEqual(note.errors(), { text: '' });

  note.rejected({ text: 'Too long' });

  assert.deepEqual(note.errors(), { text: 'Too long' });
});

test('values are frozen state, like any signal', () => {
  const rule = createRule();

  assert.throws(() => {
    (rule.values() as { metric: string }).metric = 'disk';
  }, TypeError);
});

test('one edit commits once, however much of the form it changes', () => {
  const rule = createRule();
  let runs = 0;

  const stop = watch(() => {
    rule.values();
    rule.errors();
    runs++;
  });

  flush();
  runs = 0;
  rule.edited({ metric: 'disk', above: 'x', below: '' });
  flush();

  assert.equal(runs, 1);

  stop();
});

test("a server's answer does not re-run what reads only the values", () => {
  const rule = createRule();
  let runs = 0;

  const stop = watch(() => {
    rule.values();
    runs++;
  });

  flush();
  runs = 0;
  rule.rejected({ metric: ALREADY_TAKEN });
  rule.attempted();
  flush();

  assert.equal(runs, 0);

  stop();
});

test('a transition after its owner is disposed writes nothing (SPEC §5b rule 1)', () => {
  const { value: rule, dispose } = scope(createRule);

  rule.edited({ metric: 'disk', above: '1', below: '0' });
  dispose();
  rule.reset();
  rule.edited({ metric: 'gpu', above: '', below: '' });

  assert.deepEqual(rule.values(), { metric: 'disk', above: '1', below: '0' });
});

test("a <form>'s input events keep the draft current with one handler", () => {
  let rule: Form<RuleFields> | undefined;

  render(() => {
    rule = createRule();

    return html`<form @input=${rule.edited}>
      <input name="metric" value="cpu" />
      <input name="above" value="" />
      <input name="below" value="" />
      <output>${() => rule?.errors().above}</output>
    </form>`;
  }, host);

  const above = host.querySelector('input[name="above"]') as HTMLInputElement;

  above.value = 'x';
  above.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
  flush();

  assert.deepEqual(rule?.values(), { metric: 'cpu', above: 'x', below: '' });
  assert.equal(host.querySelector('output')?.textContent, ENTER_A_NUMBER);
});
