// `/ws/prices` — the seeded feed (EVAL-TASKS §1.3, T05). The framing is
// hand-written, so these tests also stand in for a library's own test suite:
// if a browser cannot read what `frames.ts` writes, every live-data task fails
// for a reason no task prompt would explain.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { INSTRUMENTS } from '../src/data.ts';
import { startEvalkit, type Evalkit } from '../src/server.ts';

let kit: Evalkit;

/** A price message, as EVAL-TASKS §6 fixes it. */
interface PriceMessage {
  readonly type: string;
  readonly symbol?: string;
  readonly price?: number;
  readonly ts?: number;
}

const OPEN_TIMEOUT_MS = 4000;

function socketUrl(kitUrl: string): string {
  return `${kitUrl.replace('http://', 'ws://')}/ws/prices`;
}

/** Opens a socket and collects the first `count` messages, then closes it. */
async function collect(
  count: number,
  onOpen?: (socket: WebSocket) => void,
): Promise<PriceMessage[]> {
  const socket = new WebSocket(socketUrl(kit.url));
  const seen: PriceMessage[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket never opened')), OPEN_TIMEOUT_MS);

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('socket errored'));
    });
  });

  onOpen?.(socket);

  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, OPEN_TIMEOUT_MS);

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      seen.push(JSON.parse(event.data) as PriceMessage);

      if (seen.length >= count) {
        clearTimeout(done);
        resolve();
      }
    });

    socket.addEventListener('close', () => {
      clearTimeout(done);
      resolve();
    });
  });

  socket.close();

  return seen;
}

before(async () => {
  kit = await startEvalkit();
});

afterEach(async () => {
  kit.reset();

  // Let the closing sockets finish leaving before the next test counts them.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

after(async () => {
  await kit.close();
});

describe('the feed', () => {
  test('pushes price messages in the shape the contract fixes', async () => {
    const seen = await collect(INSTRUMENTS.length);

    assert.equal(seen.length, INSTRUMENTS.length);

    for (const message of seen) {
      assert.equal(message.type, 'price');
      assert.ok(INSTRUMENTS.some((one) => one.symbol === message.symbol));
      assert.equal(typeof message.price, 'number');
      assert.equal(typeof message.ts, 'number');
    }
  });

  test('covers every instrument in the first tick', async () => {
    const seen = await collect(INSTRUMENTS.length);
    const symbols = new Set(seen.map((message) => message.symbol));

    assert.equal(symbols.size, INSTRUMENTS.length);
  });

  test('the same seed replays the same prices', async () => {
    const COUNT = 9;
    const first = await collect(COUNT);

    kit.reset();

    const second = await collect(COUNT);

    assert.deepEqual(
      second.map((message) => message.price),
      first.map((message) => message.price),
    );
  });
});

describe('what a run can do to it', () => {
  test('drop closes the socket', async () => {
    const socket = new WebSocket(socketUrl(kit.url));

    await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));

    const closed = new Promise<void>((resolve) =>
      socket.addEventListener('close', () => resolve()),
    );

    await fetch(`${kit.url}/__control/drop`, { method: 'POST' });
    await closed;

    assert.equal(socket.readyState, WebSocket.CLOSED);
  });

  test('expire tells an open socket the session ended', async () => {
    const seen = await collect(1, () => {
      void fetch(`${kit.url}/__control/expire`, { method: 'POST' });
    });

    assert.ok(
      seen.some((message) => message.type === 'session_expired'),
      `saw ${JSON.stringify(seen)}`,
    );
  });
});

test('an upgrade on any other path is refused', async () => {
  const socket = new WebSocket(`${kit.url.replace('http://', 'ws://')}/ws/nope`);

  await new Promise<void>((resolve) => {
    socket.addEventListener('error', () => resolve());
    socket.addEventListener('close', () => resolve());
  });

  assert.notEqual(socket.readyState, WebSocket.OPEN);
});
