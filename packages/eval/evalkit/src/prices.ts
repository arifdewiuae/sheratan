// `/ws/prices` — the seeded price feed (EVAL-TASKS §1.3, T05). Every open
// socket gets the same message at the same tick, generated from one seeded
// walk, so two arms watching the same run see the same numbers.

import type { Duplex } from 'node:stream';

import { INSTRUMENTS } from './data.ts';
import { closeFrame, isClose, readFrame, upgrade } from './frames.ts';

/** Ticks a second, until a run asks for another rate. */
export const DEFAULT_RATE = 10;

const MS_PER_SECOND = 1000;

/** mulberry32, so a run's prices are a function of its seed and nothing else. */
const MIX_1 = 0x6d2b_79f5;
const MIX_2 = 61;
const MIX_3 = 7;
const MIX_4 = 14;
const MIX_5 = 15;
const SHIFT_32 = 4_294_967_296;

/** How far a price may move in one tick, as a fraction of its own value. */
const STEP = 0.004;

/** `random()` gives 0..1; this turns it into a move either way. */
const SPAN = 2;

const CENTS = 100;
const HALF = 0.5;

function random(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + MIX_1) | 0;

    let mixed = state;

    mixed = Math.imul(mixed ^ (mixed >>> MIX_5), 1 | mixed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> MIX_3), MIX_2 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> MIX_4)) >>> 0) / SHIFT_32;
  };
}

/** One price message, exactly as EVAL-TASKS §6 fixes it. */
interface PriceMessage {
  readonly type: 'price';
  readonly symbol: string;
  readonly price: number;
  readonly ts: number;
}

/** A connected client and the one thing we do to it. */
interface Client {
  readonly socket: Duplex;
  readonly send: (text: string) => void;
}

/** What the feed exposes to the rest of the server. */
export interface Prices {
  /** Takes over a newly upgraded connection. */
  attach(socket: Duplex, key: string): void;
  /** Closes every open socket, as a dropped network would. */
  drop(): void;
  /** Pushes `{ type: "session_expired" }` to everyone still connected. */
  announceExpiry(): void;
  /** Ticks per second from now on. */
  setRate(ticksPerSecond: number): void;
  /** Back to tick zero and the opening prices, for `/__control/reset`. */
  reset(): void;
  open(): number;
  pushed(): number;
  /** Stops the clock, so a closed server does not keep the process alive. */
  stop(): void;
}

/** The connected clients, and what has been sent to them. */
interface Room {
  readonly clients: Set<Client>;
  broadcast(text: string): void;
  pushed(): number;
  clear(): void;
}

function createRoom(): Room {
  const clients = new Set<Client>();

  let pushed = 0;

  return {
    clients,

    broadcast(text) {
      for (const client of clients) client.send(text);

      pushed += clients.size;
    },

    pushed: () => pushed,
    clear: () => void (pushed = 0),
  };
}

/** The seeded walk, kept separate from who happens to be watching it. */
interface Walk {
  step(symbol: string): number;
  restart(): void;
}

function createWalk(seed: number): Walk {
  const prices = new Map(INSTRUMENTS.map((one) => [one.symbol, one.open]));

  let next = random(seed);

  return {
    step(symbol) {
      const current = prices.get(symbol) ?? 0;
      const moved = current * (1 + (next() - HALF) * STEP * SPAN);
      const rounded = Math.round(moved * CENTS) / CENTS;

      prices.set(symbol, rounded);

      return rounded;
    },

    restart() {
      next = random(seed);

      for (const instrument of INSTRUMENTS) prices.set(instrument.symbol, instrument.open);
    },
  };
}

/** Runs `emit` on a clock, but only while there is somebody to emit to. */
interface Ticker {
  /** Starts, stops or re-spaces the clock to match the room and the rate. */
  retime(): void;
  halt(): void;
  setRate(ticksPerSecond: number): void;
  reset(): void;
}

/**
 * The clock. It runs only while somebody is listening: a timer ticking against
 * an empty room would advance the walk, so the same seed would hand two runs
 * different numbers purely because their apps connected at different moments.
 */
function createTicker(emit: () => void, listeners: () => number): Ticker {
  let rate = DEFAULT_RATE;
  let timer: NodeJS.Timeout | undefined;

  const halt = (): void => {
    if (timer !== undefined) clearInterval(timer);

    timer = undefined;
  };

  const retime = (): void => {
    halt();

    if (listeners() === 0) return;

    timer = setInterval(emit, MS_PER_SECOND / rate);
    timer.unref();
  };

  return {
    retime,
    halt,

    setRate(ticksPerSecond) {
      rate = ticksPerSecond;
      retime();
    },

    reset() {
      rate = DEFAULT_RATE;
      retime();
    },
  };
}

/** One tick: every instrument, in order, to everybody in the room. */
function tickInto(room: Room, walk: Walk, ts: number): void {
  for (const instrument of INSTRUMENTS) {
    const message: PriceMessage = {
      type: 'price',
      symbol: instrument.symbol,
      price: walk.step(instrument.symbol),
      ts,
    };

    room.broadcast(JSON.stringify(message));
  }
}

/** Who is let in, who is shown out, and the bookkeeping either one needs. */
interface Door {
  attach(socket: Duplex, key: string): void;
  /** Closes every open socket, writing a close frame first. */
  closeAll(): void;
}

function createDoor(room: Room, ticker: Ticker): Door {
  const forget = (client: Client): void => {
    room.clients.delete(client);
    client.socket.destroy();
    ticker.retime();
  };

  const leave = (client: Client): void => {
    room.clients.delete(client);
    ticker.retime();
  };

  const listen = (socket: Duplex, client: Client): void => {
    socket.on('data', (chunk: Buffer) => {
      const frame = readFrame(chunk);

      if (frame !== undefined && isClose(frame)) forget(client);
    });

    socket.on('close', () => leave(client));
    socket.on('error', () => leave(client));
  };

  return {
    attach(socket, key) {
      const client: Client = { socket, send: upgrade(socket, key) };

      room.clients.add(client);
      ticker.retime();
      listen(socket, client);
    },

    closeAll() {
      for (const client of room.clients) {
        if (!client.socket.destroyed) client.socket.write(closeFrame());

        forget(client);
      }
    },
  };
}

/**
 * The price feed. `seed` fixes the walk; `ts` is a tick counter rather than a
 * clock reading, because a wall-clock timestamp would make two runs of the
 * same seed differ in their payloads.
 */
export function createPrices(seed: number): Prices {
  const room = createRoom();
  const walk = createWalk(seed);

  let tick = 0;

  const ticker = createTicker(
    () => {
      tick += 1;

      tickInto(room, walk, tick);
    },
    () => room.clients.size,
  );

  const door = createDoor(room, ticker);

  return {
    attach: (socket, key) => door.attach(socket, key),
    drop: () => door.closeAll(),
    announceExpiry: () => room.broadcast(JSON.stringify({ type: 'session_expired' })),
    setRate: (ticksPerSecond) => ticker.setRate(ticksPerSecond),

    reset() {
      walk.restart();
      room.clear();

      tick = 0;

      ticker.reset();
    },

    open: () => room.clients.size,
    pushed: () => room.pushed(),

    stop() {
      door.closeAll();
      ticker.halt();
    },
  };
}
