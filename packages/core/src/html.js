// Templates (SPEC §9). A template is parsed once per call site into a
// <template>; each hole becomes a direct node reference. A hole that receives
// a signal or computed gets one frame watcher; anything else renders once.

import { signal, batch, onDispose, root, getOwner, watchFrame } from './reactive.js';

const TEXT = 3;
const COMMENT = 8;
const MARK = 'sh-';

class Template {
  constructor(strings, values) {
    this.strings = strings;
    this.values = values;
  }
}

export const html = (strings, ...values) => new Template(strings, values);

// ── Parsing ─────────────────────────────────────────────────────────────

const prepared = new WeakMap();

function prepare(strings) {
  let cached = prepared.get(strings);
  if (cached) return cached;
  const parts = [];
  let markup = '';
  let inTag = false;
  let quote = null;
  let skipQuote = null;
  for (let i = 0; i < strings.length; i++) {
    let s = strings[i];
    if (skipQuote) {
      if (s[0] !== skipQuote) throw holeError(strings, i - 1);
      s = s.slice(1);
      skipQuote = null;
    }
    for (const c of s) {
      if (quote) { if (c === quote) quote = null; }
      else if (inTag) { if (c === '"' || c === "'") quote = c; else if (c === '>') inTag = false; }
      else if (c === '<') inTag = true;
    }
    if (i === strings.length - 1) {
      markup += s;
      break;
    }
    if (!inTag) {
      markup += `${s}<!--${MARK}${i}-->`;
      parts.push({ index: i, kind: 'child' });
      continue;
    }
    const m = /([.@]?[A-Za-z_:][\w:.-]*)=(["']?)$/.exec(s);
    if (!m || (quote && !m[2])) throw holeError(strings, i);
    const [whole, name, q] = m;
    const kind = name[0] === '@' ? 'event' : name[0] === '.' ? 'prop' : 'attr';
    markup += `${s.slice(0, -whole.length)}${MARK}${i}`;
    parts.push({ index: i, kind, name: kind === 'attr' ? name : name.slice(1) });
    if (q) {
      quote = null;
      skipQuote = q;
    }
  }
  const template = document.createElement('template');
  template.innerHTML = markup;
  cached = { template, parts };
  prepared.set(strings, cached);
  return cached;
}

function holeError(strings, i) {
  const near = strings[i].slice(-30);
  return new Error(`sheratan: a hole inside a tag must be a whole attribute value, as name=\${value}; near "${near}\${…}"`);
}

// ── Instantiation ───────────────────────────────────────────────────────

/** Build DOM for a template under the current owner. */
function instantiate(tpl) {
  const { template, parts } = prepare(tpl.strings);
  const fragment = document.importNode(template.content, true);
  const targets = new Map();
  const walker = document.createTreeWalker(fragment, 0x1 | 0x80);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === COMMENT) {
      if (node.data.startsWith(MARK)) targets.set(+node.data.slice(MARK.length), node);
      continue;
    }
    for (const attr of [...node.attributes]) {
      if (!attr.name.startsWith(MARK)) continue;
      targets.set(+attr.name.slice(MARK.length), node);
      node.removeAttribute(attr.name);
    }
  }
  for (const part of parts) {
    const target = targets.get(part.index);
    const value = tpl.values[part.index];
    if (part.kind === 'child') bindChild(target, value);
    else if (part.kind === 'event') bindEvent(target, part.name, value);
    else bindValue(target, part, value);
  }
  return fragment;
}

const reactive = (value) => typeof value === 'function';

function bindValue(el, part, value) {
  const write = part.kind === 'prop'
    ? (v) => { el[part.name] = v; }
    : (v) => {
      if (v == null || v === false) el.removeAttribute(part.name);
      else el.setAttribute(part.name, v === true ? '' : String(v));
    };
  if (reactive(value)) watchFrame(() => write(value()));
  else write(value);
}

// Intents receive a payload, never the raw Event (SPEC §9 Intents). Inside an
// each() row they also receive that row's current item.
function payloadOf(event) {
  const el = event.currentTarget;
  if (event.type === 'submit') {
    event.preventDefault();
    return Object.fromEntries(new FormData(el));
  }
  if (event.type === 'input' || event.type === 'change') {
    return el.type === 'checkbox' ? el.checked : el.value;
  }
  return undefined;
}

