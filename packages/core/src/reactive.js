// Reactive core (SPEC §5, §5b): signals, computeds, watchers, owners and the
// frame scheduler. Push dirtiness, pull values: a write marks direct observers
// DIRTY and everything downstream CHECK; a read re-validates CHECK nodes from
// their sources in order, so a computed never sees a half-applied update.

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

const RERUN_LIMIT = 100; // re-runs of one watcher within one drain

let tracking = null; // node collecting sources during its run
let owner = null;    // owner receiving new watchers, computeds and cleanups
let batchDepth = 0;
let live = 0;        // source→observer edges; the leak test counts these

const syncQueue = [];
const frameQueue = [];
let frameRequested = false;
let drainId = 0;

// ── Graph ───────────────────────────────────────────────────────────────

function link(node, source) {
  if (node.sources.has(source)) return;
  node.sources.add(source);
  if (source.observers.has(node)) return; // kept from the previous run
  source.observers.add(node);
  live++;
}

function unlink(node, sources, keep) {
  for (const source of sources) {
    if (keep?.has(source)) continue;
    source.observers.delete(node);
    live--;
  }
}

// A write reaching a node that is mid-run (a watcher writing what it already
// read) cannot be absorbed by its DIRTY state, so it is recorded as a re-run.
function mark(node, state, fromWrite) {
  if (fromWrite && node.running) {
    node.rerun = true;
    return;
  }
  if (node.state >= state) return;
  const wasClean = node.state === CLEAN;
  node.state = state;
  if (!wasClean) return;
  if (node.isWatcher) enqueue(node);
  else for (const o of node.observers) mark(o, CHECK);
}

function update(node) {
  if (node.state === CHECK) {
    for (const source of node.sources) {
      if (source.fn) update(source);
      if (node.state === DIRTY) break;
    }
    if (node.state === CHECK) node.state = CLEAN;
  }
  if (node.state === DIRTY) run(node);
}

function run(node) {
  const prevTracking = tracking;
  const prevOwner = owner;
  const oldSources = node.sources;
  node.sources = new Set();
  node.running = true;
  node.rerun = false;
  tracking = node;
  if (node.isWatcher) {
    reset(node);
    owner = node;
  }
  try {
    const value = node.fn();
    if (!node.isWatcher && !Object.is(value, node.value)) {
      node.value = value;
      for (const o of node.observers) mark(o, DIRTY);
    }
    node.state = CLEAN;
  } catch (err) {
    node.state = node.isWatcher ? CLEAN : DIRTY; // a computed retries on next read
    throw err;
  } finally {
    tracking = prevTracking;
    owner = prevOwner;
    node.running = false;
    unlink(node, oldSources, node.sources);
  }
  if (node.rerun) {
    node.rerun = false;
    mark(node, DIRTY);
  }
}

// ── Public primitives ───────────────────────────────────────────────────

export function signal(initial) {
  const node = { value: initial, observers: new Set() };
  const read = () => {
    if (tracking) link(tracking, node);
    return node.value;
  };
  read.set = (value) => {
    if (Object.is(value, node.value)) return;
    node.value = value;
    batch(() => {
      for (const o of node.observers) mark(o, DIRTY, true);
    });
  };
  return read;
}

export function computed(fn) {
  const node = { fn, value: undefined, state: DIRTY, sources: new Set(), observers: new Set() };
  if (owner) addCleanup(owner, () => {
    unlink(node, node.sources);
    node.sources.clear();
  });
  return () => {
    update(node);
    if (tracking) link(tracking, node);
    return node.value;
  };
}

export function watch(fn) {
  return createWatcher(fn, false);
}

/** A watcher whose re-runs wait for the next frame. Used by template holes. */
export function watchFrame(fn) {
  return createWatcher(fn, true);
}

function createWatcher(fn, frame) {
  const node = createOwner(owner);
  Object.assign(node, { fn, state: DIRTY, sources: new Set(), isWatcher: true, frame });
  batch(() => run(node));
  return () => dispose(node);
}

export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) drain(syncQueue);
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────

function enqueue(node) {
  if (node.drainId !== drainId) {
    node.drainId = drainId;
    node.reruns = 0;
  } else if (++node.reruns > RERUN_LIMIT) {
    throw new Error('sheratan: watchers did not settle (a watcher keeps writing what it reads)');
  }
  if (node.frame) {
    frameQueue.push(node);
    requestFrame();
  } else {
    syncQueue.push(node);
  }
}

function drain(queue) {
  drainId++;
  batchDepth++;
  try {
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (!node.disposed) update(node);
    }
  } finally {
    queue.length = 0;
    batchDepth--;
  }
}

function requestFrame() {
  if (frameRequested) return;
  frameRequested = true;
  const schedule = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
  schedule(() => {
    if (frameRequested) flush();
  });
}

/** Run pending frame work synchronously (tests, layout measurement). */
export function flush() {
  frameRequested = false;
  batch(() => drain(frameQueue));
}

// ── Ownership ───────────────────────────────────────────────────────────

function createOwner(parent) {
  const node = { parent, children: null, cleanups: null, disposed: false };
  if (parent) (parent.children ??= new Set()).add(node);
  return node;
}

function addCleanup(node, fn) {
  (node.cleanups ??= []).push(fn);
}

// Order (SPEC §5b): child watchers stop → cleanups run, last registered first,
// so a subscription registered after the DOM is torn down before the DOM.
function reset(node) {
  if (node.children) {
    for (const child of node.children) dispose(child);
    node.children = null;
  }
  const cleanups = node.cleanups;
  node.cleanups = null;
  if (cleanups) for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]();
}

function dispose(node) {
  if (node.disposed) return;
  node.disposed = true;
  node.parent?.children?.delete(node);
  if (node.sources) {
    unlink(node, node.sources);
    node.sources.clear();
  }
  reset(node);
}

export function onDispose(fn) {
  if (!owner) throw new Error('sheratan: onDispose() called outside an owner; call it inside *.effects.ts while the module mounts');
  addCleanup(owner, fn);
}

/**
 * Run fn in a new owner with tracking off. Returns the disposer. `parent`
 * defaults to the current owner; keyed rows pass a longer-lived one so they
 * survive re-runs of the watcher that reconciles them.
 */
export function root(fn, parent = owner) {
  const node = createOwner(parent);
  const prevTracking = tracking;
  const prevOwner = owner;
  tracking = null;
  owner = node;
  try {
    fn();
  } finally {
    tracking = prevTracking;
    owner = prevOwner;
  }
  return () => dispose(node);
}

export const getOwner = () => owner;

export const liveSubscriptions = () => live;
