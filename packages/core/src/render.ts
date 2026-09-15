// Mounting into a host element (SPEC §10d Widget mode).

import { asDisposer, type Disposer } from './disposer.ts';
import { removeAll } from './dom.ts';
import { instantiate } from './instantiate.ts';
import { onDispose, root } from './owner.ts';
import type { Template } from './template.ts';

/**
 * Mounts `view` into `host`. It owns only the nodes it inserts, so it can live
 * inside an app built with something else, and the disposer removes exactly
 * those nodes.
 *
 * @example
 * const dispose = render(view, document.querySelector('#live-table'));
 */
export function render(view: () => Template, host: Element): Disposer {
  const stop = root(() => {
    let nodes: ChildNode[] = [];

    // Registered first, so it runs last: watchers stop before the DOM goes.
    onDispose(() => {
      removeAll(nodes);
    });

    const fragment = instantiate(view());

    nodes = [...fragment.childNodes];
    host.append(fragment);
  });

  return asDisposer(stop);
}
