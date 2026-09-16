// Effects are the only place a fake transport is needed (SPEC §4 Tests).
import { test, beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { Window } from 'happy-dom';
import { html, render } from 'sheratan';

import type { FeedApi, Metric, Tick } from '../../services/feed.contract.ts';
import { createDashboardEffects, type DashboardEffects } from './dashboard.effects.ts';
import { createDashboardState, SortKey, Status, type DashboardState } from './dashboard.state.ts';

const window = new Window();

globalThis.document = window.document as unknown as Document;

let host: Element;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const metric = (id: number, name: string, value: number): Metric => ({ id, name, value, delta: 0 });

interface Fake {
  api: FeedApi;
  /** Pushes a batch the way a live feed would. */
  emit(ticks: readonly Tick[]): void;
  aborted(): boolean;
}

function fakeFeed(snapshot: () => Promise<readonly Metric[]>): Fake {
  const handlers: ((ticks: readonly Tick[]) => void)[] = [];
  const signals: AbortSignal[] = [];

  return {
    api: {
      snapshot: async (signal) => {
        signals.push(signal);

        return snapshot();
      },
      subscribe: (onBatch, signal) => {
        handlers.push(onBatch);
        signals.push(signal);
      },
    },
    emit: (ticks) => {
      for (const handler of handlers) handler(ticks);
    },
    aborted: () => signals.every((signal) => signal.aborted) && signals.length > 0,
  };
}

interface Mounted {
  state: DashboardState;
  effects: DashboardEffects;
  dispose: () => void;
}

// Effects register teardown, which needs a scope; `render` is the only public
// way to open one today (TASKS "Spec gaps": effects tests need an owner).
// Disposal is tied to the test: effects hold an interval, so a mount left
// running would keep the process alive.
function mount(api: FeedApi, t: TestContext): Mounted {
  const holder: { state?: DashboardState; effects?: DashboardEffects } = {};

  const dispose = render(() => {
    holder.state = createDashboardState();
    holder.effects = createDashboardEffects(api, holder.state);

    return html`<i></i>`;
  }, host);

  t.after(dispose);

  return {
    state: holder.state as DashboardState,
    effects: holder.effects as DashboardEffects,
    dispose,
  };
}

test('start seeds from the snapshot, then applies what the feed sends', async (t) => {
  const feed = fakeFeed(async () => [metric(0, 'a', 10), metric(1, 'b', 20)]);
  const { state, effects } = mount(feed.api, t);

  effects.start();
  await settled();
  assert.equal(state.status(), Status.Ready);

  feed.emit([{ id: 0, value: 12 }]);
  assert.equal(state.rows()[0]?.value, 12);
  assert.equal(state.applied(), 1);
  assert.equal(state.batches(), 1);
});

test('pausing stops applying without dropping the subscription', async (t) => {
  const feed = fakeFeed(async () => [metric(0, 'a', 10)]);
  const { state, effects } = mount(feed.api, t);

  effects.start();
  await settled();

  effects.toggleLive();
  feed.emit([{ id: 0, value: 50 }]);
  assert.equal(state.rows()[0]?.value, 10, 'nothing applied while paused');
  assert.equal(state.applied(), 0);

  effects.toggleLive();
  feed.emit([{ id: 0, value: 60 }]);
  assert.equal(state.rows()[0]?.value, 60, 'the same subscription resumed');
});

test('sort maps the control value onto the state, and never trusts it blindly', async (t) => {
  const feed = fakeFeed(async () => [metric(0, 'a', 10)]);
  const { state, effects } = mount(feed.api, t);

  effects.start();
  await settled();

  effects.sortBy('name');
  assert.equal(state.sortedBy(), SortKey.Name);

  effects.sortBy('nonsense');

  assert.equal(
    state.sortedBy(),
    SortKey.Value,
    'an unknown value falls back, it does not corrupt state',
  );
});

test('a failing snapshot becomes an error state, not an unhandled rejection', async (t) => {
  const feed = fakeFeed(async () => {
    throw new Error('feed unreachable');
  });

  const { state, effects } = mount(feed.api, t);

  effects.start();
  await settled();
  assert.equal(state.status(), Status.Failed);
  assert.equal(state.error(), 'feed unreachable');
});

test('disposing unsubscribes, and a late batch writes nothing', async (t) => {
  const feed = fakeFeed(async () => [metric(0, 'a', 10)]);
  const { state, effects, dispose } = mount(feed.api, t);

  effects.start();
  await settled();

  dispose();
  assert.equal(feed.aborted(), true, 'the feed was told to stop');

  feed.emit([{ id: 0, value: 99 }]);
  assert.equal(state.rows()[0]?.value, 10, 'a batch after disposal changes nothing');
});

test('the rate is sampled from the applied counter and scaled to a second', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });

  const feed = fakeFeed(async () => [metric(0, 'a', 10)]);
  const { state, effects } = mount(feed.api, t);

  effects.start();
  await settled();

  feed.emit([
    { id: 0, value: 11 },
    { id: 0, value: 12 },
  ]);

  t.mock.timers.tick(250);
  assert.equal(state.rate(), 8, 'two values in a quarter second is eight a second');

  t.mock.timers.tick(250);
  assert.equal(state.rate(), 0, 'a quiet window reads zero, not the last value');
});
