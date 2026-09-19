// SHR-L008 (SPEC §4): no import cycle among modules, and none among lib/
// files. A cycle has no first node to load and nothing in it that can be read,
// tested or moved without the rest. Type-only imports count: the dependency is
// real even when the import is erased.
//
// The two graphs differ only in what a node is. Among lib/ files a node is a
// file; among modules it is the whole module, so an import between two of one
// module's own files is structure, not a dependency.
//
// Tarjan's algorithm finds every cycle in O(files + imports); a breadth-first
// search inside each then picks the shortest loop to print, starting from the
// cycle's first node by name, so the same cycle is always reported the same way.

import { docsFor, RuleCode, Severity, type Finding, type Position } from '../finding.ts';
import { Layer, NO_MODULE, placeOf, type Place } from '../layout.ts';
import type { Program } from '../typescript.ts';

/** An import from one node to another, and the file and position that make it. */
interface Edge {
  readonly file: string;
  readonly to: string;
  readonly at: Position;
}

/** Nodes by name, and the edges leaving each. */
type Graph = ReadonlyMap<string, readonly Edge[]>;

/** Tarjan's bookkeeping for one node. */
interface Mark {
  readonly index: number;
  low: number;
}

/** One graph the rule walks: what a node is, and how a cycle in it is explained. */
interface Scope {
  /** The node a file belongs to, or nothing when the file is not in this graph. */
  readonly nodeOf: (place: Place) => string | undefined;
  readonly allowed: string;
  readonly fix: string;
}

/** What one graph is built from. */
interface Walk {
  readonly program: Program;
  readonly root: string;
  readonly scope: Scope;
}

const NO_EDGES: readonly Edge[] = [];

const LIB: Scope = {
  nodeOf: (place) => (place.layer === Layer.Lib ? place.path : undefined),
  allowed: 'lib may import lib, never back round to itself',
  fix: 'Move what the files in the cycle share into a new lib/ file that imports none of them, and import that from each.',
};

const MODULES: Scope = {
  nodeOf: (place) => (place.module === NO_MODULE ? undefined : `modules/${place.module}`),
  allowed: 'a module may use another, never one that leads back to itself',
  fix: 'Decide which module depends on the other and remove the import going the opposite way: move what both need into services/ if it does I/O or lib/ if it is pure, and import it from each.',
};

/**
 * An import between two files of one node is structure, not a dependency.
 * A file importing itself is still a loop.
 */
function isInternal(from: Place, to: Place, scope: Scope): boolean {
  return to.path !== from.path && scope.nodeOf(to) === scope.nodeOf(from);
}

function edgesOf({ program, root, scope }: Walk, file: string, from: Place): Edge[] {
  return program.importsOf(file).flatMap((edge) => {
    const place = edge.target === undefined ? undefined : placeOf(root, edge.target);
    const to = place === undefined ? undefined : scope.nodeOf(place);

    if (place === undefined || to === undefined || isInternal(from, place, scope)) return [];

    return [{ file: from.path, to, at: edge.at }];
  });
}

function graphOf(walk: Walk): Graph {
  const graph = new Map<string, Edge[]>();

  for (const file of walk.program.files) {
    const from = placeOf(walk.root, file);
    const node = from === undefined ? undefined : walk.scope.nodeOf(from);

    if (from === undefined || node === undefined) continue;

    const edges = graph.get(node) ?? [];

    edges.push(...edgesOf(walk, file, from));
    graph.set(node, edges);
  }

  return graph;
}

/** Strongly connected components: the nodes that can each reach every other. */
function components(graph: Graph): string[][] {
  const marks = new Map<string, Mark>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];

  const close = (node: string): void => {
    const component = stack.splice(stack.lastIndexOf(node));

    for (const member of component) onStack.delete(member);

    found.push(component);
  };

  const visit = (node: string): Mark => {
    const mark: Mark = { index: marks.size, low: marks.size };

    marks.set(node, mark);
    stack.push(node);
    onStack.add(node);

    for (const { to } of graph.get(node) ?? NO_EDGES) {
      const seen = marks.get(to);

      // Unvisited: descend. Still on the stack: part of the component being built.
      if (seen === undefined) mark.low = Math.min(mark.low, visit(to).low);
      else if (onStack.has(to)) mark.low = Math.min(mark.low, seen.index);
    }

    if (mark.low === mark.index) close(node);

    return mark;
  };

  for (const node of graph.keys()) {
    if (!marks.has(node)) visit(node);
  }

  return found;
}

/** The imports that walk back from `node` to `start`, in order from `start`. */
function pathBack(
  parents: ReadonlyMap<string, { readonly from: string; readonly edge: Edge }>,
  start: string,
  node: string,
): Edge[] {
  const edges: Edge[] = [];
  let step = parents.get(node);

  while (step !== undefined) {
    edges.push(step.edge);
    step = step.from === start ? undefined : parents.get(step.from);
  }

  return edges.toReversed();
}

/** The shortest loop from `start` back to itself inside one component, or none. */
function shortestLoop(graph: Graph, start: string, members: ReadonlySet<string>): readonly Edge[] {
  const parents = new Map<string, { readonly from: string; readonly edge: Edge }>();
  const queue = [start];

  for (const node of queue) {
    for (const edge of graph.get(node) ?? NO_EDGES) {
      if (edge.to === start) return [...pathBack(parents, start, node), edge];

      if (!members.has(edge.to) || parents.has(edge.to)) continue;

      parents.set(edge.to, { from: node, edge });
      queue.push(edge.to);
    }
  }

  return NO_EDGES;
}

function finding(start: string, loop: readonly Edge[], first: Edge, scope: Scope): Finding {
  const path = [start, ...loop.map((edge) => edge.to)].join(' → ');

  return {
    code: RuleCode.Cycle,
    severity: Severity.Error,
    file: first.file,
    range: first.at,
    message: `${first.file} is part of an import cycle: ${path}; allowed: ${scope.allowed}.`,
    fix: scope.fix,
    docs: docsFor(RuleCode.Cycle),
  };
}

function cyclesIn(walk: Walk): Finding[] {
  const graph = graphOf(walk);

  return components(graph).flatMap((component) => {
    const [start = ''] = component.toSorted();
    const loop = shortestLoop(graph, start, new Set(component));
    const [first] = loop;

    // A lone node that does not import itself is not a cycle.
    return first === undefined ? [] : [finding(start, loop, first, walk.scope)];
  });
}

/** One finding per import cycle among modules, and per cycle among lib/ files. */
export function cycles(program: Program, root: string): Finding[] {
  return [MODULES, LIB].flatMap((scope) => cyclesIn({ program, root, scope }));
}
