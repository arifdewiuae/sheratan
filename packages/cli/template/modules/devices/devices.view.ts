// View: a pure function of state (SPEC §4). It does no I/O, imports no
// effects, and declares the intents it needs — the effects object satisfies
// that shape structurally, so the view never learns what implements it.

import {
  computed,
  each,
  html,
  mount,
  type Accessor,
  type ModuleView,
  type Template,
} from 'sheratan';

import { LIST_HEIGHT_PX, ROW_HEIGHT_PX } from '../../lib/layout.ts';
import { devices as countOf } from '../../lib/units.ts';
import type { Device } from '../../services/devices.contract.ts';
import type { ReadingProps } from '../reading/index.ts';
import { EVERY_ROOM, Status, type DevicesState } from './devices.state.ts';

/** Published to CSS, so the stylesheet and the window arithmetic share one number. */
const LIST_STYLE = `--row-h:${String(ROW_HEIGHT_PX)}px;--list-h:${String(LIST_HEIGHT_PX)}px`;

/** The label the "every room" option carries. */
const EVERY_ROOM_LABEL = 'All rooms';

/**
 * What this view asks the module to do. Intents are plain functions, never
 * methods: the template receives the function itself, so `this` is never
 * involved — which is what `this: void` says out loud.
 */
export interface DevicesIntents {
  filterBy(this: void, room: string): void;
  /** Inside a row a handler is given the row's item as its second argument. */
  calibrate(this: void, payload: string, device: Device): void;
  retry(this: void): void;
}

/**
 * The child modules this view may place. A view constructs nothing and imports
 * no module (SHR-L001): effects builds the instances where their dependencies
 * already exist, and this interface is satisfied structurally.
 */
export interface DevicesScreens {
  readonly reading: ModuleView<ReadingProps>;
}

/** One device. Every cell is its own computed, so one new reading writes one cell. */
function deviceRow(
  state: DevicesState,
  intents: DevicesIntents,
  screens: DevicesScreens,
): (row: Accessor<Device>) => Template {
  return (row) => {
    const name = computed(() => row().name);
    const room = computed(() => row().room);
    const busy = computed(() => state.calibrating().includes(row().id));
    const label = computed(() => (row().calibrated ? 'Calibrated' : 'Calibrate'));

    // The live feed is folded separately from the board, so a reading is
    // looked up per row rather than merged into every device on every frame.
    const value = computed(() => state.readings()[row().id] ?? row().reading);

    return html`<li class="device">
      <span class="device-name">${name}</span>
      <span class="device-room">${room}</span>
      ${mount(screens.reading, { value, limits: state.limits })}
      <button type="button" class="calibrate" disabled=${busy} @click=${intents.calibrate}>
        ${label}
      </button>
    </li>`;
  };
}

/** The room filter, built from the rooms the current board actually has. */
function filter(state: DevicesState, intents: DevicesIntents): Template {
  const options = each(state.rooms, (room) => {
    const selected = computed(() => state.room() === room());

    return html`<option value=${room} .selected=${selected}>${room}</option>`;
  });

  const everySelected = computed(() => state.room() === EVERY_ROOM);

  return html`<label class="filter">
    Room
    <select @change=${intents.filterBy}>
      <option value=${EVERY_ROOM} .selected=${everySelected}>${EVERY_ROOM_LABEL}</option>
      ${options}
    </select>
  </label>`;
}

/** The list itself, windowed: only the rows you can see exist in the page. */
function list(state: DevicesState, intents: DevicesIntents, screens: DevicesScreens): Template {
  const rows = each(state.visible, deviceRow(state, intents, screens), state.rowWindow);

  return html`<ul class="devices" style=${LIST_STYLE}>
    ${rows}
  </ul>`;
}

/** The module's markup: a filter, a caption, and a windowed list of devices. */
export function devicesView(
  state: DevicesState,
  intents: DevicesIntents,
  screens: DevicesScreens,
): Template {
  const caption = computed(() => countOf(state.count()));

  const body = computed(() => {
    if (state.status() === Status.Loading) return html`<p class="note">Loading devices…</p>`;

    if (state.status() === Status.Failed) {
      const message = computed(() => state.error());

      return html`<p class="note error" role="alert">
        ${message}
        <button type="button" class="calibrate" @click=${intents.retry}>Try again</button>
      </p>`;
    }

    return list(state, intents, screens);
  });

  return html`<section class="module-devices" data-module="devices">
    <header class="head">
      <h1>Devices</h1>
      <p class="sub">${caption} reporting. Readings arrive live and are folded once a frame.</p>
    </header>

    ${filter(state, intents)} ${body}
  </section>`;
}
