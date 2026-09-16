// DOM constants and the one insertion primitive (SPEC §9).

/** `Node.nodeType` values the runtime looks at. */
export const NodeType = {
  Element: 1,
  Text: 3,
  Comment: 8,
} as const;

/** One of {@link NodeType}. */
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

interface MovingParent {
  moveBefore(node: Node, anchor: Node | null): void;
}

function canMove(parent: Node & Partial<MovingParent>, node: Node): boolean {
  return typeof parent.moveBefore === 'function' && parent.isConnected && node.isConnected;
}

/**
 * Puts `node` before `anchor`. Uses `moveBefore` where the browser has it, so
 * a moved row keeps focus, selection, playing media and iframe state instead
 * of being removed and re-inserted.
 */
export function place(parent: Node, node: Node, anchor: Node | null): void {
  const mover = parent as Node & Partial<MovingParent>;

  if (canMove(mover, node) && mover.moveBefore !== undefined) {
    mover.moveBefore(node, anchor);

    return;
  }

  parent.insertBefore(node, anchor);
}

/** Removes nodes a hole or a row owns. */
export function removeAll(nodes: readonly ChildNode[]): void {
  for (const node of nodes) node.remove();
}
