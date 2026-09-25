// The composition root: the only place the contract meets an adapter, and the
// only file that knows the whole page.
//
// There is no `StrictMode` here, and its absence is the considered choice.
// StrictMode is a development-time diagnostic: it mounts, unmounts and remounts
// every component, which makes each query fetch twice — measured, not assumed,
// at two `GET /api/customers` for one page load. Three of the twelve Week 0
// assertions count requests, so an arm served that way fails them for a reason
// that has nothing to do with the app, and a run would be scoring React's dev
// tooling rather than React. `controls/react` boots the same way, for the same
// reason, and EVAL-TASKS §1.1 is what says both arms must be equally live.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { Customers } from './modules/customers/index.ts';
import { NewOrder } from './modules/new-order/index.ts';
import { Notifications } from './modules/notifications/index.ts';
import { Orders } from './modules/orders/index.ts';
import { ApiContext } from './services/api.context.ts';
import { createHttpApi } from './services/api.http.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

const client = new QueryClient();

createRoot(host).render(
  <QueryClientProvider client={client}>
    <ApiContext value={createHttpApi()}>
      <div data-testid="app">
        <Notifications />
        <Customers />
        <NewOrder />
        <Orders />
      </div>
    </ApiContext>
  </QueryClientProvider>,
);
