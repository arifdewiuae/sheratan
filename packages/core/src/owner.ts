// Ownership (SPEC §5b): everything created inside an owner dies with it.
// Children hang off an intrusive list, so attaching and detaching are O(1).

import { Flags, purgeDeps, setActiveSub, type Subscriber } from './graph.ts';
import { asDisposer, type Disposer } from './disposer.ts';
import { ErrorCode } from './codes.ts';
import { fail } from './errors.ts';
import type { Accessor } from './types.ts';

let activeOwner: OwnerNode | undefined;

/** A scope that owns watchers, derivations, cleanups and child scopes. */
export class OwnerNode {
  flags: number = Flags.None;

  parent: OwnerNode | undefined;

  firstChild: OwnerNode | undefined = undefined;

  lastChild: OwnerNode | undefined = undefined;

  prevSibling: OwnerNode | undefined = undefined;

  nextSibling: OwnerNode | undefined = undefined;

  cleanups: (() => void)[] | undefined = undefined;

  owned: Subscriber[] | undefined = undefined;

  /** The row this scope renders, inherited so a handler finds it in O(1). */
  row: Accessor<unknown> | undefined;

  constructor(parent: OwnerNode | undefined) {
    this.parent = parent;
    this.row = parent?.row;

    if (parent !== undefined) parent.append(this);
  }

  append(child: OwnerNode): void {
    const last = this.lastChild;

    child.prevSibling = last;

    if (last === undefined) this.firstChild = child;
    else last.nextSibling = child;

    this.lastChild = child;
  }

  detach(child: OwnerNode): void {
    const { prevSibling, nextSibling } = child;

    if (prevSibling === undefined) this.firstChild = nextSibling;
    else prevSibling.nextSibling = nextSibling;

    if (nextSibling === undefined) this.lastChild = prevSibling;
    else nextSibling.prevSibling = prevSibling;

    child.prevSibling = undefined;
    child.nextSibling = undefined;
  }

  /** Subscribers this scope keeps alive, e.g. derivations read untracked. */
  own(sub: Subscriber): void {
    (this.owned ??= []).push(sub);
  }

  /** Runs teardown for the scope's contents, leaving the scope itself usable. */
  reset(): void {
    let child = this.firstChild;

    while (child !== undefined) {
      const next = child.nextSibling;

      child.parent = undefined;
      child.dispose();
      child = next;
    }

    this.firstChild = undefined;
    this.lastChild = undefined;

    const owned = this.owned;

    this.owned = undefined;

    if (owned !== undefined) {
      for (const sub of owned) purgeDeps(sub);
    }

    this.runCleanups();
  }

  // Last registered runs first, so a subscription taken after the DOM exists
  // is torn down before the DOM is (SPEC §5b).
  private runCleanups(): void {
    const cleanups = this.cleanups;

    this.cleanups = undefined;

    if (cleanups === undefined) return;

    for (let index = cleanups.length - 1; index >= 0; index--) {
      const cleanup = cleanups[index];

      if (cleanup !== undefined) cleanup();
    }
  }

  /** Watchers drop their sources before their children are torn down. */
  teardown(): void {}

  dispose(): void {
    if ((this.flags & Flags.Disposed) !== 0) return;

    this.flags |= Flags.Disposed;
    this.parent?.detach(this);
    this.parent = undefined;
    this.teardown();
    this.reset();
  }
}

/** The scope currently mounting, if any. */
export function getOwner(): OwnerNode | undefined {
  return activeOwner;
}

/** Makes `next` the active scope and returns the previous one. */
export function setActiveOwner(next: OwnerNode | undefined): OwnerNode | undefined {
  const previous = activeOwner;

  activeOwner = next;

  return previous;
}

/** Runs `fn` with `node` as the active scope and tracking off, and restores both. */
function within<T>(node: OwnerNode, fn: () => T): T {
  const previousSub = setActiveSub(undefined);
  const previousOwner = setActiveOwner(node);

  try {
    return fn();
  } finally {
    setActiveSub(previousSub);
    setActiveOwner(previousOwner);
  }
}

/**
 * Runs `fn` in a fresh scope with tracking off, and returns its disposer.
 * `parent` defaults to the active scope; keyed rows pass a longer-lived one so
 * they survive re-runs of the watcher that reconciles them.
 */
export function root(fn: () => void, parent: OwnerNode | undefined = activeOwner): Disposer {
  const node = new OwnerNode(parent);

  within(node, fn);

  return asDisposer(() => {
    node.dispose();
  });
}

/** What `scope()` hands back: what its function returned, and how to end it. */
export interface Scoped<T> {
  readonly value: T;
  readonly dispose: Disposer;
}

/**
 * Runs `fn` under an owner of its own, with no DOM, and returns its result
 * and the disposer. For tests: effects need an owner, and `dispose()` tears
 * them down as an unmount would. App code is owned by being mounted (SPEC §5b).
 *
 * Detached from whatever owner is active, so only the returned disposer ends
 * it.
 *
 * @example
 * const { value: effects, dispose } = scope(() => createDevicesEffects(fake, createDevicesState()));
 * effects.start();
 * dispose(); // aborts what is in flight, as an unmount does
 */
export function scope<T>(fn: () => T): Scoped<T> {
  const node = new OwnerNode(undefined);
  const value = within(node, fn);

  return {
    value,
    dispose: asDisposer(() => {
      node.dispose();
    }),
  };
}

/**
 * Registers teardown for a subscription the runtime cannot see, such as
 * `addEventListener` or `setInterval`. Legal in `*.effects.ts` only (SHR-L004).
 *
 * @example
 * onDispose(() => window.removeEventListener('resize', onResize));
 */
export function onDispose(fn: () => void): void {
  if (activeOwner === undefined) fail(ErrorCode.DisposeOutsideOwner);

  (activeOwner.cleanups ??= []).push(fn);
}
