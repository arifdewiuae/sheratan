// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import type { Customer } from '../../services/api.contract.ts';
import type { CustomersState } from './customers.state.ts';

/** What this view asks the module to do. Intents are plain functions. */
export interface CustomersIntents {
  retry(this: void): void;
}

function row(customer: Accessor<Customer>): Template {
  // Every cell is a computed in the row, so a change writes one text node and
  // never rebuilds the row (SPEC §9).
  const name = computed(() => customer().name);
  const company = computed(() => customer().company);
  const country = computed(() => customer().country);

  return html`<tr data-testid="customer-row">
    <td>${name}</td>
    <td>${company}</td>
    <td>${country}</td>
  </tr>`;
}

function table(state: CustomersState): Template {
  return html`<table data-testid="customer-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Company</th>
        <th>Country</th>
      </tr>
    </thead>
    <tbody>
      ${each(state.rows, row)}
    </tbody>
  </table>`;
}

function failure(state: CustomersState, intents: CustomersIntents): Template {
  return html`<div data-testid="error" role="alert">
    <span>${state.error}</span>
    <button data-testid="retry" @click=${intents.retry}>Retry</button>
  </div>`;
}

/**
 * One hole, not three. Three would each be their own frame watcher, and a
 * retry would add the loader before the table's watcher removed the table —
 * two of them on screen in the same frame, which T01 forbids.
 */
function body(state: CustomersState, intents: CustomersIntents): Template {
  if (state.isLoading()) return html`<p data-testid="loading">Loading…</p>`;
  if (state.hasFailed()) return failure(state, intents);

  return table(state);
}

/** The Customers page (T01): loading, error or the table — never two at once. */
export function customersView(state: CustomersState, intents: CustomersIntents): Template {
  return html`<section class="customers">
    <h2>Customers</h2>
    ${() => body(state, intents)}
  </section>`;
}
