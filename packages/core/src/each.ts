// Keyed lists (SPEC §9). The row function runs once per key and receives an
// accessor for its item, so a new object under the same key updates the cells
// that changed instead of rebuilding the row.
//
// With a window the list is positional instead: a fixed pool of rows is
// rewritten in place as the window moves, and two spacers stand in for the
// rows that are not in the DOM. The trade-off is in ADR 0003.

import { ErrorCode } from './codes.ts';
import { NodeType, place, removeAll } from './dom.ts';
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

/**
 * The slice of a list that exists in the DOM (SPEC §9). The caller measures and
 * the framework renders: a scroll listener in the effects layer owns the
 * container's height and the overscan, and hands the result over as one value.
 *
 * @example
 * const window = computed(() => ({ start: firstVisible(), count: 32, rowHeight: 28 }));
 */
export interface EachWindow {
  /** Index of the first row rendered. */
  readonly start: number;
  /** How many rows exist — the size of the pool. */
  readonly count: number;
  /** Row height in CSS pixels, for the spacers that hold the scrollbar open. */
  readonly rowHeight: number;
}

/** What a list is built from: an array, or something reactive that returns one. */
type Source<T> = Accessor<readonly T[]> | readonly T[];

type Render<T> = (item: Accessor<T>) => Template;

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

function itemsOf<T>(source: Source<T>): readonly T[] {
  return typeof source === 'function' ? source() : source;
}

function buildRow<T>(renderRow: Render<T>, owner: OwnerNode | undefined, value: T): Row<T> {
  const item = signal(value);
  let fragment: DocumentFragment | undefined;

  // A scope of the list's own, not of the watcher reconciling it, so a row
  // survives every pass until its key disappears.
  const dispose = root(() => {
    const scope = getOwner();

    if (scope !== undefined) scope.row = item;

    fragment = instantiate(renderRow(item as Accessor<T>));
  }, owner);

  const built = fragment as DocumentFragment;

  const nodes: ChildNode[] =
    built.childNodes.length > 0 ? [...built.childNodes] : [document.createTextNode('')];

  return { item, nodes, dispose, index: NEW_ROW };
}

function placeRow<T>(parent: Node, row: Row<T>, anchor: Node | null): void {
  for (const node of row.nodes) place(parent, node, anchor);
}

function dropRow<T>(row: Row<T>): void {
  row.dispose();
  removeAll(row.nodes);
}

class EachList<T> implements Mountable {
  private readonly list: Source<T>;

  private readonly renderRow: Render<T>;

  private rows = new Map<Key, Row<T>>();

  private order: Row<T>[] = [];

  private owner: OwnerNode | undefined = undefined;

