// What `sheratan explain` knows about one code (SPEC §10), and the shape both
// halves of the table — runtime and checker — are written in. An example is a
// set of files rather than a snippet because half the rules are about paths:
// a `shared/` folder, a missing test, two modules importing each other.

import type { RuleCode, Severity } from '../../../check/src/finding.ts';
import type { ErrorCode } from '../../../core/src/codes.ts';

/** Every code that has an explanation: what the runtime throws and what the checker reports. */
export type Code = ErrorCode | RuleCode;

/** Where a code is caught: before the app runs, or while it does. */
export const CaughtBy = {
  /** `sheratan check`, from the source. */
  Checker: 'checker',
  /** A `SheratanError` thrown in the browser. */
  Runtime: 'runtime',
} as const;

/** One of the places a code is caught. */
export type CaughtBy = (typeof CaughtBy)[keyof typeof CaughtBy];

/** Source text by path relative to the app root, in the order a reader should see it. */
export type ExampleFiles = Readonly<Record<string, string>>;

/** What a table entry holds. The code and the docs URL are derived from where it sits. */
export interface Entry {
  readonly severity: Severity;
  readonly caughtBy: CaughtBy;
  /** One line, as the list of every code prints it. */
  readonly title: string;
  /** Why the rule exists: what goes wrong without it. */
  readonly why: string;
  /** Code that is caught with this code. Tested to be, by `test/explain.test.ts`. */
  readonly wrong: ExampleFiles;
  /** The same intent written the way that is not caught. Tested too. */
  readonly right: ExampleFiles;
}

/** A whole explanation, as `sheratan explain <code> --json` prints it. */
export interface Explanation extends Entry {
  readonly code: Code;
  readonly docs: string;
}
