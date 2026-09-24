// What `POST /api/orders` refuses, and the exact words it refuses with
// (EVAL-TASKS T03). Server-side only: the task asks the app to check the same
// things before sending, and the point of checking here too is that an app
// which skips its own validation still cannot write a bad order.

import { CUSTOMERS, NOTE_MAX, QUANTITY_MAX, QUANTITY_MIN } from './data.ts';

/** The body `POST /api/orders` accepts. */
export interface OrderDraft {
  readonly customerId: number;
  readonly quantity: number;
  readonly note?: string;
}

/** Field name to message, exactly as the 422 body carries it. */
export type Errors = Record<string, string>;

const MESSAGES = {
  customer: 'Choose a customer.',
  quantity: `Quantity must be a whole number between ${String(QUANTITY_MIN)} and ${String(QUANTITY_MAX)}.`,
  note: `Note must be ${String(NOTE_MAX)} characters or fewer.`,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function customerError(value: unknown): string | undefined {
  const known = CUSTOMERS.some((customer) => customer.id === value);

  return known ? undefined : MESSAGES.customer;
}

function quantityError(value: unknown): string | undefined {
  const ok =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= QUANTITY_MIN &&
    value <= QUANTITY_MAX;

  return ok ? undefined : MESSAGES.quantity;
}

function noteError(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;

  const ok = typeof value === 'string' && value.length <= NOTE_MAX;

  return ok ? undefined : MESSAGES.note;
}

/**
 * The fields `draft` gets wrong, or an empty object when it is acceptable.
 * Every field is checked, so one submit reports every problem at once.
 */
export function validateDraft(draft: unknown): Errors {
  if (!isRecord(draft)) return { customer: MESSAGES.customer, quantity: MESSAGES.quantity };

  const found: Errors = {};

  const checks = [
    ['customer', customerError(draft['customerId'])],
    ['quantity', quantityError(draft['quantity'])],
    ['note', noteError(draft['note'])],
  ] as const;

  for (const [field, message] of checks) {
    if (message !== undefined) found[field] = message;
  }

  return found;
}
