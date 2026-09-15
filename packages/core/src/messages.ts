// Human-readable error text. Development builds only: the production entry
// swaps `env.ts` for `env.prod.ts`, so this table is never bundled and an
// error carries its code plus a docs link instead (SPEC A3).

import { ErrorCode } from './codes.ts';

/** The arguments each code's message needs, so `fail()` can type-check them. */
export interface MessageArgs {
  [ErrorCode.DisposeOutsideOwner]: [];
  [ErrorCode.WatchersDidNotSettle]: [limit: number];
  [ErrorCode.PartialAttributeHole]: [near: string];
  [ErrorCode.UnreachableHole]: [near: string];
  [ErrorCode.EventHoleNotFunction]: [name: string, received: string];
  [ErrorCode.EachItemWithoutId]: [];
  [ErrorCode.EachDuplicateKey]: [key: string];
}

type Messages = { [C in ErrorCode]: (...args: MessageArgs[C]) => string };

/** Every message says what to write instead, not only what went wrong. */
export const MESSAGES: Messages = {
  [ErrorCode.DisposeOutsideOwner]: () =>
    'onDispose() needs an owner. Call it while a module mounts, inside *.effects.ts.',

  [ErrorCode.WatchersDidNotSettle]: (limit) =>
    `A watcher re-ran ${String(limit)} times without settling: it keeps writing a signal it reads. ` +
    'Derive the value with computed() instead of writing it back.',

  [ErrorCode.PartialAttributeHole]: (near) =>
    `A hole inside a tag must be the whole attribute value, as name=\${value}; near "${near}\${…}". ` +
    'Build the whole value in a computed and pass that.',

  [ErrorCode.UnreachableHole]: (near) =>
    `The HTML parser dropped the marker for a hole near "${near}\${…}". ` +
    'Holes cannot sit inside <textarea>, <title>, <script>, <style> or a raw-text element; ' +
    'set the value through a property instead, as .value=${…}.',

  [ErrorCode.EventHoleNotFunction]: (name, received) =>
    `@${name} expects an intent function, received ${received}. ` +
    'Views declare intents and effects implement them; an inline arrow is SHR-V001.',

  [ErrorCode.EachItemWithoutId]: () =>
    'each() keys objects by their `id`, and an item has none. ' +
    'Give every item an id, or pass primitives, which key by value.',

  [ErrorCode.EachDuplicateKey]: (key) =>
    `each() got two items with the key ${key}. Keys identify rows, so they must be unique.`,
};
