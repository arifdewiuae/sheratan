// The dependency graph (SPEC §5): push dirtiness, pull values.
//
// Edges are doubly-linked on both sides, so linking and unlinking are O(1) and
// a re-run that reads the same sources allocates nothing — it walks the links
// it already has. Propagation and re-validation use explicit stacks: a deep
// graph must not overflow the call stack.

/** Node state and kind, as bits on one field. */
export const Flags = {
  None: 0,
  /** A derivation, so dirtiness travels through it. */
  Computed: 1,
  /** Re-runs wait for the next animation frame. */
  Frame: 2,
  /** A source definitely changed: re-run. */
  Dirty: 4,
  /** A source may have changed: re-validate before running. */
  Pending: 8,
  /** Already waiting in a scheduler queue. */
  Queued: 16,
  /** Torn down; never runs again. */
  Disposed: 32,
} as const;

/** One bit of {@link Flags}. */
export type Flag = (typeof Flags)[keyof typeof Flags];

/** A node in the graph; every node carries {@link Flags}. */
export interface ReactiveNode {
  flags: number;
}

/** Something that can be read and depended on: a signal or a computed. */
export interface Dependency extends ReactiveNode {
  subs: Link | undefined;
  subsTail: Link | undefined;
}

/** Something that reads dependencies: a computed or a watcher. */
export interface Subscriber extends ReactiveNode {
  deps: Link | undefined;
  depsTail: Link | undefined;
}

/** A computed re-validates itself and reports whether its value changed. */
export interface Derivation extends Dependency, Subscriber {
  refresh(): boolean;
}

/** A watcher is told when something it read changed. */
export interface Observer extends Subscriber {
  notify(): void;
}

/** One dependency→subscriber edge, threaded into both nodes' lists. */
export interface Link {
  dep: Dependency;
  sub: Subscriber;
  prevSub: Link | undefined;
  nextSub: Link | undefined;
  prevDep: Link | undefined;
  nextDep: Link | undefined;
}

let activeSub: Subscriber | undefined;
let live = 0;

// Reused across calls; each function pops exactly what it pushed, so nesting
// (a computed refreshing inside another's re-validation) is safe.
const staleComputeds: Derivation[] = [];
const unwatched: Derivation[] = [];
const frameSubs: Subscriber[] = [];
const frameLinks: Link[] = [];

/** Makes `next` the recording subscriber and returns the previous one. */
export function setActiveSub(next: Subscriber | undefined): Subscriber | undefined {
  const previous = activeSub;

  activeSub = next;

  return previous;
}

/** Live dependency→subscriber edges. The leak tests watch this number. */
export function liveSubscriptions(): number {
  return live;
}

/** Records that the running subscriber read `dep`. */
export function track(dep: Dependency): void {
  if (activeSub !== undefined) link(dep, activeSub);
}

// The same source in the same order as the last run keeps its edge, so a
// re-run that reads what it read before allocates nothing.
function reuses(dep: Dependency, sub: Subscriber, prevDep: Link | undefined): boolean {
  if (prevDep?.dep === dep) return true;

  const nextDep = prevDep === undefined ? sub.deps : prevDep.nextDep;

  if (nextDep === undefined || nextDep.dep !== dep) return false;

  sub.depsTail = nextDep;

  return true;
}

function insertEdge(dep: Dependency, sub: Subscriber, prevDep: Link | undefined): void {
  const nextDep = prevDep === undefined ? sub.deps : prevDep.nextDep;
  const prevSub = dep.subsTail;
  const edge: Link = { dep, sub, prevDep, nextDep, prevSub, nextSub: undefined };

  if (prevDep === undefined) sub.deps = edge;
  else prevDep.nextDep = edge;

  if (nextDep !== undefined) nextDep.prevDep = edge;

  if (prevSub === undefined) dep.subs = edge;
  else prevSub.nextSub = edge;

  dep.subsTail = edge;
  sub.depsTail = edge;
  live++;
}

function link(dep: Dependency, sub: Subscriber): void {
  const prevDep = sub.depsTail;

  if (reuses(dep, sub, prevDep)) return;

  // Already this subscriber's newest edge: the same source read twice.
  if (dep.subsTail?.sub === sub) return;

  insertEdge(dep, sub, prevDep);
}

function unlink(edge: Link): void {
  const { dep, prevSub, nextSub } = edge;

  if (prevSub === undefined) dep.subs = nextSub;
  else prevSub.nextSub = nextSub;

  if (nextSub === undefined) dep.subsTail = prevSub;
  else nextSub.prevSub = prevSub;

  live--;

  if (dep.subs === undefined && (dep.flags & Flags.Computed) !== 0) {
    unwatched.push(dep as Derivation);
  }
}

