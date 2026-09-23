// `sheratan check`, as a plain function (TASKS Week 3: logic as functions, the
// CLI a thin wrapper over them).

import { dirname } from 'node:path';

import type { Finding } from './finding.ts';
import { boundary } from './rules/boundary.ts';
import { cancellable } from './rules/cancellable.ts';
import { cycles } from './rules/cycles.ts';
import { io } from './rules/io.ts';
import { shape } from './rules/shape.ts';
import { structure } from './rules/structure.ts';
import { surface } from './rules/surface.ts';
import { tested } from './rules/tested.ts';
import { openProgram } from './typescript.ts';

/** Which project to check. */
export interface CheckOptions {
  /** The project's `tsconfig.json`. */
  readonly tsconfig: string;
  /** The folder holding `app.ts`, `modules/` and `services/`. Defaults to the tsconfig's folder. */
  readonly root?: string;
}

function byLocation(left: Finding, right: Finding): number {
  const byFile = left.file.localeCompare(right.file);

  if (byFile !== 0) return byFile;

  if (left.range.line !== right.range.line) return left.range.line - right.range.line;

  return left.range.column - right.range.column;
}

/**
 * Type-checks the project and returns every violation, ordered by file and
 * position. An empty list is a clean project.
 *
 * @example
 * const findings = checkProject({ tsconfig: 'tsconfig.json' });
 */
export function checkProject(options: CheckOptions): readonly Finding[] {
  const root = options.root ?? dirname(options.tsconfig);

  using program = openProgram(options.tsconfig);

  return [boundary, io, structure, shape, cancellable, cycles, surface, tested]
    .flatMap((rule) => rule(program, root))
    .toSorted(byLocation);
}
