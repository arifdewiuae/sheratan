// Post-disposal writes (SPEC §5b rule 1, ADR 0007): a signal belongs to the
// owner it was created under, and a write after that owner is disposed does
// nothing. Written before the implementation. A module's state is created
// inside its view function, so these tests build state the same way.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { freshHost } from './dom.ts';
import {
  flush,
  html,
  mount,
  render,
  scope,
  signal,
  type Accessor,
  type Signal,
  type Template,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

const CYCLES = 1000;

let host: Element;

beforeEach(() => {
  host = freshHost();
});

/** A module's state as its factory would build it: a signal and one transition. */
interface CountState {
  readonly count: Accessor<number>;
  readonly loaded: (value: number) => void;
}

function createCountState(): CountState {
  const count = signal(0);

  return {
    count,
    loaded: (value) => {
      count.set(value);
    },
  };
}

/** Mounts a module and hands its state out, as a late response would hold it. */
function mounted(): { readonly state: CountState; readonly dispose: () => void } {
  let state: CountState | undefined;

  const dispose = render(() => {
    state = createCountState();

    return html`<p>${state.count}</p>`;
  }, host);

  return { state: state as CountState, dispose };
}

test('a transition writes while its module is mounted', () => {
  const { state, dispose } = mounted();

  state.loaded(3);
  flush();

  assert.equal(state.count(), 3);
  assert.equal(host.textContent, '3');

  dispose();
});

test('a transition called after unmount writes nothing, and does not throw', () => {
  const { state, dispose } = mounted();

  state.loaded(1);
  dispose();

  assert.doesNotThrow(() => {
    state.loaded(2);
  });

  assert.equal(state.count(), 1, 'the read still answers with the last value');
});

test('a response that settles after unmount is a no-op, with no check in the effect', async () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  const { state, dispose } = mounted();

  const effect = (async (): Promise<void> => {
    state.loaded(await promise);
  })();

  dispose();
  resolve(9);
  await effect;

  assert.equal(state.count(), 0);
});

test('a signal created outside any owner outlives the module that wrote it', () => {
  const session = signal('signed-in');

  const dispose = render(() => {
    session.set('refreshed');

    return html`<p>${session}</p>`;
  }, host);

  dispose();
  session.set('signed-out');

  assert.equal(session(), 'signed-out', 'app-wide state is not discarded state');
});

test("a child module's state dies when the parent swaps it out", () => {
  const states: CountState[] = [];

  const child = (): Template => {
    const state = createCountState();

    states.push(state);

    return html`<span>${state.count}</span>`;
  };

  const showing: Signal<boolean> = signal(true);

  render(() => html`<main>${() => (showing() ? mount(child) : 'gone')}</main>`, host);

  const [first] = states;

  showing.set(false);
  flush();
  first?.loaded(5);

  assert.equal(first?.count(), 0);
});

test('state created in scope() dies with dispose(), as it would on unmount', () => {
  const { value: state, dispose } = scope(createCountState);

  state.loaded(1);
  dispose();
  state.loaded(2);

  assert.equal(state.count(), 1);
});

test('late writes into 1000 unmounted modules leak no subscriptions', () => {
  const before = liveSubscriptions();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const { state, dispose } = mounted();

    flush();
    dispose();
    state.loaded(cycle + 1);
  }

  flush();

  assert.equal(liveSubscriptions(), before);
  assert.equal(host.childNodes.length, 0, 'no late write rendered anything');
});
