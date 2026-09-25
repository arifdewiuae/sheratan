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

const CUSTOMERS_PAGE = 'modules/customers/Customers.tsx';
const ORDER_STORE = 'modules/new-order/new-order.store.ts';
const ORDER_FORM = 'modules/new-order/NewOrder.tsx';
const SHIP_QUERIES = 'modules/orders/orders.queries.ts';

// The same eleven breaks, in the other arm's idiom. They are deliberately the
// same list: a suite that notices a missing rollback in one framework and not
// in the other is not one instrument, and the comparison it scores would be
// two measurements wearing one name.
//
// Three of them have to reach further than their Sheratan counterparts, and
// the reason is the same each time: the React app reconciles with the server
// after a write settles. A refetch puts a badge back whether or not the app
// meant to, so breaking only the rollback leaves an app that still passes.
// Where that happens, the mutation takes the refetch with it and says so.
const react: readonly Mutation[] = [
  {
    id: 'T01-order',
    task: 'T01',
    summary: 'the list is committed in reverse',
    fails: ['every row the server sent is rendered, in its order, with its cells'],
    patches: [
      {
        file: CUSTOMERS_PAGE,
        find: '  return <Table rows={customers.data} />;',
        replace: '  return <Table rows={[...customers.data].reverse()} />;',
      },
    ],
  },
  {
    id: 'T01-overlap',
    task: 'T01',
    summary: 'the loader is left on screen underneath the table',
    fails: [
      'the loader shows while the list is on its way, and then stops',
      'never two of the loader, the error and the table at once',
    ],
    patches: [
      {
        file: CUSTOMERS_PAGE,
        find: '  if (customers.isPending) return <p data-testid="loading">Loading…</p>;\n\n',
        replace: '',
      },
      {
        file: CUSTOMERS_PAGE,
        find: '  return <Table rows={customers.data} />;',
        replace: `  return (
    <>
      <p data-testid="loading">Loading…</p>
      <Table rows={customers.data ?? []} />
    </>
  );`,
      },
    ],
  },
  {
    id: 'T01-retry-twice',
    task: 'T01',
    // Calling `refetch` twice is not this break: the library answers the
    // second call with the first one's in-flight promise, so the server still
    // sees one request and the app is not wrong. Proved by this mutation
    // failing to fail before it was written this way. A second load has to be
    // a second load — here, the contract asked directly beside the library.
    summary: 'retry starts two loads instead of one',
    fails: ['retry asks exactly once more, and the list arrives'],
    patches: [
      {
        file: CUSTOMERS_PAGE,
        find: "import type { Customer } from '../../services/api.contract.ts';",
        replace: `import type { Customer } from '../../services/api.contract.ts';
import { useApi } from '../../services/api.context.ts';`,
      },
      {
        file: CUSTOMERS_PAGE,
        find: '  const customers = useCustomers();\n',
        replace: `  const customers = useCustomers();
  const api = useApi();
`,
      },
      {
        file: CUSTOMERS_PAGE,
        find: '          void customers.refetch();',
        replace: `          void customers.refetch();
          void api.customers(new AbortController().signal);`,
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
        file: ORDER_STORE,
        find: '    return Object.keys(found).length === 0;',
        replace: '    return true;',
      },
    ],
  },
  {
    id: 'T03-double-send',
    task: 'T03',
    // Both halves go, as in the other arm: the button stops closing and the
    // latch behind it stops holding, because either alone still sends one.
    summary: 'the submit button stays open and sends again',
    fails: [
      'a valid draft is sent once, with the submit button held shut',
      'pressing submit twice still sends one order',
    ],
    patches: [
      {
        file: ORDER_FORM,
        find: '    if (sending.current) return;\n\n',
        replace: '',
      },
      {
        file: ORDER_FORM,
        find: '      <button data-testid="submit" type="submit" disabled={create.isPending}>',
        replace: '      <button data-testid="submit" type="submit">',
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
        file: ORDER_STORE,
        find: '  rejected: (errors) => set({ errors }),',
        replace: "  rejected: (errors) => set({ errors, note: '' }),",
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
        file: ORDER_STORE,
        find: '  cleared: () => set(INITIAL),',
        replace:
          '  cleared: () => set({ customerId: INITIAL.customerId, note: INITIAL.note, errors: INITIAL.errors }),',
      },
    ],
  },

  {
    id: 'T04-not-optimistic',
    task: 'T04',
    summary: 'the badge waits for the server instead of moving first',
    fails: [
      'the badge says shipped before the server has answered',
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
    ],
    patches: [
      { file: SHIP_QUERIES, find: '      setStatus(client, id, SHIPPED);\n\n', replace: '' },
      {
        file: SHIP_QUERIES,
        find: '    onError: (error: Error, id: number, context) => {',
        replace: `    onSuccess: (_answer: void, id: number) => {
      setStatus(client, id, SHIPPED);
    },

    onError: (error: Error, id: number, context) => {`,
      },
    ],
  },
  {
    id: 'T04-no-rollback',
    task: 'T04',
    // The refetch goes too, and not as a second break. An app that reconciles
    // with the server on settle puts the badge back whether or not it meant
    // to, so leaving it in would prove only that the refetch works.
    summary: 'a refused ship leaves the badge where it was put',
    fails: [
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
    ],
    patches: [
      {
        file: SHIP_QUERIES,
        find: '      if (context !== undefined) setStatus(client, id, context.previous);',
        replace: '      if (context !== undefined) setStatus(client, id, SHIPPED);',
      },
      {
        file: SHIP_QUERIES,
        find: '      await client.invalidateQueries({ queryKey: ORDERS_KEY });',
        replace: '      await Promise.resolve();',
      },
    ],
  },
  {
    id: 'T04-no-toast',
    task: 'T04',
    summary: 'the rollback happens in silence',
    fails: ['a refused ship puts the badge back and says why'],
    patches: [{ file: SHIP_QUERIES, find: '\n      raise(error.message);', replace: '' }],
  },
  {
    id: 'T04-never-sends',
    task: 'T04',
    // Broad on purpose, and here the refetch has to go with it for the same
    // reason as above: reconciling with a server that was never asked would
    // undo the optimistic badge and disguise the break as a rollback.
    summary: 'the badge moves and no request is ever made',
    fails: [
      'a refused ship puts the badge back and says why',
      'when one of two ships fails, only that row goes back',
      'a shipped order is still shipped after a reload',
    ],
    patches: [
      {
        file: SHIP_QUERIES,
        find: '    mutationFn: (id: number) => api.shipOrder(id, new AbortController().signal),',
        replace: '    mutationFn: (_id: number) => Promise.resolve(),',
      },
      {
        file: SHIP_QUERIES,
        find: '      await client.invalidateQueries({ queryKey: ORDERS_KEY });',
        replace: '      await Promise.resolve();',
      },
    ],
  },
];

/** Every arm's mutations, by the id of the arm whose reference they patch. */
export const MUTATIONS: ReadonlyMap<string, readonly Mutation[]> = new Map([
  ['sheratan', sheratan],
  ['react', react],
]);
