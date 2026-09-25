// The composition root: the only place the contract meets an adapter. Every
// module above this line asks for `DeviceApi` and never learns which
// implementation it got, which is what makes a fake one in a test free.
//
// There is deliberately no `StrictMode`. It is a development-time diagnostic
// that mounts, unmounts and remounts every component, and the second mount
// refetches: measured at two `GET /api/customers` for one page load against
// the reference app. Several Week 0 assertions count requests — "exactly one
// new request" is in the frozen task text — so an arm served this way would
// fail them for a reason that is not the app, and the comparison would be
// scoring React's dev tooling instead of React. The Sheratan arm's dev server
// does not double-mount, and EVAL-TASKS §1.1 is what says the two arms must be
// equally live. Same reason HMR is off in `vite.config.ts`.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { Devices } from './modules/devices/index.ts';
import { DeviceApiContext } from './services/devices.context.ts';
import { createFixtureDevices } from './services/devices.fixture.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

// Swap this one line for an HTTP or socket adapter and nothing else in the app
// changes. The fixture is deliberately the default, so a fresh clone runs with
// no server to start.
const api = createFixtureDevices();

const client = new QueryClient();

createRoot(host).render(
  <QueryClientProvider client={client}>
    <DeviceApiContext value={api}>
      <Devices />
    </DeviceApiContext>
  </QueryClientProvider>,
);
