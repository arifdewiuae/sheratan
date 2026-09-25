// The Orders list (T04): the badge moves before the server answers.

import type { JSX } from 'react';

import type { Order } from '../../services/api.contract.ts';
import { useOrders, useShipOrder } from './orders.queries.ts';

function Row({
  order,
  onShip,
}: {
  readonly order: Order;
  readonly onShip: () => void;
}): JSX.Element {
  return (
    <tr data-testid="order-row" data-order={order.id}>
      <td>{order.id}</td>
      <td>{order.customer}</td>
      <td>
        <span data-testid="status">{order.status}</span>
      </td>
      <td>
        <button data-testid="ship" type="button" onClick={onShip}>
          Mark Shipped
        </button>
      </td>
    </tr>
  );
}

/**
 * The list.
 *
 * @example
 * <Orders />
 */
export function Orders(): JSX.Element {
  const orders = useOrders();
  const ship = useShipOrder();

  return (
    <section className="orders">
      <h2>Orders</h2>
      <table>
        <tbody>
          {(orders.data ?? []).map((order) => (
            <Row
              key={order.id}
              order={order}
              onShip={() => {
                ship.mutate(order.id);
              }}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
