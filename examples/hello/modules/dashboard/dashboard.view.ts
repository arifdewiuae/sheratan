// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import { compact, signed } from '../../lib/format.ts';
import type { Metric } from '../../services/feed.contract.ts';
import { SortKey, Status, type DashboardState } from './dashboard.state.ts';

/** Bar width as a share of a sensible ceiling, so the table reads at a glance. */
const BAR_CEILING = 1600;
const FULL = 100;

/**
 * What this view asks the module to do. Intents are plain functions, never
 * methods: the template receives the function itself, so `this` is never
 * involved — which is what `this: void` says out loud.
 */
export interface DashboardIntents {
  toggleLive(this: void): void;
  sortBy(this: void, value: string): void;
}

function tile(label: string, value: Accessor<string>, tone = ''): Template {
  // The whole attribute value, never a fragment of one (SHR-R003).
  const classes = tone === '' ? 'tile' : `tile ${tone}`;

  return html` <div class=${classes}>
    <span class="tile-label">${label}</span>
    <strong class="tile-value">${value}</strong>
  </div>`;
}

function row(metric: Accessor<Metric>): Template {
  // Every cell is a computed in the row, so a value change writes one text
  // node and never rebuilds the row (SPEC §9).
  const name = computed(() => metric().name);
  // Exact, not compact: the point of the row is that you can watch it move.
  const value = computed(() => String(metric().value));
  const delta = computed(() => signed(metric().delta));

  const direction = computed(() => {
    const change = metric().delta;

    if (change > 0) return 'metric up';
    if (change < 0) return 'metric down';

    return 'metric';
  });

  const width = computed(
    () => `width:${String(Math.min(FULL, (metric().value / BAR_CEILING) * FULL))}%`,
  );

  return html` <li class=${direction}>
    <span class="metric-name">${name}</span>
    <span class="metric-bar"><i style=${width}></i></span>
    <span class="metric-value">${value}</span>
    <span class="metric-delta">${delta}</span>
  </li>`;
}

function controls(state: DashboardState, intents: DashboardIntents): Template {
  const label = computed(() => (state.live() ? 'Pause' : 'Resume'));
  const byValue = computed(() => state.sortedBy() === SortKey.Value);
  const byName = computed(() => state.sortedBy() === SortKey.Name);

  return html` <div class="controls">
    <button type="button" class="toggle" @click=${intents.toggleLive}>${label}</button>
    <label class="sort">
      Sort by
      <select @change=${intents.sortBy}>
        <option value="value" .selected=${byValue}>Value</option>
        <option value="name" .selected=${byName}>Name</option>
      </select>
    </label>
  </div>`;
}

function stats(state: DashboardState): Template {
  const rate = computed(() => compact(state.rate()));
  const applied = computed(() => compact(state.applied()));
  const rows = computed(() => String(state.rows().length));
  const rising = computed(() => `${String(state.rising())} rising`);

  return html` <div class="tiles">
    ${tile('values / second', rate, 'headline')} ${tile('values applied', applied)}
    ${tile('rows', rows)} ${tile('direction', rising)}
  </div>`;
}

/** The module's markup: stat tiles over a live, self-sorting table. */
export function dashboardView(state: DashboardState, intents: DashboardIntents): Template {
  const body = computed(() => {
    if (state.status() === Status.Loading) return html`<p class="note">Connecting…</p>`;

    if (state.status() === Status.Failed) {
      const message = computed(() => state.error());

      return html`<p class="note error" role="alert">Feed stopped: ${message}</p>`;
    }

    return html`<ul class="metrics">
      ${each(state.visible, row)}
    </ul>`;
  });

  return html` <section class="app" data-module="dashboard">
    <header class="head">
      <h1>Live metrics</h1>
      <p class="sub">500 rows, 2000 values a second. Sort by value to watch the order churn.</p>
    </header>

    ${stats(state)} ${controls(state, intents)} ${body}
  </section>`;
}
