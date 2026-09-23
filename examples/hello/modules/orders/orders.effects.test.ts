// Effects is handed a fake contract, run, and asked which transition it
// invoked (SPEC §4). The DOM is here only to give the effects an owner:
// `onDispose` belongs to a mount, so a test that wants teardown mounts.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Window } from 'happy-dom';
import { html, render, type Disposer } from 'sheratan';

import type { FeedApi, Metric, Tick } from '../../services/feed.contract.ts';
import { createOrdersEffects } from './orders.effects.ts';
import { createOrdersState, Status, type OrdersState } from './orders.state.ts';

const window = new Window();

globalThis.document = window.document as unknown as Document;

let host: Element;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

const ROWS: readonly Metric[] = [{ id: 1, name: 'alpha', value: 10, delta: 0 }];

/** Lets a pending promise and its `.then` run before the assertions. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A contract that answers however the test needs it to. */
function feedThat(answer: (signal: AbortSignal) => Promise<readonly Metric[]>): FeedApi {
  return {
    snapshot: answer,
    subscribe: (_onBatch: (ticks: readonly Tick[]) => void, _signal: AbortSignal): void => {},
  };
}

/** Mounts the effects so they have an owner, and hands back both halves. */
function mounted(feed: FeedApi): { readonly state: OrdersState; readonly stop: Disposer } {
  const state = createOrdersState();

  const stop = render(() => {
    createOrdersEffects(feed, state).start();

    return html`<p>orders</p>`;
  }, host);

  return { state, stop };
}

test('a snapshot reaches state through one transition', async () => {
  const { state, stop } = mounted(feedThat(async () => ROWS));

  await settled();

  assert.equal(state.status(), Status.Ready);
  assert.equal(state.count(), 1);

  stop();
});

test('a refusal becomes a reported failure, not a thrown one', async () => {
  const { state, stop } = mounted(
    feedThat(async () => {
      throw new Error('the feed said no');
    }),
  );

  await settled();

  assert.equal(state.status(), Status.Failed);
  assert.equal(state.error(), 'the feed said no');

  stop();
});

test('unmounting aborts the request, and a late refusal is not reported', async () => {
  let seen: AbortSignal | undefined;

  const { state, stop } = mounted(
    feedThat(async (signal) => {
      seen = signal;

      await settled();

      throw new Error('too late to matter');
    }),
  );

  stop();
  await settled();

  assert.equal(seen?.aborted, true, 'the contract was handed a signal, and unmounting aborted it');
  assert.equal(state.status(), Status.Loading, 'a module that went away reports nothing');
});
