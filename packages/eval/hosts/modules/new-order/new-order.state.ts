// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { batch, computed, signal, type Accessor, type Signal } from 'sheratan';

import type { Customer, OrderDraft } from '../../services/api.contract.ts';

/** The bounds T03 states. Rejected before a request is ever made. */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1000;
const MAX_NOTE = 200;

const NO_CUSTOMER = 0;
const NO_ORDER = 0;
const EMPTY = '';

/** One message per field, keyed by field name, as the server sends them. */
export type FieldErrors = Readonly<Record<string, string>>;

const NO_ERRORS: FieldErrors = {};

const NO_CUSTOMERS: readonly Customer[] = [];

/** Readable state plus the transitions that may change it. */
export interface NewOrderState {
  /** The options the select offers, loaded by effects. */
  readonly customers: Accessor<readonly Customer[]>;
  readonly customerId: Accessor<number>;
  readonly quantity: Accessor<string>;
  readonly note: Accessor<string>;
  readonly errors: Accessor<FieldErrors>;
  readonly pending: Accessor<boolean>;
  readonly createdId: Accessor<number>;
  readonly wasCreated: Accessor<boolean>;
  /** The draft as the contract wants it, derived rather than stored. */
  readonly draft: Accessor<OrderDraft>;

  customersLoaded(rows: readonly Customer[]): void;
  customerChosen(id: number): void;
  quantityTyped(value: string): void;
  noteTyped(value: string): void;
  /** Validates the current draft, records the errors, and says whether to send. */
  checked(): boolean;
  sending(): void;
  created(id: number): void;
  rejected(errors: FieldErrors): void;
}

function quantityError(value: string): string {
  const parsed = Number(value);

  if (value.trim() === EMPTY) return 'Quantity is required.';
  if (!Number.isInteger(parsed)) return 'Quantity must be a whole number.';

  if (parsed < MIN_QUANTITY || parsed > MAX_QUANTITY) {
    return `Quantity must be between ${String(MIN_QUANTITY)} and ${String(MAX_QUANTITY)}.`;
  }

  return EMPTY;
}

function validate(customerId: number, quantity: string, note: string): FieldErrors {
  const found: Record<string, string> = {};
  const quantityMessage = quantityError(quantity);

  if (customerId === NO_CUSTOMER) found['customerId'] = 'Choose a customer.';
  if (quantityMessage !== EMPTY) found['quantity'] = quantityMessage;

  if (note.length > MAX_NOTE) {
    found['note'] = `Note must be ${String(MAX_NOTE)} characters or fewer.`;
  }

  return found;
}

/** What the person typed, separated from what the server said about it. */
interface Fields {
  readonly customers: Signal<readonly Customer[]>;
  readonly customerId: Signal<number>;
  readonly quantity: Signal<string>;
  readonly note: Signal<string>;
}

function createFields(): Fields {
  return {
    customers: signal(NO_CUSTOMERS),
    customerId: signal(NO_CUSTOMER),
    quantity: signal(EMPTY),
    note: signal(EMPTY),
  };
}

/** What the server said about the last attempt to send the form. */
interface Submission {
  readonly errors: Signal<FieldErrors>;
  readonly pending: Signal<boolean>;
  readonly createdId: Signal<number>;
}

function createSubmission(): Submission {
  return {
    errors: signal(NO_ERRORS),
    pending: signal(false),
    createdId: signal(NO_ORDER),
  };
}

/** The transitions that only record what the person typed. */
type Typing = Pick<
  NewOrderState,
  'customersLoaded' | 'customerChosen' | 'quantityTyped' | 'noteTyped'
>;

function createTyping(fields: Fields): Typing {
  return {
    customersLoaded(rows: readonly Customer[]): void {
      fields.customers.set(rows);
    },

    customerChosen(id: number): void {
      fields.customerId.set(id);
    },

    quantityTyped(value: string): void {
      fields.quantity.set(value);
    },

    noteTyped(value: string): void {
      fields.note.set(value);
    },
  };
}

/** Clears the form and records the receipt in one commit, never half of it. */
function reset(fields: Fields, submission: Submission, id: number): void {
  batch(() => {
    submission.pending.set(false);
    fields.customerId.set(NO_CUSTOMER);
    fields.quantity.set(EMPTY);
    fields.note.set(EMPTY);
    submission.errors.set(NO_ERRORS);
    submission.createdId.set(id);
  });
}

/** Builds the module's state. Called once per mount, inside the mount's scope. */
export function createNewOrderState(): NewOrderState {
  const fields = createFields();
  const submission = createSubmission();
  const { customers, customerId, quantity, note } = fields;
  const { errors, pending, createdId } = submission;

  return {
    customers,
    customerId,
    quantity,
    note,
    errors,
    pending,
    createdId,
    wasCreated: computed(() => createdId() !== NO_ORDER),
    draft: computed(() => ({
      customerId: customerId(),
      quantity: Number(quantity()),
      note: note(),
    })),

    ...createTyping(fields),

    checked(): boolean {
      const found = validate(customerId(), quantity(), note());

      errors.set(found);

      return Object.keys(found).length === 0;
    },

    sending(): void {
      batch(() => {
        pending.set(true);
        errors.set(NO_ERRORS);
        createdId.set(NO_ORDER);
      });
    },

    created(id: number): void {
      reset(fields, submission, id);
    },

    rejected(found: FieldErrors): void {
      batch(() => {
        pending.set(false);
        errors.set(found);
      });
    },
  };
}
