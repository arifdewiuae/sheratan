// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import type { Customer } from '../../services/api.contract.ts';
import type { NewOrderState } from './new-order.state.ts';

/** What this view asks the module to do. Intents are plain functions. */
export interface NewOrderIntents {
  submit(this: void): void;
  chooseCustomer(this: void, value: string): void;
  typeQuantity(this: void, value: string): void;
  typeNote(this: void, value: string): void;
}

const NO_MESSAGE = '';

function option(customer: Accessor<Customer>): Template {
  const id = computed(() => String(customer().id));
  const name = computed(() => customer().name);

  return html`<option value=${id}>${name}</option>`;
}

/**
 * The message under one field, or nothing. A hole receives the accessor, never
 * its call, so only this node rewrites when the message changes (SHR-V003).
 */
function fieldError(state: NewOrderState, field: string): Template {
  const message = computed(() => state.errors()[field] ?? NO_MESSAGE);

  return html`<span data-testid=${`error-${field}`}>${message}</span>`;
}

/** The New Order form (T03): validated before sending, disabled while sending. */
export function newOrderView(state: NewOrderState, intents: NewOrderIntents): Template {
  const chosen = computed(() => String(state.customerId()));

  return html`<form data-testid="order-form" @submit=${intents.submit}>
    <h2>New Order</h2>

    <label>
      Customer
      <select data-testid="customer" .value=${chosen} @change=${intents.chooseCustomer}>
        <option value="0">Choose…</option>
        ${each(state.customers, option)}
      </select>
    </label>
    ${fieldError(state, 'customerId')}

    <label>
      Quantity
      <input data-testid="quantity" .value=${state.quantity} @input=${intents.typeQuantity} />
    </label>
    ${fieldError(state, 'quantity')}

    <label>
      Note
      <textarea data-testid="note" .value=${state.note} @input=${intents.typeNote}></textarea>
    </label>
    ${fieldError(state, 'note')} ${fieldError(state, 'form')}

    <button data-testid="submit" type="submit" .disabled=${state.pending}>Create order</button>

    ${() =>
      state.wasCreated()
        ? html`<p data-testid="created">Order ${computed(() => String(state.createdId()))}</p>`
        : null}
  </form>`;
}
