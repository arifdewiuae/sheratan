// Boots the host app against the real backend.
//
// `app.ts` beside this file is the self-repair eval's, byte for byte: it
// composes the four modules and never learns where their data comes from.
// This is the one file that decides, and the one file that eval never sees —
// which is why it is here and not in `hosts/`.

import { render } from 'sheratan';

import { createApp } from './app.ts';
import { createHttpApi } from './services/api.http.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

render(createApp(createHttpApi()), host);
