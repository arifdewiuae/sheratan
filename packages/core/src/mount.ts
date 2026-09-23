// Composing modules (SPEC §9a). A complex component is a module, so a view
// has to be able to render another module — without importing it, which the
// import matrix forbids (SHR-L001). The instance is built where its
// dependencies already exist, in `app.ts` or in the parent's effects, and
// handed to the view as a value. The view constructs nothing, touches no
// foreign state and invokes no foreign effects, so it stays a pure function of
// what it was given: composition lives in the wiring.

import { ErrorCode } from './codes.ts';
import { removeAll } from './dom.ts';
import { fail } from './errors.ts';
import { instantiate } from './instantiate.ts';
import { MOUNT, type Mountable } from './mountable.ts';
import { onDispose, root } from './owner.ts';
import type { Template } from './template.ts';

/** A module's view, as a function of the props its parent passes in. */
export type ModuleView<P = void> = (props: P) => Template;

/** A module placed in a child hole. */
export type Mounted = Mountable;

/** One module instance in one hole, with the scope that owns its lifetime. */
class Child implements Mountable {
  private readonly view: () => Template;

  private nodes: ChildNode[] = [];

  private placed = false;

  constructor(view: () => Template) {
    this.view = view;
  }

  [MOUNT](marker: Comment): void {
    if (this.placed) fail(ErrorCode.MountedTwice);

    this.placed = true;

    // A scope of the child's own, hanging off the parent's: when the parent
    // unmounts, the child is disposed with it, and so is everything it owns.
    root(() => {
      // Registered first, so it runs last: the child's watchers stop before
      // its nodes leave the page (SPEC §5b).
      onDispose(() => {
        removeAll(this.nodes);
      });

      const fragment = instantiate(this.view());

      this.nodes = [...fragment.childNodes];
      marker.before(fragment);
    });
  }
}

/**
 * Renders another module inside this one. Its lifetime is bound to the
 * parent's: when the parent unmounts, the child is disposed.
 *
 * @example
 * html`<aside>${mount(activity)}</aside>`
 */
export function mount(view: ModuleView): Mounted;

/**
 * Renders another module inside this one, with props. Props carry accessors
 * rather than values, so the child's own holes update and nothing re-renders;
 * the argument is omitted when the module's view takes none. Its lifetime is
 * bound to the parent's: when the parent unmounts, the child is disposed.
 *
 * @example
 * const ordersTable = createOrdersTable(api);
 * html`<section>${mount(ordersTable, { customerId: s.id })}</section>`
 */
export function mount<P>(view: ModuleView<P>, props: P): Mounted;

export function mount<P>(view: ModuleView<P>, props?: P): Mounted {
  // The overloads hand over props exactly when the view declares them.
  return new Child(() => view(props as P));
}
