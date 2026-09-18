// SHR-L001: every cell of the import matrix (SPEC §4), including a deep import
// past another module's index.ts.

import { docsFor, RuleCode, Severity, type Finding } from '../finding.ts';
import { placeOf } from '../layout.ts';
import { judge } from '../matrix.ts';
import type { Program } from '../typescript.ts';

/** Every import the matrix does not allow, in every file of the layout. */
export function boundary(program: Program, root: string): Finding[] {
  const findings: Finding[] = [];

  for (const file of program.files) {
    const from = placeOf(root, file);

    if (from === undefined) continue;

    for (const edge of program.importsOf(file)) {
      // A package, or a file outside the layout: not the matrix's business.
      const to = edge.target === undefined ? undefined : placeOf(root, edge.target);
      const verdict = to === undefined ? undefined : judge({ from, to, typeOnly: edge.typeOnly });

      if (verdict === undefined) continue;

      findings.push({
        code: RuleCode.Boundary,
        severity: Severity.Error,
        file: from.path,
        range: edge.at,
        message: verdict.message,
        fix: verdict.fix,
        docs: docsFor(RuleCode.Boundary),
      });
    }
  }

  return findings;
}
