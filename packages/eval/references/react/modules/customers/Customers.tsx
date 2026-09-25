// The Customers page (T01): loading, error or the table — never two at once.

import type { JSX } from 'react';

import type { Customer } from '../../services/api.contract.ts';
import { useCustomers } from './customers.queries.ts';

function Row({ customer }: { readonly customer: Customer }): JSX.Element {
  return (
    <tr data-testid="customer-row">
      <td>{customer.name}</td>
      <td>{customer.company}</td>
      <td>{customer.country}</td>
    </tr>
  );
}

function Table({ rows }: { readonly rows: readonly Customer[] }): JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Company</th>
          <th>Country</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((customer) => (
          <Row key={customer.id} customer={customer} />
        ))}
      </tbody>
    </table>
  );
}

function Failure({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <div data-testid="error" role="alert">
      <span>{message}</span>
      <button data-testid="retry" type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * One of the three, chosen by the query's status. React commits a render in
 * one pass, so what this returns is what the frame holds — which is how "only
 * one of loading, error or the table" is kept without any coordination.
 */
function Body(): JSX.Element {
  const customers = useCustomers();

  if (customers.isPending) return <p data-testid="loading">Loading…</p>;

  if (customers.isError) {
    return (
      <Failure
        message={customers.error.message}
        onRetry={() => {
          void customers.refetch();
        }}
      />
    );
  }

  return <Table rows={customers.data} />;
}

/**
 * The page.
 *
 * @example
 * <Customers />
 */
export function Customers(): JSX.Element {
  return (
    <section className="customers">
      <h2>Customers</h2>
      <Body />
    </section>
  );
}
