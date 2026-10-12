// The composition root: the only place a contract meets an adapter (SPEC §4b),
// and the one place the app's screens are named (SPEC §9b).

import { html, mount, render, routes } from 'sheratan';

import { createAlerts } from './modules/alerts/index.ts';
import { createDashboard } from './modules/dashboard/index.ts';
import { createNotFound } from './modules/not-found/index.ts';
import { createOrders } from './modules/orders/index.ts';
import { createMemoryAlerts } from './services/alerts.memory.ts';
import { createSyntheticFeed } from './services/feed.synthetic.ts';

const host = document.querySelector('#app');

if (host === null) throw new Error('#app is missing from the page');

// 500 rows, 20 000 values a second: enough that several land on the same row
// inside one frame, which is where coalescing becomes visible. Swap this line
// for a socket adapter and nothing else in the app changes.
const feed = createSyntheticFeed({ rows: 500, updatesPerSecond: 20_000 });

// One rule already kept, so asking for a second on the same metric shows what
// a refusal from the server looks like.
const alerts = createMemoryAlerts({ rules: [{ metric: 'latency', above: 1500, below: 1200 }] });

// Patterns are tried in this order. `/orders/:rest*` matches `/orders` and
// everything under it, so the orders module is one screen holding its own
// table of screens — a layout, without a second kind of thing to learn.
const screen = routes({
  '/': () => mount(createDashboard(feed)),
  '/orders/:rest*': () => mount(createOrders(feed)),
  '/alerts': () => mount(createAlerts(alerts)),
  '*': () => mount(createNotFound()),
});

render(() => html`${screen}`, host);
