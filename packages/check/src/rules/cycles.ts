// SHR-L008 over lib/ (SPEC §4): a utility may use another, but never in a
// circle. A cycle has no first file to load and no file in it that can be
// read, tested or moved without the others. Type-only imports count: the
// dependency is real even when the import is erased.
//
// Tarjan's algorithm finds every cycle in O(files + imports); a breadth-first
// search inside each then picks the shortest loop to print, starting from the
// cycle's first file by name, so the same cycle is always reported the same way.

import { docsFor, RuleCode, Severity, type Finding, type Position } from '../finding.ts';
import { Layer, placeOf } from '../layout.ts';
import type { Program } from '../typescript.ts';

/** An import from one lib/ file to another. */
interface Edge {
  readonly to: string;
  readonly at: Position;
}

/** lib/ files by root-relative path, and what each imports from lib/. */
type Graph = ReadonlyMap<string, readonly Edge[]>;

/** Tarjan's bookkeeping for one file. */
interface Mark {
  readonly index: number;
  low: number;
}

const NO_EDGES: readonly Edge[] = [];

function libGraph(program: Program, root: string): Graph {
  const graph = new Map<string, readonly Edge[]>();

  for (const file of program.files) {
    const from = placeOf(root, file);

    if (from?.layer !== Layer.Lib) continue;

    const edges = program.importsOf(file).flatMap((edge) => {
      const to = edge.target === undefined ? undefined : placeOf(root, edge.target);

      return to?.layer === Layer.Lib ? [{ to: to.path, at: edge.at }] : [];
    });

    graph.set(from.path, edges);
  }

  return graph;
}

/** Strongly connected components: the files that can each reach every other. */
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

function finding(start: string, loop: readonly Edge[], at: Position): Finding {
  const path = [start, ...loop.map((edge) => edge.to)].join(' → ');

  return {
    code: RuleCode.Cycle,
    severity: Severity.Error,
    file: start,
    range: at,
    message: `${start} is part of an import cycle: ${path}; allowed: lib may import lib, never back round to itself.`,
    fix: 'Move what the files in the cycle share into a new lib/ file that imports none of them, and import that from each.',
    docs: docsFor(RuleCode.Cycle),
  };
}

/** One finding per import cycle among lib/ files. */
export function cycles(program: Program, root: string): Finding[] {
  const graph = libGraph(program, root);

  return components(graph).flatMap((component) => {
    const [start = ''] = component.toSorted();
    const loop = shortestLoop(graph, start, new Set(component));
    const [first] = loop;

    // A lone file that does not import itself is not a cycle.
    return first === undefined ? [] : [finding(start, loop, first.at)];
  });
}
