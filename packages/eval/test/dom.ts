// Shared DOM setup for the host behaviour suite. happy-dom, as in core's tests.
import { Window } from 'happy-dom';

const window = new Window();

globalThis.document = window.document as unknown as Document;
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

/** Fires a real event at an element, the way a browser would. */
export function fire(element: Element, type: string): void {
  const event = new window.Event(type, { bubbles: true, cancelable: true });

  element.dispatchEvent(event as unknown as Event);
}

/** The mutations one DOM change produced, in the order the DOM made them. */
export interface Change {
  readonly removed: readonly Element[];
  readonly added: readonly Element[];
}

/**
 * Records every child mutation under `target` while `act` runs. A
 * MutationObserver delivers its records in one batch, so the callback cannot
 * see the states between them — replaying the records can, which is what an
 * "is it ever visible at the same time" assertion needs.
 */
export function changesDuring(target: Element, records: Change[]): { stop(this: void): void } {
  const collect = (list: readonly MutationRecord[]): void => {
    for (const record of list) {
      records.push({
        removed: [...record.removedNodes].filter(isElement),
        added: [...record.addedNodes].filter(isElement),
      });
    }
  };

  const observer = new window.MutationObserver((list) => {
    collect(list as unknown as readonly MutationRecord[]);
  });

  observer.observe(target as never, { childList: true, subtree: true });

  return {
    stop: () => {
      // Anything still queued is a state the assertion has to see, not drop.
      collect(observer.takeRecords() as unknown as readonly MutationRecord[]);
      observer.disconnect();
    },
  };
}

function isElement(node: unknown): node is Element {
  return (node as Node).nodeType === 1;
}
