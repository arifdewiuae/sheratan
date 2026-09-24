// The Sheratan arm: `each` over a signal holding the list, keyed by `id`.
// `sheratan` resolves to packages/core/dist/prod/index.js through an esbuild
// alias in run.ts — the same production bundle a user installs, not src.

import { each, flush, html, render, signal } from 'sheratan';

import { makeRows, SEED, SWAPS_PER_FRAME, swaps, type Row } from './workload.ts';

/**
 * Renders the list into `host` and returns the per-frame step: swap 20 pairs,
 * commit once. `flush()` makes the commit synchronous so the whole cost lands
 * inside the sample rather than in the scheduler's next frame.
 */
export function start(host: Element): () => void {
  const rows = signal<readonly Row[]>(makeRows());
  const nextSwap = swaps(SEED);

  render(
    () =>
      html`<ul class="list">
        ${each(
          rows,
          (row) => html`<li class="row">
            <span class="label">${() => row().label}</span>
            <span class="value">${() => row().value}</span>
          </li>`,
        )}
      </ul>`,
    host,
  );

  return () => {
    const next = rows().slice();

    for (let swap = 0; swap < SWAPS_PER_FRAME; swap += 1) {
      const [left, right] = nextSwap();

      [next[left], next[right]] = [next[right]!, next[left]!];
    }

    rows.set(next);
    flush();
  };
}
