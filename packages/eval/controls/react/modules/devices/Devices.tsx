// The module's markup: a filter, a caption, and a windowed list of devices.
// Pure functions of what the store and the query cache hold — the components
// here do no I/O of their own, they call the hooks in `devices.queries.ts`.

import type { CSSProperties, JSX } from 'react';

import { LIST_HEIGHT_PX, ROW_HEIGHT_PX } from '../../lib/layout.ts';
import { devices as countOf } from '../../lib/units.ts';
import type { Device, Limits } from '../../services/devices.contract.ts';
import { Reading } from '../reading/index.ts';
import { useBoard, useCalibrate, useLiveReadings, type Board } from './devices.queries.ts';
import { byName, EVERY_ROOM, roomsOf, rowWindowOf, useDevicesStore } from './devices.store.ts';

/** Published to CSS, so the stylesheet and the window arithmetic share one number. */
const LIST_STYLE = {
  '--row-h': `${String(ROW_HEIGHT_PX)}px`,
  '--list-h': `${String(LIST_HEIGHT_PX)}px`,
} as CSSProperties;

/** The label the "every room" option carries. */
const EVERY_ROOM_LABEL = 'All rooms';

/** The room filter, built from the rooms the current board actually has. */
function RoomFilter({ rooms }: { readonly rooms: readonly string[] }): JSX.Element {
  const room = useDevicesStore((state) => state.room);
  const filtered = useDevicesStore((state) => state.filtered);

  return (
    <label className="filter">
      Room
      <select value={room} onChange={(event) => filtered(event.currentTarget.value)}>
        <option value={EVERY_ROOM}>{EVERY_ROOM_LABEL}</option>
        {rooms.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One device. It subscribes to its own slices, so one new reading re-renders one row. */
function DeviceRow({ device, limits }: { readonly device: Device; readonly limits: Limits }): JSX.Element {
  const busy = useDevicesStore((state) => state.calibrating.includes(device.id));
  const live = useDevicesStore((state) => state.readings[device.id]);
  const calibrate = useCalibrate();

  return (
    <li className="device">
      <span className="device-name">{device.name}</span>
      <span className="device-room">{device.room}</span>
      <Reading value={live ?? device.reading} limits={limits} />
      <button
        type="button"
        className="calibrate"
        disabled={busy}
        onClick={() => calibrate.mutate(device.id)}
      >
        {device.calibrated ? 'Calibrated' : 'Calibrate'}
      </button>
    </li>
  );
}

/** The list itself, windowed: only the rows you can see exist in the page. */
function DeviceList({ board }: { readonly board: Board }): JSX.Element {
  const scrollTop = useDevicesStore((state) => state.scrollTop);
  const scrolled = useDevicesStore((state) => state.scrolled);

  const rows = byName(board.devices);
  const { start, count } = rowWindowOf(scrollTop);
  const first = Math.min(Math.max(0, start), rows.length);
  const shown = rows.slice(first, first + count);

  // Spacers stand in for the rows that are not in the DOM, so the scrollbar
  // is the size the whole list would be.
  return (
    <ul
      className="devices"
      style={LIST_STYLE}
      onScroll={(event) => scrolled(event.currentTarget.scrollTop)}
    >
      <li role="presentation" style={{ height: first * ROW_HEIGHT_PX }} />
      {shown.map((device) => (
        <DeviceRow key={device.id} device={device} limits={board.limits} />
      ))}
      <li
        role="presentation"
        style={{ height: (rows.length - first - shown.length) * ROW_HEIGHT_PX }}
      />
    </ul>
  );
}

/** What the screen shows while the board is loading, failing, or ready. */
function DevicesBody(): JSX.Element {
  const board = useBoard();

  if (board.isPending) return <p className="note">Loading devices…</p>;

  if (board.isError) {
    return (
      <p className="note error" role="alert">
        {board.error.message}
        <button type="button" className="calibrate" onClick={() => void board.refetch()}>
          Try again
        </button>
      </p>
    );
  }

  return <DeviceList board={board.data} />;
}

/** The module root. */
export function Devices(): JSX.Element {
  const board = useBoard();

  useLiveReadings();

  const all = board.data?.devices ?? [];

  return (
    <section className="module-devices" data-module="devices">
      <header className="head">
        <h1>Devices</h1>
        <p className="sub">{countOf(all.length)} reporting. Readings arrive live.</p>
      </header>

      <RoomFilter rooms={roomsOf(all)} />
      <DevicesBody />
    </section>
  );
}
