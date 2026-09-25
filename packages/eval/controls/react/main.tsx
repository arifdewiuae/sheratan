// The composition root: the only place the contract meets an adapter. Every
// module above this line asks for `DeviceApi` and never learns which
// implementation it got, which is what makes a fake one in a test free.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
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
  <StrictMode>
    <QueryClientProvider client={client}>
      <DeviceApiContext value={api}>
        <Devices />
      </DeviceApiContext>
    </QueryClientProvider>
  </StrictMode>,
);
