// Client state: what the person typed, and what is wrong with it. Server state
// — the customer options, and the order that comes back — is not here; it
// lives in the TanStack Query cache, which is the split the two libraries
// exist to make.
//
// Nothing in this file does I/O, touches the DOM, or knows a component exists.

import { create } from 'zustand';

import type { OrderDraft } from '../../services/api.contract.ts';

/** The bounds T03 states. Rejected before a request is ever made. */
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1000;
const MAX_NOTE = 200;

/** No customer chosen, which is also the select's initial value. */
const NO_CUSTOMER = 0;

const EMPTY = '';

/** One message per field, keyed by field name, as the server sends them. */
export type FieldErrors = Readonly<Record<string, string>>;

const NO_ERRORS: FieldErrors = {};

function quantityError(value: string): string {
  const parsed = Number(value);

  if (value.trim() === EMPTY) return 'Quantity is required.';
  if (!Number.isInteger(parsed)) return 'Quantity must be a whole number.';

  if (parsed < MIN_QUANTITY || parsed > MAX_QUANTITY) {
    return `Quantity must be between ${String(MIN_QUANTITY)} and ${String(MAX_QUANTITY)}.`;
  }

  return EMPTY;
}

/**
 * Everything wrong with the draft, by field. Pure, and exported so it can be
 * read on its own terms rather than through the store.
 *
 * @example
 * validate(0, '5', ''); // { customerId: 'Choose a customer.' }
 */
export function validate(customerId: number, quantity: string, note: string): FieldErrors {
  const found: Record<string, string> = {};
  const quantityMessage = quantityError(quantity);

  if (customerId === NO_CUSTOMER) found['customerId'] = 'Choose a customer.';
  if (quantityMessage !== EMPTY) found['quantity'] = quantityMessage;

  if (note.length > MAX_NOTE) {
    found['note'] = `Note must be ${String(MAX_NOTE)} characters or fewer.`;
  }

  return found;
}

/** What the person typed, and the transitions that may change it. */
export interface NewOrderStore {
  readonly customerId: number;
  readonly quantity: string;
  readonly note: string;
  readonly errors: FieldErrors;

  readonly customerChosen: (id: number) => void;
  readonly quantityTyped: (value: string) => void;
  readonly noteTyped: (value: string) => void;
  /** Validates what is typed now, records the errors, and says whether to send. */
  readonly checked: () => boolean;
  /** What the server said about the draft, field by field. Keeps the fields. */
  readonly rejected: (errors: FieldErrors) => void;
  /** An accepted order: the form goes back to empty. */
  readonly cleared: () => void;
}

/** A fresh form. Exported so a test can put the store back between cases. */
export const INITIAL: Pick<NewOrderStore, 'customerId' | 'quantity' | 'note' | 'errors'> = {
  customerId: NO_CUSTOMER,
  quantity: EMPTY,
  note: EMPTY,
  errors: NO_ERRORS,
};

/**
 * The store. One per application, read with a selector so a component
 * re-renders only when the slice it asked for changes.
 *
 * @example
 * const quantity = useNewOrder((state) => state.quantity);
 */
export const useNewOrder = create<NewOrderStore>()((set, get) => ({
  ...INITIAL,

  customerChosen: (customerId) => set({ customerId }),

  quantityTyped: (quantity) => set({ quantity }),

  noteTyped: (note) => set({ note }),

  checked: () => {
    const { customerId, quantity, note } = get();
    const found = validate(customerId, quantity, note);

    set({ errors: found });

    return Object.keys(found).length === 0;
  },

  rejected: (errors) => set({ errors }),

  cleared: () => set(INITIAL),
}));

/** The draft as the contract wants it, derived from what is typed rather than stored. */
export function draftOf(state: NewOrderStore): OrderDraft {
  return { customerId: state.customerId, quantity: Number(state.quantity), note: state.note };
}
