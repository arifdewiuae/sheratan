// Immutability enforcement (SPEC §5). Freezing is incremental: a subtree that
// is already frozen is left alone, so with structural sharing the cost is
// bounded by the nodes the caller just allocated.

/** Class instances, DOM nodes, Map, Set and Date break when frozen. */
function isFreezable(value: object): boolean {
  if (Array.isArray(value)) return true;

  const proto: unknown = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/** Collects the children of an object that still need freezing. */
function pushChildren(value: object, pending: object[]): void {
  const members = value as Record<string, unknown>;

  for (const key in members) {
    const child = members[key];

    if (typeof child !== 'object' || child === null) continue;

    if (!Object.isFrozen(child) && isFreezable(child)) pending.push(child);
  }
}

/**
 * Deep-freezes plain objects and arrays so a later mutation throws, and leaves
 * every other value untouched. Iterative, so a deep tree cannot overflow the
 * stack; a cycle terminates because each node is frozen before it is followed.
 */
export function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;

  const root: object = value;

  if (Object.isFrozen(root) || !isFreezable(root)) return value;

  const pending: object[] = [root];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) continue;

    Object.freeze(current);
    pushChildren(current, pending);
  }

  return value;
}