function bindEvent(el, name, handler) {
  if (typeof handler !== 'function') throw new Error(`sheratan: @${name} expects an intent function`);
  const item = rowItem(getOwner());
  const listener = item
    ? (event) => batch(() => handler(payloadOf(event), item()))
    : (event) => batch(() => handler(payloadOf(event)));
  el.addEventListener(name, listener);
  onDispose(() => el.removeEventListener(name, listener));
}

// Child holes insert content before their comment marker, which stays as the
// anchor. Returns the nodes now owned by the hole.
function bindChild(marker, value) {
  if (value instanceof Each) return value.mount(marker);
  if (!reactive(value)) return commit(marker, [], value);
  let nodes = [];
  onDispose(() => removeAll(nodes));
  watchFrame(() => {
    const next = value();
    nodes = commit(marker, nodes, next);
  });
}

function commit(marker, old, value) {
  if (value == null || value === false) {
    removeAll(old);
    return [];
  }
  if (value instanceof Template) {
    removeAll(old);
    let fragment;
    root(() => { fragment = instantiate(value); });
    const nodes = [...fragment.childNodes];
    marker.before(fragment);
    return nodes;
  }
  if (typeof value === 'object' && value.nodeType) {
    removeAll(old);
    marker.before(value);
    return [value];
  }
  const text = String(value);
  if (old.length === 1 && old[0].nodeType === TEXT) {
    if (old[0].data !== text) old[0].data = text;
    return old;
  }
  removeAll(old);
  const node = document.createTextNode(text);
  marker.before(node);
  return [node];
}

function removeAll(nodes) {
  for (const node of nodes) node.remove();
}

// ── each ────────────────────────────────────────────────────────────────

class Each {
  constructor(list, renderRow) {
    this.list = list;
    this.renderRow = renderRow;
  }

  mount(marker) {
    const owner = getOwner();
    let rows = new Map();
    const reconcile = (items) => {
      const next = new Map();
      for (const item of items) {
        const key = keyOf(item);
        if (next.has(key)) throw new Error(`sheratan: each() got a duplicate key ${JSON.stringify(key)}`);
        const row = rows.get(key);
        if (row) row.item.set(item);
        next.set(key, row ?? this.createRow(item, owner));
      }
      for (const [key, row] of rows) if (!next.has(key)) dropRow(row);
      let anchor = marker;
      for (const row of [...next.values()].reverse()) {
        if (row.nodes.at(-1).nextSibling !== anchor) {
          for (const node of row.nodes) anchor.before(node);
        }
        anchor = row.nodes[0];
      }
      rows = next;
    };
    onDispose(() => {
      for (const row of rows.values()) removeAll(row.nodes);
      rows = new Map();
    });
    if (reactive(this.list)) watchFrame(() => reconcile(this.list()));
    else reconcile(this.list);
  }

  createRow(value, owner) {
    const item = signal(value);
    let fragment;
    const dispose = root(() => {
      getOwner().row = item;
      fragment = instantiate(this.renderRow(item));
    }, owner);
    const nodes = fragment.childNodes.length ? [...fragment.childNodes] : [document.createTextNode('')];
    return { item, nodes, dispose };
  }
}

function dropRow(row) {
  row.dispose();
  removeAll(row.nodes);
}

// The innermost row owning this binding, including templates a row renders later.
function rowItem(owner) {
  for (let node = owner; node; node = node.parent) if (node.row) return node.row;
  return null;
}

function keyOf(item) {
  if (item === null || typeof item !== 'object') return item;
  if (item.id === undefined) throw new Error('sheratan: each() items that are objects need an `id` to key rows by');
  return item.id;
}

/**
 * Keyed list. The row function runs once per key and receives an accessor for
 * the row's item; a new object under the same key updates it in place.
 */
export const each = (list, renderRow) => new Each(list, renderRow);

// ── render ──────────────────────────────────────────────────────────────

/** Mount a view into `el`. Owns only the nodes it inserts. Returns the disposer. */
export function render(view, el) {
  return root(() => {
    let nodes = [];
    onDispose(() => removeAll(nodes)); // registered first, so it runs last
    const fragment = instantiate(view());
    nodes = [...fragment.childNodes];
    el.append(fragment);
  });
}