function unlinkFrom(edge: Link | undefined): void {
  let current = edge;

  while (current !== undefined) {
    const next = current.nextDep;

    unlink(current);
    current = next;
  }
}

// A computed nobody observes stops holding its sources: it drops its edges and
// recomputes on the next read. Without this, a disposed view would keep its
// derivations subscribed to long-lived signals.
function releaseUnwatched(): void {
  while (unwatched.length > 0) {
    const computed = unwatched.pop() as Derivation;

    if (computed.subs !== undefined) continue;

    computed.flags |= Flags.Dirty;

    const deps = computed.deps;

    computed.deps = undefined;
    computed.depsTail = undefined;
    unlinkFrom(deps);
  }
}

/** Starts recording reads for `sub`; edges are matched against the last run. */
export function startTracking(sub: Subscriber): void {
  sub.depsTail = undefined;
}

/** Stops recording and drops the sources `sub` no longer reads. */
export function endTracking(sub: Subscriber): void {
  const tail = sub.depsTail;
  const stale = tail === undefined ? sub.deps : tail.nextDep;

  if (tail === undefined) sub.deps = undefined;
  else tail.nextDep = undefined;

  unlinkFrom(stale);
  releaseUnwatched();
}

/** Drops every source of `sub`, on disposal. */
export function purgeDeps(sub: Subscriber): void {
  const deps = sub.deps;

  sub.deps = undefined;
  sub.depsTail = undefined;
  unlinkFrom(deps);
  releaseUnwatched();
}

/** Recomputes a derivation and tells anyone waiting on it that it changed. */
export function revalidate(computed: Derivation): boolean {
  const changed = computed.refresh();

  // Subscribers that are only Pending would otherwise conclude "nothing
  // changed" when they re-validate after this computed was already refreshed.
  if (changed) shallowPropagate(computed.subs);

  return changed;
}

function mark(sub: Subscriber, level: number): void {
  const known = (sub.flags & (Flags.Dirty | Flags.Pending)) !== 0;

  sub.flags |= level;

  if (known) return;

  if ((sub.flags & Flags.Computed) !== 0) staleComputeds.push(sub as Derivation);
  else (sub as Observer).notify();
}

/** Marks direct subscribers dirty and everything downstream pending. */
export function propagate(subs: Link | undefined): void {
  const base = staleComputeds.length;

  for (let edge = subs; edge !== undefined; edge = edge.nextSub) mark(edge.sub, Flags.Dirty);

  while (staleComputeds.length > base) {
    const computed = staleComputeds.pop() as Derivation;

    for (let edge = computed.subs; edge !== undefined; edge = edge.nextSub) {
      mark(edge.sub, Flags.Pending);
    }
  }
}

/** Upgrades pending subscribers to dirty after a value really changed. */
export function shallowPropagate(subs: Link | undefined): void {
  for (let edge = subs; edge !== undefined; edge = edge.nextSub) {
    const sub = edge.sub;

    if ((sub.flags & (Flags.Dirty | Flags.Pending)) === Flags.Pending) sub.flags |= Flags.Dirty;
  }
}

/**
 * Re-validates a pending subscriber: walks its sources in order, refreshing
 * computeds only as far as needed, and stops at the first one that changed.
 */
export function checkDirty(start: Subscriber): boolean {
  const base = frameSubs.length;

  let sub = start;
  let edge = sub.deps;
  let dirty = false;

  for (;;) {
    while (!dirty && edge !== undefined) {
      const dep = edge.dep;

      if ((dep.flags & Flags.Computed) === 0) {
        edge = edge.nextDep;
        continue;
      }

      const computed = dep as Derivation;

      if ((computed.flags & Flags.Dirty) !== 0) {
        dirty = revalidate(computed);
        continue;
      }

      if ((computed.flags & Flags.Pending) !== 0) {
        frameSubs.push(sub);
        frameLinks.push(edge);
        sub = computed;
        edge = computed.deps;
        continue;
      }

      edge = edge.nextDep;
    }

    if (frameSubs.length === base) return dirty;

    // `sub` is a pending computed whose own sources have now been checked.
    if (dirty) dirty = revalidate(sub as Derivation);
    else sub.flags &= ~Flags.Pending;

    const parent = frameLinks.pop() as Link;

    sub = frameSubs.pop() as Subscriber;
    edge = dirty ? parent : parent.nextDep;
  }
}
