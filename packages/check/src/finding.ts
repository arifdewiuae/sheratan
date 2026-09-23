// The checker's output (SPEC §8). This shape is a public API and is versioned:
// an agent matches on `code`, reads `range`, and applies `fix`.

// One home for the docs origin, shared with the runtime's production errors:
// both halves of the framework send you to the same page for the same code.
import { DOCS_BASE_URL } from '../../core/src/codes.ts';

/** The rules this checker reports. Codes are stable and never reused (SPEC §4). */
export const RuleCode = {
  /** An import the matrix does not allow, including a deep import past another module's `index.ts`. */
  Boundary: 'SHR-L001',
  /** A view or a state file does I/O, reads the page or schedules work. */
  Io: 'SHR-L002',
  /** A file the layout has no place for: a `shared/` directory, or a folder inside a `ui/` component. */
  Structure: 'SHR-L003',
  /** An import cycle between modules, or among `lib/` files. */
  Cycle: 'SHR-L008',
  /** A `*.state.ts` public surface hands out a writable `Signal`. */
  StateSurface: 'SHR-L010',
} as const;

/** One of the rule codes this checker reports. */
export type RuleCode = (typeof RuleCode)[keyof typeof RuleCode];

/** How loud a finding is. Only `error` fails `sheratan check`. */
export const Severity = {
  Error: 'error',
  Warning: 'warning',
} as const;

/** One of the severities. */
export type Severity = (typeof Severity)[keyof typeof Severity];

/** A place in a file, 1-based, as an editor shows it. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** One violation, in the shape SPEC §8 fixes. */
export interface Finding {
  readonly code: RuleCode;
  readonly severity: Severity;
  /** Relative to the app root, with forward slashes, so it reads the same on every machine. */
  readonly file: string;
  readonly range: Position;
  /** What is wrong, naming the allowed set rather than a rule number. */
  readonly message: string;
  /** What to write instead. */
  readonly fix: string;
  readonly docs: string;
}

/** The page for a code: the whole code, exactly as the finding prints it (SPEC §4). */
export function docsFor(code: RuleCode): string {
  return DOCS_BASE_URL + code;
}
