// Breaking a correct app on purpose, once per thing a hidden suite claims to
// check (EVAL-TASKS §1.4).
//
// A suite that passes against the reference has shown only that it does not
// reject a correct app. That is half the claim. The other half is that it
// would notice a wrong one, and the only way to know is to hand it one: a
// suite with a vacuous assertion — a locator that matches nothing, a counter
// read at the wrong moment — passes the reference and every broken app alike,
// and would then score a $30 matrix as a wash.
//
// `packages/check/test/template.test.ts` holds the same line for checker
// rules, for the same reason. Each mutation names the tests it must break, so
// a mutation that breaks everything is as much a failure as one that breaks
// nothing: both mean the suite is not measuring what its name says.
//
// These are never handed to anyone. They patch a reference, which no agent
// sees, and they live outside `suites/` because they are written in one arm's
// framework and a suite may not be.

import type { Patch } from './cases.ts';

/** One deliberate break, and what it must cost. */
export interface Mutation {
  /** `T01-order` — the task it belongs to, and what was done. */
  readonly id: string;
  readonly task: string;
  /** What was broken, for the line the proof prints. */
  readonly summary: string;
  /** The exact test titles this must make fail, and no others. */
  readonly fails: readonly string[];
  readonly patches: readonly Patch[];
}

const CUSTOMERS_STATE = 'modules/customers/customers.state.ts';
const CUSTOMERS_VIEW = 'modules/customers/customers.view.ts';
const CUSTOMERS_EFFECTS = 'modules/customers/customers.effects.ts';
const ORDER_STATE = 'modules/new-order/new-order.state.ts';
const ORDER_VIEW = 'modules/new-order/new-order.view.ts';
const ORDER_EFFECTS = 'modules/new-order/new-order.effects.ts';
const SHIP_EFFECTS = 'modules/orders/orders.effects.ts';

const sheratan: readonly Mutation[] = [
  {
    id: 'T01-order',
    task: 'T01',
    summary: 'the list is committed in reverse',
    fails: ['every row the server sent is rendered, in its order, with its cells'],
    patches: [
      {
        file: CUSTOMERS_STATE,
        find: `        rows.set(next);
        status.set(Status.Ready);`,
        replace: `        rows.set([...next].reverse());
        status.set(Status.Ready);`,
      },
    ],
  },
  {
    id: 'T01-overlap',
    task: 'T01',
    // The one that matters most. The frame assertion is the easiest of the
    // five to write vacuously: an observer attached too late, or a visibility
    // test that is never true, passes the reference in silence.
    summary: 'the loader is left on screen underneath the table',
    fails: [
      'the loader shows while the list is on its way, and then stops',
      'never two of the loader, the error and the table at once',
    ],
    patches: [
      {
        file: CUSTOMERS_VIEW,
        find: `  if (state.isLoading()) return html\`<p data-testid="loading">Loading…</p>\`;
  if (state.hasFailed()) return failure(state, intents);

  return table(state);`,
        replace: `  if (state.hasFailed()) return failure(state, intents);

  return html\`<p data-testid="loading">Loading…</p>\${table(state)}\`;`,
      },
    ],
  },
  {
    id: 'T01-retry-twice',
    task: 'T01',
    summary: 'retry starts two loads instead of one',
    fails: ['retry asks exactly once more, and the list arrives'],
    patches: [
      {
        file: CUSTOMERS_EFFECTS,
        find: `  return { load, retry: load };`,
        replace: `  const retryTwice = (): void => {
    void run();
    void run();
  };

  return { load, retry: retryTwice };`,
      },
    ],
  },
  {
    id: 'T03-no-validation',
    task: 'T03',
    summary: 'the form sends whatever was typed, bounds or not',
    fails: ['a quantity outside the bounds is refused without asking the server'],
    patches: [
      {
        file: ORDER_STATE,
        find: '      return Object.keys(found).length === 0;',
        replace: '      return true;',
      },
    ],
  },
  {
    id: 'T03-double-send',
    task: 'T03',
    // Both halves of "one POST" have to go: the button stops closing *and*
    // the guard behind it stops holding, because either alone still sends one.
    summary: 'the submit button stays open and sends again',
    fails: [
      'a valid draft is sent once, with the submit button held shut',
      'pressing submit twice still sends one order',
    ],
    patches: [
      {
        file: ORDER_VIEW,
        find: '<button data-testid="submit" type="submit" .disabled=${state.pending}>Create order</button>',
        replace: '<button data-testid="submit" type="submit">Create order</button>',
      },
      {
        file: ORDER_EFFECTS,
        find: '      if (state.pending()) return;\n',
        replace: '',
      },
    ],
  },
  {
    id: 'T03-forgets-fields',
    task: 'T03',
    summary: 'a refusal empties the note the person already typed',
    fails: ['a refusal from the server is shown on the field it names'],
    patches: [
      {
        file: ORDER_STATE,
        find: '    rejected(found: FieldErrors): void {',
        replace: '    rejected(found: FieldErrors): void {\n      note.set(EMPTY);',
      },
    ],
  },
  {
    id: 'T03-keeps-form',
    task: 'T03',
    summary: 'a created order leaves the quantity in the box',
    fails: ['a created order clears the form and shows its id'],
    patches: [
      {
        file: ORDER_STATE,
        find: '    fields.quantity.set(EMPTY);\n',
        replace: '',
      },
    ],
  },

  {
    id: 'T04-not-optimistic',
    task: 'T04',
    // The badge still reaches `shipped`, just not until the server agrees —
    // so the only assertion that can catch this is the one that reads what
    // the server thought at the moment the badge moved.
    summary: 'the badge waits for the server instead of moving first',
    fails: [
      'the badge says shipped before the server has answered',
      // A badge that never moves early has nothing to put back and nothing to
      // hold while a second ship is in flight, so both rollback assertions go
      // with it — and should.
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
    ],
    patches: [
      { file: SHIP_EFFECTS, find: '      state.shipping(id);\n\n', replace: '' },
      {
        file: SHIP_EFFECTS,
        find: '      if (!controller.signal.aborted) state.shipped(id);',
        replace: `      if (!controller.signal.aborted) {
        state.shipping(id);
        state.shipped(id);
      }`,
      },
    ],
  },
  {
    id: 'T04-no-rollback',
    task: 'T04',
    summary: 'a refused ship leaves the badge where it was put',
    fails: [
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
    ],
    patches: [
      {
        file: SHIP_EFFECTS,
        find: '      state.reverted(id, previous);',
        replace: '      state.shipped(id);',
      },
    ],
  },
  {
    id: 'T04-no-toast',
    task: 'T04',
    summary: 'the rollback happens in silence',
    fails: ['a refused ship puts the badge back and says why'],
    patches: [
      {
        file: SHIP_EFFECTS,
        find: `      state.reverted(id, previous);
      notifications.raise(messageOf(error));`,
        replace: '      state.reverted(id, previous);',
      },
    ],
  },
  {
    id: 'T04-never-sends',
    task: 'T04',
    // Broad on purpose. An app that moves the badge and never asks the server
    // passes the first assertion by doing exactly what it forbids halfway,
    // which is why the reload assertion exists.
    summary: 'the badge moves and no request is ever made',
    fails: [
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
      'a shipped order is still shipped after a reload',
    ],
    patches: [{ file: SHIP_EFFECTS, find: '      void send(id, previous);\n', replace: '' }],
  },
];

/** Every arm's mutations, by the id of the arm whose reference they patch. */
export const MUTATIONS: ReadonlyMap<string, readonly Mutation[]> = new Map([
  ['sheratan', sheratan],
]);
