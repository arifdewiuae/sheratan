// Mounting a template (SPEC §9): clone, walk to each hole, bind it. Every hole
// that receives a signal gets one frame watcher; anything else renders once.

import { ErrorCode } from './codes.ts';
import { NodeType, removeAll } from './dom.ts';
import { fail } from './errors.ts';
import { isMountable, MOUNT } from './mountable.ts';
import { getOwner, onDispose, root } from './owner.ts';
import { batch } from './scheduler.ts';
import { type Part, PartKind, prepare, Template } from './template.ts';
import type { Accessor } from './types.ts';
import { watchFrame } from './watch.ts';

type Intent = (payload: unknown, item?: unknown) => unknown;

const EMPTY: ChildNode[] = [];

function advance(from: Node, steps: number): Node {
  let node = from;

  for (let step = 0; step < steps; step++) node = node.nextSibling as Node;

  return node;
}

// Walks only the distance between this hole and the previous one: the shared
// ancestors are already resolved in `nodes`.
function resolve(fragment: DocumentFragment, part: Part, nodes: Node[]): Node {
  const { base, relative, steps } = part;

  if (steps.length === 0) return nodes[base - 1] as Node;

  const parent = base === 0 ? fragment : (nodes[base - 1] as Node);
  const first = steps[0] as number;

  nodes[base] = relative
    ? advance(nodes[base] as Node, first)
    : advance(parent.firstChild as Node, first);

  for (let depth = 1; depth < steps.length; depth++) {
    const from = (nodes[base + depth - 1] as Node).firstChild as Node;

    nodes[base + depth] = advance(from, steps[depth] as number);
  }

  return nodes[base + steps.length - 1] as Node;
}

// A hole may hold anything; an object with no useful `toString` rendering as
// "[object Object]" is the author's mistake to see, not ours to hide.
function asText(value: unknown): string {
  return String(value);
}

function setAttribute(element: Element, name: string, value: unknown): void {
  if (value == null || value === false) {
    element.removeAttribute(name);

    return;
  }

  element.setAttribute(name, value === true ? '' : asText(value));
}

function setProperty(element: Element, name: string, value: unknown): void {
  (element as unknown as Record<string, unknown>)[name] = value;
}

function bindValue(element: Element, part: Part, value: unknown): void {
  const write =
    part.kind === PartKind.Prop
      ? (next: unknown): void => {
          setProperty(element, part.name, next);
        }
      : (next: unknown): void => {
          setAttribute(element, part.name, next);
        };

  if (typeof value !== 'function') {
    write(value);

    return;
  }

  const read = value as Accessor<unknown>;

  watchFrame(() => {
    write(read());
  });
}

function readControl(element: Element): unknown {
  const control = element as HTMLInputElement;

  return control.type === 'checkbox' ? control.checked : control.value;
}

// Intents receive a payload, never the raw Event (SPEC §9 Intents).
const PAYLOADS: Record<string, (element: Element, event: Event) => unknown> = {
  submit: (element, event) => {
    event.preventDefault();

    return Object.fromEntries(new FormData(element as HTMLFormElement));
  },
  input: readControl,
  change: readControl,
};

function payloadOf(event: Event): unknown {
  const reader = PAYLOADS[event.type];

  if (reader === undefined) return undefined;

  return reader(event.currentTarget as Element, event);
}

function bindEvent(element: Element, name: string, value: unknown): void {
  if (typeof value !== 'function') fail(ErrorCode.EventHoleNotFunction, name, typeof value);

  const intent = value as Intent;
  const row = getOwner()?.row;

  const listener =
    row === undefined
      ? (event: Event): void => {
          batch(() => intent(payloadOf(event)));
        }
      : (event: Event): void => {
          batch(() => intent(payloadOf(event), row()));
        };

  element.addEventListener(name, listener);

  onDispose(() => {
    element.removeEventListener(name, listener);
  });
}

function insertTemplate(marker: Comment, template: Template): ChildNode[] {
  let fragment: DocumentFragment | undefined;

  // Its own scope, so re-committing this hole disposes the branch it replaces.
  root(() => {
    fragment = instantiate(template);
  });

  const built = fragment as DocumentFragment;
  const nodes = [...built.childNodes];

  marker.before(built);

  return nodes;
}

function commitText(marker: Comment, old: ChildNode[], text: string): ChildNode[] {
  const first = old[0];

  if (old.length === 1 && first !== undefined && first.nodeType === NodeType.Text) {
    const node = first as Text;

    if (node.data !== text) node.data = text;

    return old;
  }

  removeAll(old);

  const node = document.createTextNode(text);

  marker.before(node);

  return [node];
}

function commit(marker: Comment, old: ChildNode[], value: unknown): ChildNode[] {
  if (value == null || value === false) {
    removeAll(old);

    return EMPTY;
  }

  if (value instanceof Template) {
    removeAll(old);

    return insertTemplate(marker, value);
  }

  if (Array.isArray(value)) fail(ErrorCode.ArrayInHole, value.length);

  if (typeof value === 'object' && 'nodeType' in value) {
    removeAll(old);

    const node = value as ChildNode;

    marker.before(node);

    return [node];
  }

  return commitText(marker, old, asText(value));
}

function bindChild(marker: Comment, value: unknown): void {
  if (typeof value === 'object' && value !== null && isMountable(value)) {
    value[MOUNT](marker);

    return;
  }

  if (typeof value !== 'function') {
    commit(marker, EMPTY, value);

    return;
  }

  const read = value as Accessor<unknown>;
  let nodes: ChildNode[] = EMPTY;

  onDispose(() => {
    removeAll(nodes);
  });

  watchFrame(() => {
    nodes = commit(marker, nodes, read());
  });
}

function bind(part: Part, target: Node, value: unknown): void {
  switch (part.kind) {
    case PartKind.Child:
      bindChild(target as Comment, value);

      return;

    case PartKind.Event:
      bindEvent(target as Element, part.name, value);

      return;

    case PartKind.Attr:
    case PartKind.Prop:
      bindValue(target as Element, part, value);
  }
}

/** Builds the DOM for a template under the current owner. */
export function instantiate(template: Template): DocumentFragment {
  const { content, parts } = prepare(template.strings);
  const fragment = document.importNode(content, true);
  const nodes: Node[] = [];

  for (const part of parts) {
    bind(part, resolve(fragment, part, nodes), template.values[part.index]);
  }

  return fragment;
}
