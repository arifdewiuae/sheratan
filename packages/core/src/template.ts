// Templates (SPEC §9). A call site is parsed once: the markup becomes a
// <template>, every hole becomes a path to its node, and marker attributes are
// stripped from the template itself. Mounting then clones and walks straight
// to each hole — no scanning, no string parsing, no map lookups.

import { ErrorCode } from './codes.ts';
import { NodeType } from './dom.ts';
import { fail } from './errors.ts';

/** Where a hole sits, and therefore how its value is bound. */
export const PartKind = {
  Child: 'child',
  Attr: 'attr',
  Prop: 'prop',
  Event: 'event',
} as const;

/** One of {@link PartKind}. */
export type PartKind = (typeof PartKind)[keyof typeof PartKind];

const MARKER = 'sh-';
const NEAR_LENGTH = 30;
const PROP_PREFIX = '.';
const EVENT_PREFIX = '@';

// A hole inside a tag is only legal as a whole attribute value: `name=`,
// `.prop=`, `@event=`, optionally followed by an opening quote.
const ATTRIBUTE_HOLE = /([.@]?[A-Za-z_:][\w:.-]*)=(["']?)$/;

/** Only the markers this module writes: `sh-` followed by the hole number. */
const MARKER_PATTERN = /^sh-(\d+)$/;

/** A parsed hole: what to bind, and how to reach its node from the clone. */
export interface Part {
  readonly index: number;
  readonly kind: PartKind;
  readonly name: string;
  /** Depth shared with the previous part, whose nodes are already resolved. */
  readonly base: number;
  /** Whether the walk starts at the previous part's node as a sibling. */
  readonly relative: boolean;
  /** Sibling steps to take at each level below {@link base}. */
  readonly steps: readonly number[];
}

/** A parsed call site, shared by every instance of that template. */
export interface Prepared {
  readonly content: DocumentFragment;
  readonly parts: readonly Part[];
}

/** The result of an `html` tagged template: markup plus its hole values. */
export class Template {
  readonly strings: TemplateStringsArray;

  readonly values: readonly unknown[];

  constructor(strings: TemplateStringsArray, values: readonly unknown[]) {
    this.strings = strings;
    this.values = values;
  }
}

interface Hole {
  index: number;
  kind: PartKind;
  name: string;
}

interface ScanState {
  markup: string;
  inTag: boolean;
  quote: string | null;
  skipQuote: string | null;
}

const prepared = new WeakMap<TemplateStringsArray, Prepared>();

function near(strings: TemplateStringsArray, index: number): string {
  return (strings[index] ?? '').slice(-NEAR_LENGTH);
}

// Tracks whether the next hole lands in a tag, and inside which quote.
function scanText(state: ScanState, text: string): void {
  for (const character of text) {
    if (state.quote !== null) {
      if (character === state.quote) state.quote = null;
    } else if (state.inTag) {
      if (character === '"' || character === "'") state.quote = character;
      else if (character === '>') state.inTag = false;
    } else if (character === '<') {
      state.inTag = true;
    }
  }
}

function kindOf(name: string): PartKind {
  if (name.startsWith(EVENT_PREFIX)) return PartKind.Event;
  if (name.startsWith(PROP_PREFIX)) return PartKind.Prop;

  return PartKind.Attr;
}

function addAttributeHole(state: ScanState, strings: TemplateStringsArray, index: number): Hole {
  const text = state.markup;
  const match = ATTRIBUTE_HOLE.exec(text);

  if (match === null) fail(ErrorCode.PartialAttributeHole, near(strings, index));

  const [whole, rawName = '', quote = ''] = match;

  // `title="name=${v}"` matches the pattern but sits inside an open quote.
  if (quote === '' && state.quote !== null) {
    fail(ErrorCode.PartialAttributeHole, near(strings, index));
  }

  const kind = kindOf(rawName);

  state.markup = text.slice(0, -whole.length) + MARKER + String(index);

  if (quote !== '') {
    state.quote = null;
    state.skipQuote = quote;
  }

  return { index, kind, name: kind === PartKind.Attr ? rawName : rawName.slice(1) };
}

function scan(strings: TemplateStringsArray): { markup: string; holes: Hole[] } {
  const state: ScanState = { markup: '', inTag: false, quote: null, skipQuote: null };
  const holes: Hole[] = [];
  const last = strings.length - 1;

  for (let index = 0; index <= last; index++) {
    let text = strings[index] ?? '';

    if (state.skipQuote !== null) {
      if (!text.startsWith(state.skipQuote)) {
        fail(ErrorCode.PartialAttributeHole, near(strings, index - 1));
      }

      text = text.slice(1);
      state.skipQuote = null;
    }

    scanText(state, text);
    state.markup += text;

    if (index === last) break;

    if (state.inTag) {
      holes.push(addAttributeHole(state, strings, index));
      continue;
    }

    state.markup += `<!--${MARKER}${String(index)}-->`;
    holes.push({ index, kind: PartKind.Child, name: '' });
  }

  return { markup: state.markup, holes };
}

function markerIndex(text: string): number | undefined {
  const match = MARKER_PATTERN.exec(text);

  if (match === null) return undefined;

  return Number(match[1]);
}

function collectElement(
  element: Element,
  path: readonly number[],
  found: Map<number, number[]>,
): void {
  const markers: string[] = [];

  for (const attribute of element.attributes) {
    const index = markerIndex(attribute.name);

    if (index === undefined) continue;

    found.set(index, [...path]);
    markers.push(attribute.name);
  }

  // Removed after the walk: mutating attributes while iterating them skips.
  for (const name of markers) element.removeAttribute(name);
}

// Depth is the template's own markup nesting, so recursion is bounded by what
// a person wrote by hand.
function collect(parent: Node, path: number[], found: Map<number, number[]>): void {
  let position = 0;

  for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
    path.push(position);

    if (node.nodeType === NodeType.Comment) {
      const comment = node as Comment;
      const index = markerIndex(comment.data);

      if (index !== undefined) {
        found.set(index, [...path]);
        comment.data = '';
      }
    } else if (node.nodeType === NodeType.Element) {
      collectElement(node as Element, path, found);
      collect(node, path, found);
    }

    path.pop();
    position++;
  }
}

function comparePaths(left: readonly number[], right: readonly number[]): number {
  const shared = Math.min(left.length, right.length);

  for (let depth = 0; depth < shared; depth++) {
    const difference = (left[depth] ?? 0) - (right[depth] ?? 0);

    if (difference !== 0) return difference;
  }

  return left.length - right.length;
}

function sharedDepth(left: readonly number[], right: readonly number[]): number {
  const limit = Math.min(left.length, right.length);
  let depth = 0;

  while (depth < limit && left[depth] === right[depth]) depth++;

  return depth;
}

// A part starts walking where the previous one stopped: from its node as a
// sibling when they diverge, otherwise from the deepest shared ancestor.
function toPart(hole: Hole, path: readonly number[], previous: readonly number[]): Part {
  const base = sharedDepth(path, previous);
  const relative = base < previous.length && base < path.length;
  const steps: number[] = [];

  if (base < path.length) {
    const first = path[base] ?? 0;

    steps.push(relative ? first - (previous[base] ?? 0) : first);

    for (let depth = base + 1; depth < path.length; depth++) steps.push(path[depth] ?? 0);
  }

  return { index: hole.index, kind: hole.kind, name: hole.name, base, relative, steps };
}

function toParts(
  strings: TemplateStringsArray,
  holes: readonly Hole[],
  found: Map<number, number[]>,
): Part[] {
  const located = holes.map((hole) => {
    const path = found.get(hole.index);

    if (path === undefined) fail(ErrorCode.UnreachableHole, near(strings, hole.index));

    return { hole, path };
  });

  located.sort((left, right) => comparePaths(left.path, right.path));

  let previous: readonly number[] = [];

  return located.map(({ hole, path }) => {
    const part = toPart(hole, path, previous);

    previous = path;

    return part;
  });
}

/** Parses a call site, once. Later instances reuse the result. */
export function prepare(strings: TemplateStringsArray): Prepared {
  const cached = prepared.get(strings);

  if (cached !== undefined) return cached;

  const { markup, holes } = scan(strings);
  const element = document.createElement('template');

  element.innerHTML = markup;

  const found = new Map<number, number[]>();

  collect(element.content, [], found);

  const result: Prepared = { content: element.content, parts: toParts(strings, holes, found) };

  prepared.set(strings, result);

  return result;
}

/**
 * Markup with holes. A hole is reactive only when it receives the signal
 * itself: `${total}` updates, `${total()}` is read once (SPEC §9, SHR-V003).
 *
 * @example
 * html`<p class=${tone}>${message}</p>`
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Template {
  return new Template(strings, values);
}
