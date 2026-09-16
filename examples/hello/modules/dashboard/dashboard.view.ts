// View: a pure function of state (SPEC §4). No I/O, no imports of effects.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import { compact, percent, signed } from '../../lib/format.ts';
import { ROW_HEIGHT_PX } from '../../lib/layout.ts';
import type { Metric } from '../../services/feed.contract.ts';
import { SortKey, Status, type DashboardState } from './dashboard.state.ts';

/** Bar width as a share of the feed's ceiling, so the table reads at a glance. */
const BAR_CEILING = 2000;

/** Published to CSS, so the stylesheet and the row height share one number. */
const ROW_HEIGHT_STYLE = `--row-h:${String(ROW_HEIGHT_PX)}px`;

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

  // A transform, not a width: scaling costs no layout, so the bar can be
  // tweened between frames instead of stepping once per value.
  const level = computed(
    () => `transform:scaleX(${String(Math.min(1, metric().value / BAR_CEILING))})`,
  );

  return html` <li class=${direction}>
    <span class="metric-name">${name}</span>
    <span class="metric-bar"><i style=${level}></i></span>
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

/** What the framework is, before any number is claimed for it. */
function intro(): Template {
  return html` <h1>A frontend framework with one legal way to structure an app.</h1>
    <ul class="values">
      <li>
        <b>No virtual DOM.</b> A number changes and the text node showing it is rewritten. Nothing
        else runs.
      </li>
      <li>
        <b>One shape for every feature</b> — state, effects, view, contract — enforced by a checker,
        not by review.
      </li>
      <li><b>Zero runtime dependencies</b>, about 4.8&nbsp;KB over the wire.</li>
    </ul>`;
}

function columns(): Template {
  return html` <li class="metric heading" aria-hidden="true">
    <span>metric</span>
    <span class="metric-bar-label">level</span>
    <span class="metric-value">value</span>
    <span class="metric-delta">change</span>
  </li>`;
}

function stats(state: DashboardState): Template {
  const fps = computed(() => (state.fps() === 0 ? '—' : compact(state.fps())));
  const rate = computed(() => compact(state.rate()));
  const skipped = computed(() => percent(state.skipped()));
  const rows = computed(() => String(state.rows().length));

  return html` <div class="tiles">
    ${tile('frames / sec', fps, 'headline')} ${tile('values in / sec', rate)}
    ${tile('updates skipped', skipped)} ${tile('rows live', rows)}
  </div>`;
}

/** One file of the module, and the rule that governs it. */
function entry(term: string, line: string): Template {
  return html` <li><code>${term}</code><span>${line}</span></li>`;
}

/** Where a developer goes after watching the numbers move. */
function guide(): Template {
  return html` <details class="guide" open>
    <summary class="label">Where to go next</summary>

    <p class="sub">
      This page is one Sheratan module. Four files, each with a single job — the shape every feature
      takes, and the shape the checker enforces.
    </p>

    <h3 class="label">The four files</h3>
    <ul class="entries">
      ${entry('dashboard.state.ts', 'Everything the feature knows, and the only functions allowed to change it. No network, no DOM — so the whole feature can be tested without a browser.')}
      ${entry('dashboard.effects.ts', 'The only file that touches the outside world. It calls the feed and hands the result to one transition, which puts everything that can fail in one place.')}
      ${entry('dashboard.view.ts', 'The markup, as a function of that state. It cannot fetch, write state or reach the DOM, so a wrong number on screen is always a wrong number in state.')}
      ${entry('feed.contract.ts', 'What the module asks for, never how it arrives. Swap the live socket for a fake one in a test and nothing above this line notices.')}
    </ul>

    <h3 class="label">Three ideas, and you can read the rest</h3>
    <ul class="entries">
      ${entry('signal', 'A value you can change. It keeps track of which parts of the page read it, so writing a new value updates exactly those parts and nothing else — no diffing, no re-render.')}
      ${entry('computed', 'A value worked out from other values. It recalculates itself when its sources change, so it can never be stale and you never write the code that keeps it in sync.')}
      ${entry('each', 'A list matched up by id. A row is built once when it appears and then only its changed cells are rewritten — which is why 500 rows cost 500 rows once, not once per update.')}
    </ul>

    <p class="hint">
      <code>pnpm --filter example-hello dev</code> runs this page · <code>llms.txt</code> is the
      whole API on one screen · <code>Docs/SPEC.md §4</code> is the module shape
    </p>
  </details>`;
}

/** The module's markup: stat tiles over a live, self-sorting table. */
export function dashboardView(state: DashboardState, intents: DashboardIntents): Template {
  const body = computed(() => {
    if (state.status() === Status.Loading) return html`<p class="note">Connecting…</p>`;

    if (state.status() === Status.Failed) {
      const message = computed(() => state.error());

      return html`<p class="note error" role="alert">Feed stopped: ${message}</p>`;
    }

    return html`<ul class="metrics" style=${ROW_HEIGHT_STYLE}>
      ${columns()} ${each(state.visible, row)}
    </ul>`;
  });

  return html` <section class="app" data-module="dashboard">
    <header class="head">${lockup()} ${intro()}</header>

    <section class="demo">
      <h2 class="label">Live metrics</h2>
      <p class="sub">
        Five hundred rows, twenty thousand new values every second, and the page holds sixty frames
        a second while you read it. Many of those values land on a row that already shows that
        number, so Sheratan skips them: skipped work is why the frame rate holds.
      </p>

      ${stats(state)} ${controls(state, intents)} ${body}
    </section>

    ${guide()}
  </section>`;
}
