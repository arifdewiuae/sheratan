// The module's only public surface. The order form's select needs the same
// list, and asks for it here rather than reaching into the query file.

export { Customers } from './Customers.tsx';
export { useCustomers } from './customers.queries.ts';
