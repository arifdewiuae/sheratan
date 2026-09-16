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

/** The brand lockup: the mark, a hairline, the wordmark. */
function lockup(): Template {
  return html` <a
    class="lockup"
    href="https://github.com/arifdewiuae/sheratan"
    aria-label="sheratan"
  >
    <svg viewBox="-8 -8 80 80" width="44" height="44" fill="none" aria-hidden="true">
      <path
        d="M8 48 Q33 38 56 16"
        stroke="currentColor"
        stroke-opacity="0.3"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <circle cx="8" cy="48" r="1.4" fill="currentColor" />
      <circle cx="30.5" cy="37.2" r="3.2" fill="currentColor" />
      <circle cx="56" cy="16" r="2" fill="currentColor" />
    </svg>
    <span class="rule"></span>
    <span class="wordmark">sheratan</span>
  </a>`;
}

function columns(): Template {
  return html` <li class="metric heading" aria-hidden="true">
    <span>metric</span>
    <span>level</span>
    <span class="metric-value">value</span>
    <span class="metric-delta">change</span>
  </li>`;
}

function stats(state: DashboardState): Template {
  const rate = computed(() => compact(state.rate()));
  const writeRate = computed(() => compact(state.writeRate()));
  const rows = computed(() => String(state.rows().length));
  const applied = computed(() => compact(state.applied()));

  return html` <div class="tiles">
    ${tile('values in / sec', rate, 'headline')} ${tile('rows rewritten / sec', writeRate)}
    ${tile('rows live', rows)} ${tile('values received', applied)}
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
      ${columns()} ${each(state.visible, row)}
    </ul>`;
  });

  return html` <section class="app" data-module="dashboard">
    <header class="head">
      ${lockup()}
      <h1>Live metrics</h1>
      <p class="sub">
        The feed sends 20 000 values a second across 500 rows. Several land on the same row inside
        one frame, so only the rows that really changed are rewritten: the gap between the first two
        numbers is the work the framework did not do.
      </p>
    </header>

    ${stats(state)} ${controls(state, intents)} ${body}
  </section>`;
}
