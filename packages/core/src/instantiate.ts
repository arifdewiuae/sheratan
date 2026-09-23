// Mounting a template (SPEC §9): clone, walk to each hole, bind it. Every hole
// that receives a signal gets one frame watcher; anything else renders once.

import { ErrorCode } from './codes.ts';
import { DEV } from './env.ts';
import { tracePatch } from './trace.ts';
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

    if (DEV) tracePatch(element);
  });
}

/** The one event whose payload is the form rather than the element. */
const SUBMIT_EVENT = 'submit';

const CHECKBOX_TYPE = 'checkbox';

/** What a payload is read from: a native control, or a library's element. */
interface Control {
  readonly type?: string;
  readonly value?: unknown;
  readonly checked?: boolean;
}

function readControl(element: Element): unknown {
  const control = element as Control;

  return control.type === CHECKBOX_TYPE ? control.checked : control.value;
}

function submitted(element: Element, event: Event): unknown {
  event.preventDefault();

  return Object.fromEntries(new FormData(element as HTMLFormElement));
}

/**
 * Intents receive a payload, never the raw Event (SPEC §9 Intents), and the
 * payload is read from the element the handler is on rather than chosen from a
 * list of event names. A component library announces changes under its own
 * name — `sl-change`, `md-input` — and no table of event types can hold them
 * all, so an intent would silently receive nothing from every one of them.
 * An element with no value to report still reports none.
 */
function payloadOf(event: Event): unknown {
  const element = event.currentTarget as Element;

  if (event.type === SUBMIT_EVENT) return submitted(element, event);

  return readControl(element);
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

  // Something that mounts itself — a list, a child module — owns its nodes and
  // registers its own teardown, so the hole hands over the marker and keeps
  // none. In a reactive hole that teardown belongs to the watcher, which
  // resets before it re-runs: the old child goes before the new one arrives.
  if (typeof value === 'object' && isMountable(value)) {
    removeAll(old);

    value[MOUNT](marker);

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

    if (DEV) tracePatch(marker);
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
