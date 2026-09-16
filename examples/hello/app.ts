// The composition root: the only place a contract meets an adapter (SPEC §4b).

import { render } from 'sheratan';

import { createDashboard } from './modules/dashboard/index.ts';
import { createSyntheticFeed } from './services/feed.synthetic.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

// 500 rows, 2000 values a second. Swap this line for a socket adapter and
// nothing else in the app changes.
render(createDashboard(createSyntheticFeed({ rows: 500, updatesPerSecond: 2000 })), host);
