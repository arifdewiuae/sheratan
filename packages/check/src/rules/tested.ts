// SHR-T001 (SPEC §4): a module's state and effects have tests beside them.
// A warning, not an error, because a mandatory test file produces an empty
// test file — and the two layers named here are the two the architecture
// makes cheap to test: state is a pure function, and effects is the only
// place a fake transport is needed. A view is a snapshot of state and is not
// asked for.
//
// This is the one rule that reads the disk rather than the program: a project
// that keeps tests out of its `tsconfig.json` still has them, and a checker
// that called those modules untested would be reporting the build config.

import { existsSync } from 'node:fs';

import { docsFor, FILE_START, RuleCode, Severity, type Finding } from '../finding.ts';
import { Layer, placeOf, type Place } from '../layout.ts';
import type { Program } from '../typescript.ts';

/** What the test file is called, in place of the source file's extension. */
const SOURCE_EXTENSION = /\.ts$/;

const TEST_EXTENSION = '.test.ts';

/** The layers a missing test is reported for, and what writing one looks like. */
const TESTED: ReadonlyMap<Layer, string> = new Map([
  [
    Layer.State,
    'a state file is a pure function, so a test calls a transition and reads the accessors — no DOM and no mocks',
  ],
  [
    Layer.Effects,
    'hand the effects factory a fake contract, run the effect, and assert which transition it invoked',
  ],
]);

function untested(place: Place, hint: string): Finding {
  const beside = place.path.replace(SOURCE_EXTENSION, TEST_EXTENSION);

  return {
    code: RuleCode.Tested,
    severity: Severity.Warning,
    file: place.path,
    range: FILE_START,
    message: `${place.path} has no tests; a module's state and effects are tested beside the file they cover, as ${beside}.`,
    fix: `Add ${beside} — ${hint}.`,
    docs: docsFor(RuleCode.Tested),
  };
}

/** Every state and effects file with no test file beside it. */
export function tested(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);

    if (place === undefined) return [];

    const hint = TESTED.get(place.layer);

    if (hint === undefined) return [];

    return existsSync(file.replace(SOURCE_EXTENSION, TEST_EXTENSION))
      ? []
      : [untested(place, hint)];
  });
}
