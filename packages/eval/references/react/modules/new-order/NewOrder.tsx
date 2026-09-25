// The New Order form (T03): validated before sending, disabled while sending.
//
// Each field is its own component subscribed to its own slice of the store,
// which is how Zustand is meant to be read: typing in the note re-renders the
// note, and not the select, the quantity or the receipt.

import { useRef, type FormEvent, type JSX } from 'react';

import { useCustomers } from '../customers/index.ts';
import { useCreateOrder } from './new-order.queries.ts';
import { draftOf, useNewOrder } from './new-order.store.ts';

/** No message under a field, which is what an empty span reads as. */
const NO_MESSAGE = '';

/** The select's value when nothing has been chosen. */
const NO_CUSTOMER = '0';

/**
 * The message under one field. Rendered whether or not there is something to
 * say, so the element the task names is always in the page and only its text
 * changes.
 */
function FieldError({ field }: { readonly field: string }): JSX.Element {
  const message = useNewOrder((state) => state.errors[field] ?? NO_MESSAGE);

  return <span data-testid={`error-${field}`}>{message}</span>;
}

/** The customer select, offering the same list the Customers table reads. */
function CustomerField(): JSX.Element {
  const customers = useCustomers();
  const customerId = useNewOrder((state) => state.customerId);
  const chosen = useNewOrder((state) => state.customerChosen);

  return (
    <label>
      Customer
      <select
        data-testid="customer"
        value={String(customerId)}
        onChange={(event) => {
          chosen(Number(event.target.value));
        }}
      >
        <option value={NO_CUSTOMER}>Choose…</option>
        {(customers.data ?? []).map((customer) => (
          <option key={customer.id} value={String(customer.id)}>
            {customer.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuantityField(): JSX.Element {
  const quantity = useNewOrder((state) => state.quantity);
  const typed = useNewOrder((state) => state.quantityTyped);

  return (
    <label>
      Quantity
      <input
        data-testid="quantity"
        value={quantity}
        onChange={(event) => {
          typed(event.target.value);
        }}
      />
    </label>
  );
}

function NoteField(): JSX.Element {
  const note = useNewOrder((state) => state.note);
  const typed = useNewOrder((state) => state.noteTyped);

  return (
    <label>
      Note
      <textarea
        data-testid="note"
        value={note}
        onChange={(event) => {
          typed(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * The form.
 *
 * @example
 * <NewOrder />
 */
export function NewOrder(): JSX.Element {
  const create = useCreateOrder();

  // The guard that actually holds, and it cannot be `create.isPending`.
  // TanStack Query delivers a status change through its batched notifier, so
  // `isPending` — and the `disabled` attribute that follows it — is true a
  // microtask after `mutate` is called, which is later than the second half of
  // a double-click arrives. Measured: without this ref, one double-click sends
  // two orders while the button still reads enabled. The attribute below is
  // the affordance a person sees; this is the lock.
  const sending = useRef(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (sending.current) return;

    // Read at the moment of the press rather than from the render that
    // attached this handler, so what is validated is what the form holds now.
    const state = useNewOrder.getState();

    if (!state.checked()) return;

    sending.current = true;

    create.mutate(draftOf(state), {
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  return (
    <form data-testid="order-form" onSubmit={submit}>
      <h2>New Order</h2>

      <CustomerField />
      <FieldError field="customerId" />

      <QuantityField />
      <FieldError field="quantity" />

      <NoteField />
      <FieldError field="note" />
      <FieldError field="form" />

      <button data-testid="submit" type="submit" disabled={create.isPending}>
        Create order
      </button>

      {create.isSuccess ? <p data-testid="created">Order {create.data}</p> : null}
    </form>
  );
}