  constructor(list: Source<T>, renderRow: Render<T>) {
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

  private next(items: readonly T[]): { order: Row<T>[]; rows: Map<Key, Row<T>> } {
    const order: Row<T>[] = [];
    const rows = new Map<Key, Row<T>>();

    for (const item of items) {
      const key = keyOf(item);

      if (rows.has(key)) fail(ErrorCode.EachDuplicateKey, JSON.stringify(key));

      const existing = this.rows.get(key);

      if (existing !== undefined) existing.item.set(item);

      const row = existing ?? buildRow(this.renderRow, this.owner, item);

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

interface Spacers {
  readonly before: HTMLElement;
  readonly after: HTMLElement;
}

/** Which rows exist, once the caller's window is squared with the list. */
interface Slice {
  readonly first: number;
  readonly count: number;
  readonly total: number;
}

/** When a row has no element of its own to copy: legal anywhere a row was. */
const NEUTRAL_TAG = 'div';

/**
 * A window is a measurement, and measurements run off the ends of a list — a
 * rubber-banding scroll reports a negative offset, and a container taller than
 * the data asks for more rows than exist. Clamping is the answer to both: the
 * pool shows the nearest real rows rather than refusing to render.
 */
function sliceOf(window: EachWindow, total: number): Slice {
  const count = Math.min(Math.max(window.count, 0), total);
  const first = Math.min(Math.max(window.start, 0), total - count);

  return { first, count, total };
}

/** What makes a tag a custom element's, and never a built-in's. */
const CUSTOM_ELEMENT_MARK = '-';

/**
 * A spacer has to be legal where the rows are: a row inside a `<ul>` is an
 * `<li>`. It must never be a *custom* element, though — creating one upgrades
 * it, which runs the component's constructor and builds its shadow DOM, and a
 * spacer that renders a component is not a spacer. A `<div>` in its place is at
 * worst the wrong box; an `<x-card>` in its place is two extra live components.
 */
function tagOf<T>(row: Row<T>): string {
  for (const node of row.nodes) {
    if (node.nodeType !== NodeType.Element) continue;

    const tag = (node as Element).tagName.toLowerCase();

    return tag.includes(CUSTOM_ELEMENT_MARK) ? NEUTRAL_TAG : tag;
  }

  return NEUTRAL_TAG;
}

/** Stands in for the rows that are not here, so the scrollbar tells the truth. */
function spacer(tag: string): HTMLElement {
  const element = document.createElement(tag);

  element.setAttribute('role', 'presentation');
  element.setAttribute('aria-hidden', 'true');
  element.style.listStyle = 'none';

  return element;
}

/**
 * A windowed list is positional: `count` rows are built once, and moving the
 * window rewrites their items instead of creating and destroying nodes. A slot
 * is recycled, so a row's DOM node no longer follows its item — see
 * `Docs/adr/0003-windowed-each-recycles-rows.md`.
 */
class WindowedList<T> implements Mountable {
  private readonly list: Source<T>;

  private readonly renderRow: Render<T>;

  private readonly window: Accessor<EachWindow>;

  private owner: OwnerNode | undefined = undefined;

  private pool: Row<T>[] = [];

  private spacers: Spacers | undefined = undefined;

  constructor(list: Source<T>, renderRow: Render<T>, window: Accessor<EachWindow>) {
    this.list = list;
    this.renderRow = renderRow;
    this.window = window;
  }

  [MOUNT](marker: Comment): void {
    this.owner = getOwner();

    onDispose(() => {
      this.clear();
    });

    watchFrame(() => {
      this.reconcile(marker, itemsOf(this.list), this.window());
    });
  }

  private reconcile(marker: Comment, items: readonly T[], window: EachWindow): void {
    const slice = sliceOf(window, items.length);

    this.resize(marker, items, slice);
    this.fill(items, slice.first);
    this.space(marker, slice, window.rowHeight);
  }

  /** Grows or shrinks the pool. Moving the window does not come through here. */
  private resize(marker: Comment, items: readonly T[], slice: Slice): void {
    while (this.pool.length > slice.count) dropRow(this.pool.pop() as Row<T>);

    const parent = marker.parentNode as Node;

    while (this.pool.length < slice.count) {
      // `sliceOf` has already proved this index is inside the list.
      const value = items[slice.first + this.pool.length] as T;
      const row = buildRow(this.renderRow, this.owner, value);

      this.pool.push(row);
      placeRow(parent, row, this.spacers?.after ?? marker);
    }
  }

  /** Slot `i` shows `items[first + i]`; a slot whose item is unchanged notifies nobody. */
  private fill(items: readonly T[], first: number): void {
    for (const [slot, row] of this.pool.entries()) row.item.set(items[first + slot] as T);
  }

  private space(marker: Comment, slice: Slice, rowHeight: number): void {
    const spacers = this.spacers ?? this.openSpacers(marker);

    if (spacers === undefined) return;

    const below = slice.total - slice.first - slice.count;

    spacers.before.style.height = `${String(slice.first * rowHeight)}px`;
    spacers.after.style.height = `${String(below * rowHeight)}px`;
  }

  /** Waits for a row: a spacer's tag is whatever the rows turned out to be. */
  private openSpacers(marker: Comment): Spacers | undefined {
    const first = this.pool[0];

    if (first === undefined) return undefined;

    const parent = marker.parentNode as Node;
    const tag = tagOf(first);
    const spacers: Spacers = { before: spacer(tag), after: spacer(tag) };

    place(parent, spacers.before, first.nodes[0] as ChildNode);
    place(parent, spacers.after, marker);
    this.spacers = spacers;

    return spacers;
  }

  /** Removes the rows this list owns; the scopes die with their owner. */
  clear(): void {
    for (const row of this.pool) removeAll(row.nodes);

    if (this.spacers !== undefined) removeAll([this.spacers.before, this.spacers.after]);

    this.pool = [];
    this.spacers = undefined;
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
 * A keyed list. Objects key by `id`, primitives by value; the row function runs
 * once per key. A `window` makes it positional instead: a fixed pool of rows,
 * rewritten in place as the window moves, with spacers holding the rest open.
 *
 * @example
 * html`<ul>${each(items, (item) => html`<li>${computed(() => item().title)}</li>`)}</ul>`
 */
export function each<T>(
  list: Accessor<readonly T[]> | readonly T[],
  row: (item: Accessor<T>) => Template,
  window?: Accessor<EachWindow>,
): Each {
  if (window === undefined) return new EachList(list, row);

  return new WindowedList(list, row, window);
}
