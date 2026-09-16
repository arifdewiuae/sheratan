// Keyed lists (SPEC §9). The row function runs once per key and receives an
// accessor for its item, so a new object under the same key updates the cells
// that changed instead of rebuilding the row.

import { ErrorCode } from './codes.ts';
import { place, removeAll } from './dom.ts';
import type { Disposer } from './disposer.ts';
import { fail } from './errors.ts';
import { instantiate } from './instantiate.ts';
import { longestIncreasing } from './lis.ts';
import { MOUNT, type Mountable } from './mountable.ts';
import { getOwner, onDispose, type OwnerNode, root } from './owner.ts';
import { signal } from './signal.ts';
import type { Template } from './template.ts';
import type { Accessor, Signal } from './types.ts';
import { watchFrame } from './watch.ts';

/** What a row is keyed by: an object's `id`, or a primitive's own value. */
export type Key = string | number;

/** A keyed list in a child hole. */
export type Each = Mountable;

interface Row<T> {
  readonly item: Signal<T>;
  readonly nodes: ChildNode[];
  readonly dispose: Disposer;
  /** Position in the previous order, or -1 for a row created this pass. */
  index: number;
}

const NEW_ROW = -1;

function keyOf(item: unknown): Key {
  if (item === null || typeof item !== 'object') return item as Key;

  const id = (item as { id?: Key }).id;

  if (id === undefined) fail(ErrorCode.EachItemWithoutId);

  return id;
}

function placeRow<T>(parent: Node, row: Row<T>, anchor: Node | null): void {
  for (const node of row.nodes) place(parent, node, anchor);
}

function dropRow<T>(row: Row<T>): void {
  row.dispose();
  removeAll(row.nodes);
}

class EachList<T> implements Mountable {
  private readonly list: Accessor<readonly T[]> | readonly T[];

  private readonly renderRow: (item: Accessor<T>) => Template;

  private rows = new Map<Key, Row<T>>();

  private order: Row<T>[] = [];

  private owner: OwnerNode | undefined = undefined;

  constructor(
    list: Accessor<readonly T[]> | readonly T[],
    renderRow: (item: Accessor<T>) => Template,
  ) {
    this.list = list;
    this.renderRow = renderRow;
  }

  [MOUNT](marker: Comment): void {
    const source = this.list;

    this.owner = getOwner();

    onDispose(() => {
      this.clear();
    });

    if (typeof source !== 'function') {
      this.reconcile(marker, source);

      return;
    }

    watchFrame(() => {
      this.reconcile(marker, source());
    });
  }

  private createRow(value: T): Row<T> {
    const item = signal(value);
    let fragment: DocumentFragment | undefined;

    // A scope of the list's own, not of the watcher reconciling it, so a row
    // survives every pass until its key disappears.
    const dispose = root(() => {
      const scope = getOwner();

      if (scope !== undefined) scope.row = item;

      fragment = instantiate(this.renderRow(item as Accessor<T>));
    }, this.owner);

    const built = fragment as DocumentFragment;

    const nodes: ChildNode[] =
      built.childNodes.length > 0 ? [...built.childNodes] : [document.createTextNode('')];

    return { item, nodes, dispose, index: NEW_ROW };
  }

  private next(items: readonly T[]): { order: Row<T>[]; rows: Map<Key, Row<T>> } {
    const order: Row<T>[] = [];
    const rows = new Map<Key, Row<T>>();

    for (const item of items) {
      const key = keyOf(item);

      if (rows.has(key)) fail(ErrorCode.EachDuplicateKey, JSON.stringify(key));

      const existing = this.rows.get(key);

      if (existing !== undefined) existing.item.set(item);

      const row = existing ?? this.createRow(item);

      rows.set(key, row);
      order.push(row);
    }

    return { order, rows };
  }

  private reconcile(marker: Comment, items: readonly T[]): void {
    const { order, rows } = this.next(items);

    for (const [key, row] of this.rows) {
      if (!rows.has(key)) dropRow(row);
    }

    patch(marker, this.order, order);

    for (let index = 0; index < order.length; index++) {
      (order[index] as Row<T>).index = index;
    }

    this.rows = rows;
    this.order = order;
  }

  /** Removes the rows this list owns; the scopes die with their owner. */
  clear(): void {
    for (const row of this.order) removeAll(row.nodes);

    this.rows = new Map();
    this.order = [];
  }
}

function matchingHead<T>(previous: readonly Row<T>[], next: readonly Row<T>[]): number {
  let head = 0;

  while (head < previous.length && head < next.length && previous[head] === next[head]) head++;

  return head;
}

function matchingTail<T>(
  previous: readonly Row<T>[],
  next: readonly Row<T>[],
  head: number,
): number {
  let oldTail = previous.length - 1;
  let newTail = next.length - 1;

  while (oldTail >= head && newTail >= head && previous[oldTail] === next[newTail]) {
    oldTail--;
    newTail--;
  }

  return newTail;
}

// The rows that can stay: the longest run already in increasing order. An
// order that never decreases needs no moves at all.
function staying<T>(
  next: readonly Row<T>[],
  head: number,
  newTail: number,
): Set<number> | undefined {
  const sources: number[] = [];
  let moved = false;
  let highest = NEW_ROW;

  for (let index = head; index <= newTail; index++) {
    const from = (next[index] as Row<T>).index;

    sources.push(from);

    if (from < highest) moved = true;
    else highest = from;
  }

  if (!moved) return undefined;

  return new Set(longestIncreasing(sources).map((offset) => offset + head));
}

// Rows already in the right place are left alone: a matching head and tail are
// skipped, and in the middle only rows outside the longest increasing run move.
function patch<T>(marker: Comment, previous: readonly Row<T>[], next: readonly Row<T>[]): void {
  const head = matchingHead(previous, next);
  const newTail = matchingTail(previous, next, head);

  if (head > newTail) return;

  const parent = marker.parentNode as Node;
  const stay = staying(next, head, newTail);

  let anchor: Node | null =
    newTail + 1 < next.length ? ((next[newTail + 1] as Row<T>).nodes[0] ?? marker) : marker;

  for (let index = newTail; index >= head; index--) {
    const row = next[index] as Row<T>;

    if (row.index === NEW_ROW || (stay !== undefined && !stay.has(index))) {
      placeRow(parent, row, anchor);
    }

    anchor = row.nodes[0] ?? anchor;
  }
}

/**
 * A keyed list. Objects key by `id`, primitives by value; the row function
 * runs once per key.
 *
 * @example
 * html`<ul>${each(items, (item) => html`<li>${computed(() => item().title)}</li>`)}</ul>`
 */
export function each<T>(
  list: Accessor<readonly T[]> | readonly T[],
  row: (item: Accessor<T>) => Template,
): Each {
  return new EachList(list, row);
}
