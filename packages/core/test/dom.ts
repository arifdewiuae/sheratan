// Shared DOM setup. happy-dom is 3-10x faster than jsdom for this.
import { Window } from 'happy-dom';

const window = new Window();

globalThis.document = window.document as unknown as Document;
// Node's own FormData cannot read a happy-dom form.
globalThis.FormData = window.FormData as unknown as typeof FormData;

/** The window backing `globalThis.document`, for constructing events. */
export const dom: Window = window;

/** Replaces the document body with a fresh host element. */
export function freshHost(): Element {
  document.body.innerHTML = '';

  const host = document.createElement('div');

  document.body.append(host);

  return host;
}
