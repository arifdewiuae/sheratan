// The twelve cases of the Week 0 gate: three violation classes across four
// host modules (EVAL-TASKS §5).
//
// Every injection is behaviour-preserving. The gate asks whether a structured
// error produces a one-turn structural repair, so a case that also broke the
// app would be measuring whether the agent can guess at hidden tests it never
// sees. `hosts.test.ts` passes before the injection and has to pass after the
// repair; what changes in between is only where the code lives.

import { RuleCode } from './rules.ts';

/** One exact substitution. The text must appear exactly once, or the run fails. */
export interface Patch {
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

/** A host file with a violation put into it, and what the violation is. */
export interface Case {
  readonly id: string;
  /** The module the violation lands in. */
  readonly host: string;
  readonly code: RuleCode;
  /** What was done to the working code, for the results table. */
  readonly summary: string;
  readonly patches: readonly Patch[];
}

const CUSTOMERS = 'modules/customers/';
const NEW_ORDER = 'modules/new-order/';
const ORDERS = 'modules/orders/';
const TOASTS = 'modules/notifications/';

// ------------------------------------------------ SHR-L002: I/O in a view

const viewIO: readonly Case[] = [
  {
    id: 'L002-customers',
    host: 'customers',
    code: RuleCode.ViewIO,
    summary: 'the view writes document.title from the row count',
    patches: [
      {
        file: `${CUSTOMERS}customers.view.ts`,
        find: `export function customersView(state: CustomersState, intents: CustomersIntents): Template {
  return html\`<section class="customers">`,
        replace: `export function customersView(state: CustomersState, intents: CustomersIntents): Template {
  // Keep the tab title in step with the list.
  document.title = \`Customers (\${String(state.rows().length)})\`;

  return html\`<section class="customers">`,
      },
    ],
  },
  {
    id: 'L002-new-order',
    host: 'new-order',
    code: RuleCode.ViewIO,
    summary: 'the view fetches the customer list to warm the select',
    patches: [
      {
        file: `${NEW_ORDER}new-order.view.ts`,
        find: `  const chosen = computed(() => String(state.customerId()));`,
        replace: `  // Warm the customer list so the select is never empty.
  void fetch('/api/customers').catch(() => undefined);

  const chosen = computed(() => String(state.customerId()));`,
      },
    ],
  },
  {
    id: 'L002-orders',
    host: 'orders',
    code: RuleCode.ViewIO,
    summary: 'the view sets the tab title on a timer',
    patches: [
      {
        file: `${ORDERS}orders.view.ts`,
        find: `export function ordersView(state: OrdersState, intents: OrdersIntents): Template {
  return html\`<section class="orders">`,
        replace: `export function ordersView(state: OrdersState, intents: OrdersIntents): Template {
  // Let the tab say how many orders there are, once the list has arrived.
  setTimeout(() => {
    document.title = \`Orders (\${String(state.rows().length)})\`;
  }, 0);

  return html\`<section class="orders">`,
      },
    ],
  },
  {
    id: 'L002-notifications',
    host: 'notifications',
    code: RuleCode.ViewIO,
    summary: 'the view mirrors the toast into the tab title',
    patches: [
      {
        file: `${TOASTS}notifications.view.ts`,
        find: `  return html\`<div class="toasts">`,
        replace: `  // Mirror the message into the tab, for a window nobody is looking at.
  document.title = state.showing() ? state.message() : 'Dashboard';

  return html\`<div class="toasts">`,
      },
    ],
  },
];

// ------------------------- SHR-L005: effects writes state instead of calling
// a transition. The injection moves the transition's body into effects and
// deletes the transition, so the repair is the one the `fix` field names
// rather than "call the function that is still sitting there".

const directWrite: readonly Case[] = [
  {
    id: 'L005-customers',
    host: 'customers',
    code: RuleCode.DirectWrite,
    summary: 'the `failed` transition is inlined into effects',
    patches: [
      {
        file: `${CUSTOMERS}customers.state.ts`,
        find: `import { batch, computed, signal, type Accessor } from 'sheratan';`,
        replace: `import { batch, computed, signal, type Accessor, type Signal } from 'sheratan';`,
      },
      {
        file: `${CUSTOMERS}customers.state.ts`,
        find: `  readonly rows: Accessor<readonly Customer[]>;
  readonly status: Accessor<Status>;
  readonly error: Accessor<string>;`,
        replace: `  readonly rows: Signal<readonly Customer[]>;
  readonly status: Signal<Status>;
  readonly error: Signal<string>;`,
      },
      {
        file: `${CUSTOMERS}customers.state.ts`,
        find: `  loaded(rows: readonly Customer[]): void;
  failed(message: string): void;`,
        replace: `  loaded(rows: readonly Customer[]): void;`,
      },
      {
        file: `${CUSTOMERS}customers.state.ts`,
        find: `
    failed(message: string): void {
      batch(() => {
        rows.set(NO_ROWS);
        error.set(message);
        status.set(Status.Failed);
      });
    },`,
        replace: ``,
      },
      {
        file: `${CUSTOMERS}customers.effects.ts`,
        find: `import type { CustomersState } from './customers.state.ts';`,
        replace: `import { Status, type CustomersState } from './customers.state.ts';`,
      },
      {
        file: `${CUSTOMERS}customers.effects.ts`,
        find: `      state.failed(message);
      notifications.raise(message);`,
        replace: `      state.rows.set([]);
      state.error.set(message);
      state.status.set(Status.Failed);
      notifications.raise(message);`,
      },
    ],
  },
  {
    id: 'L005-new-order',
    host: 'new-order',
    code: RuleCode.DirectWrite,
    summary: 'the `rejected` transition is inlined into effects',
    patches: [
      {
        file: `${NEW_ORDER}new-order.state.ts`,
        find: `  readonly errors: Accessor<FieldErrors>;
  readonly pending: Accessor<boolean>;`,
        replace: `  readonly errors: Signal<FieldErrors>;
  readonly pending: Signal<boolean>;`,
      },
      {
        file: `${NEW_ORDER}new-order.state.ts`,
        find: `  created(id: number): void;
  rejected(errors: FieldErrors): void;`,
        replace: `  created(id: number): void;`,
      },
      {
        file: `${NEW_ORDER}new-order.state.ts`,
        find: `
    rejected(found: FieldErrors): void {
      batch(() => {
        pending.set(false);
        errors.set(found);
      });
    },`,
        replace: ``,
      },
      {
        file: `${NEW_ORDER}new-order.effects.ts`,
        find: `      state.rejected(found);`,
        replace: `      state.pending.set(false);
      state.errors.set(found);`,
      },
    ],
  },
  {
    id: 'L005-orders',
    host: 'orders',
    code: RuleCode.DirectWrite,
    summary: 'the `shipped` transition is inlined into effects',
    patches: [
      {
        file: `${ORDERS}orders.state.ts`,
        find: `  readonly inFlight: Accessor<ReadonlySet<number>>;`,
        replace: `  readonly inFlight: Signal<ReadonlySet<number>>;`,
      },
      {
        file: `${ORDERS}orders.state.ts`,
        find: `  shipping(id: number): void;
  shipped(id: number): void;`,
        replace: `  shipping(id: number): void;`,
      },
      {
        file: `${ORDERS}orders.state.ts`,
        find: `
    shipped(id: number): void {
      inFlight.set(without(inFlight(), id));
    },`,
        replace: ``,
      },
      {
        file: `${ORDERS}orders.effects.ts`,
        find: `      if (!controller.signal.aborted) state.shipped(id);`,
        replace: `      if (!controller.signal.aborted) {
        const waiting = new Set(state.inFlight());

        waiting.delete(id);
        state.inFlight.set(waiting);
      }`,
      },
    ],
  },
  {
    id: 'L005-notifications',
    host: 'notifications',
    code: RuleCode.DirectWrite,
    summary: 'the `dismissed` transition is inlined into effects',
    patches: [
      {
        file: `${TOASTS}notifications.state.ts`,
        find: `import { computed, signal, type Accessor } from 'sheratan';`,
        replace: `import { computed, signal, type Accessor, type Signal } from 'sheratan';`,
      },
      {
        file: `${TOASTS}notifications.state.ts`,
        find: `  readonly message: Accessor<string>;`,
        replace: `  readonly message: Signal<string>;`,
      },
      {
        file: `${TOASTS}notifications.state.ts`,
        find: `  raised(message: string): void;
  dismissed(): void;`,
        replace: `  raised(message: string): void;`,
      },
      {
        file: `${TOASTS}notifications.state.ts`,
        find: `
    dismissed(): void {
      message.set(NOTHING);
    },`,
        replace: ``,
      },
      {
        file: `${TOASTS}notifications.effects.ts`,
        find: `      timer = setTimeout(() => {
        state.dismissed();
      }, LINGER_MS);`,
        replace: `      timer = setTimeout(() => {
        state.message.set('');
      }, LINGER_MS);`,
      },
      {
        file: `${TOASTS}notifications.effects.ts`,
        find: `    dismiss(): void {
      clear();
      state.dismissed();
    },`,
        replace: `    dismiss(): void {
      clear();
      state.message.set('');
    },`,
      },
    ],
  },
];

// ------------------------------------ SHR-L001: reaching past a module's index

const boundary: readonly Case[] = [
  {
    id: 'L001-customers',
    host: 'customers',
    code: RuleCode.Boundary,
    summary: "effects imports the toast's effects file instead of its index",
    patches: [
      {
        file: `${CUSTOMERS}customers.effects.ts`,
        find: `import type { NotificationsEffects } from '../notifications/index.ts';`,
        replace: `import type { NotificationsEffects } from '../notifications/notifications.effects.ts';`,
      },
    ],
  },
  {
    id: 'L001-new-order',
    host: 'new-order',
    code: RuleCode.Boundary,
    summary: "effects imports the toast's effects file instead of its index",
    patches: [
      {
        file: `${NEW_ORDER}new-order.effects.ts`,
        find: `import type { NotificationsEffects } from '../notifications/index.ts';`,
        replace: `import type { NotificationsEffects } from '../notifications/notifications.effects.ts';`,
      },
    ],
  },
  {
    id: 'L001-orders',
    host: 'orders',
    code: RuleCode.Boundary,
    summary: "effects imports the toast's effects file instead of its index",
    patches: [
      {
        file: `${ORDERS}orders.effects.ts`,
        find: `import type { NotificationsEffects } from '../notifications/index.ts';`,
        replace: `import type { NotificationsEffects } from '../notifications/notifications.effects.ts';`,
      },
    ],
  },
  {
    id: 'L001-notifications',
    host: 'notifications',
    code: RuleCode.Boundary,
    summary: "effects reaches into orders' state for the shipped constant",
    patches: [
      {
        file: `${TOASTS}notifications.effects.ts`,
        find: `import type { NotificationsState } from './notifications.state.ts';`,
        replace: `import { SHIPPED } from '../orders/orders.state.ts';
import type { NotificationsState } from './notifications.state.ts';`,
      },
      {
        file: `${TOASTS}notifications.effects.ts`,
        find: `      timer = setTimeout(() => {
        state.dismissed();
      }, LINGER_MS);`,
        replace: `      // Good news is worth a longer look than a failure.
      const linger = message.includes(SHIPPED) ? LINGER_MS * 2 : LINGER_MS;

      timer = setTimeout(() => {
        state.dismissed();
      }, linger);`,
      },
    ],
  },
];

/**
 * The twelve cases, in a fixed order so a seed always means the same thing.
 * Every case is one class in one host; three classes, four hosts (EVAL-TASKS §5).
 */
export const CASES: readonly Case[] = [...viewIO, ...directWrite, ...boundary];
