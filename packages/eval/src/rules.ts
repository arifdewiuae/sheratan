// The three boundary rules the Week 0 gate tests (EVAL-TASKS §5), in the shape
// the real checker will emit (SPEC §8). Everything a rule says to the agent —
// message, fix, docs link — lives here, because that text is the thing under
// test: the hypothesis is that a machine-readable `fix` produces a one-turn
// repair, so the wording is an experimental variable, not a detail.

/** The rules this harness can see. The checker (Week 3) covers L001–L009. */
export const RuleCode = {
  /** A module reached past another module's `index.ts` (SPEC §4 import matrix). */
  Boundary: 'SHR-L001',
  /** A view called an I/O global (SPEC §4). */
  ViewIO: 'SHR-L002',
  /** Effects wrote a signal instead of invoking a transition (SPEC §4). */
  DirectWrite: 'SHR-L005',
} as const;

/** One of {@link RuleCode}. */
export type RuleCode = (typeof RuleCode)[keyof typeof RuleCode];

const DOCS = 'https://sheratan.dev/errors/';

/** One finding, in the shape SPEC §8 fixes and versions. */
export interface Finding {
  readonly code: RuleCode;
  readonly severity: 'error';
  readonly file: string;
  readonly range: { readonly line: number; readonly column: number };
  readonly message: string;
  readonly fix: string;
  readonly docs: string;
}

/** The docs URL for a code: the code without its prefix (SPEC §8). */
export function docsFor(code: RuleCode): string {
  return `${DOCS}${code.slice('SHR-'.length)}`;
}
