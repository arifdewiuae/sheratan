// The Solid arm: `<For>` over a signal holding the list, keyed by reference,
// which is Solid's own keyed path. Compiled for real by babel-preset-solid in
// run.ts — measuring Solid through a runtime template engine instead of its
// compiler would make this arm slower than Solid actually is, and the gate is
// "within 2x of Solid", so a soft baseline is a lie in our favour.

import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

import { makeRows, SEED, SWAPS_PER_FRAME, swaps } from './workload.ts';

/** Renders the list into `host` and returns the per-frame step. Solid commits synchronously. */
export function start(host) {
  const [rows, setRows] = createSignal(makeRows());
  const nextSwap = swaps(SEED);

  render(
    () => (
      <ul class="list">
        <For each={rows()}>
          {(row) => (
            <li class="row">
              <span class="label">{row.label}</span>
              <span class="value">{row.value}</span>
            </li>
          )}
        </For>
      </ul>
    ),
    host,
  );

  return () => {
    const next = rows().slice();

    for (let swap = 0; swap < SWAPS_PER_FRAME; swap += 1) {
      const [left, right] = nextSwap();

      [next[left], next[right]] = [next[right], next[left]];
    }

    setRows(next);
  };
}
