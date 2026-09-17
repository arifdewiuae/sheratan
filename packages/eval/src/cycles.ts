// A repair that satisfies one rule can break another the harness was never
// asked to look at. `SHR-L008` (the module import graph is acyclic) is not one
// of the three classes this gate measures, so a cycle is recorded next to the
// verdict rather than counted in it — the agent was never shown that rule, and
// scoring it on one would not be the experiment EVAL §2.3 describes.

import type { SourceFile } from './source.ts';

/** Only what survives compilation: `import type` is erased and cannot cycle. */
const VALUE_IMPORT = /(?:^|\n)\s*import\s+(?!type\s)[^\n]*?from\s*(['"])([^'"]+)\1/g;

const MODULE = /(?:^|\/)modules\/([^/]+)\//;
const SIBLING = /^\.\.\/([^/]+)\//;

function edgesOf(files: readonly SourceFile[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const owner = MODULE.exec(file.path)?.[1];

    if (owner === undefined) continue;

    const out = graph.get(owner) ?? new Set<string>();

    // On the raw text: blanking a string would empty the specifier itself.
    for (const match of file.text.matchAll(VALUE_IMPORT)) {
      const other = SIBLING.exec(match[2] as string)?.[1];

      if (other !== undefined && other !== owner) out.add(other);
    }

    graph.set(owner, out);
  }

  return graph;
}

function reaches(graph: Map<string, Set<string>>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];

  while (stack.length > 0) {
    const at = stack.pop() as string;

    if (at === to) return true;
    if (seen.has(at)) continue;

    seen.add(at);
    stack.push(...(graph.get(at) ?? []));
  }

  return false;
}

/** Module pairs that import each other at runtime, directly or through others. */
export function runtimeCycles(files: readonly SourceFile[]): string[] {
  const graph = edgesOf(files);
  const found: string[] = [];

  for (const [owner, out] of graph) {
    for (const other of out) {
      if (owner < other && reaches(graph, other, owner)) found.push(`${owner} <-> ${other}`);
    }
  }

  return found.toSorted();
}
