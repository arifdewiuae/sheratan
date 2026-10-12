// Mounting into a host element (SPEC §10d Widget mode).

import { asDisposer, type Disposer } from './disposer.ts';
import { removeAll } from './dom.ts';
import { DEV } from './env.ts';
import { instantiate } from './instantiate.ts';
import { onDispose, root } from './owner.ts';
import type { Template } from './template.ts';
import { installTrace } from './trace.ts';

/** The attribute `global.css` scopes its tokens and base styles to (SPEC §9a). */
const ROOT_MARK = 'data-sheratan-root';

/**
 * Marks `host` as an app's root, unless it already is — `index.html` writes
 * `<body data-sheratan-root>` so the first paint is styled — and returns what
 * undoes only a mark this call made.
 */
function markRoot(host: Element): () => void {
  if (host.hasAttribute(ROOT_MARK)) return () => {};

  host.setAttribute(ROOT_MARK, '');

  return () => {
    host.removeAttribute(ROOT_MARK);
  };
}

/**
 * Mounts `view` into `host`. It owns only the nodes it inserts, so it can live
 * inside an app built with something else, and the disposer removes exactly
 * those nodes. It marks `host` with `data-sheratan-root`, which is all
 * `global.css` styles (SPEC §9a), so a whole page mounts on `document.body`
 * and a widget on any element, with the same stylesheet; the disposer removes
 * the mark if `render()` added it.
 *
 * @example
 * const dispose = render(view, document.querySelector('#live-table'));
 */
export function render(view: () => Template, host: Element): Disposer {
  // The one place the dev surface is installed: a module that reached for
  // `globalThis` on import would be a side effect, and the package promises it
  // has none (SPEC §7, `sideEffects: false`).
  if (DEV) installTrace();

  const stop = root(() => {
    let nodes: ChildNode[] = [];

    // Registered first, so it runs last: watchers stop before the DOM goes.
    onDispose(() => {
      removeAll(nodes);
    });

    onDispose(markRoot(host));

    const fragment = instantiate(view());

    nodes = [...fragment.childNodes];
    host.append(fragment);
  });

  return asDisposer(stop);
}
