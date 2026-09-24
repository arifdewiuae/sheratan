// The composition root: the only place a contract meets an adapter (SPEC §4b).
// Every module above this line asks for `DeviceApi` and never learns which
// implementation it got, which is what makes a fake one in a test free.

import { render } from 'sheratan';

import { createDevices } from './modules/devices/index.ts';
import { createFixtureDevices } from './services/devices.fixture.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

// Swap this one line for an HTTP or socket adapter and nothing else in the app
// changes. The fixture is deliberately the default, so a fresh clone runs with
// no server to start.
const devices = createFixtureDevices();

render(createDevices(devices), host);
