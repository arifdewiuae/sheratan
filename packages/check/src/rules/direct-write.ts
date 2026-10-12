// SHR-L005 (SPEC §4, §13): `*.effects.ts` changes state only by calling a
// transition exported by `*.state.ts`. SHR-L010 makes the write a type error
// by keeping the Signal inside the state file; this is the backstop for when
// the surface is already wrong — a partly repaired module, a widened
// interface — and it is best-effort: a signal handed to a `lib/` helper and
// written there is out of its sight.
//
// A write is found by the receiver's type, not its name, so a signal held in
// a variable or destructured off the state object is still one. A signal
// effects created for itself counts too: effects sequence, state decides.

import { docsFor, RuleCode, Severity, type Finding } from '../finding.ts';
import { Layer, NO_MODULE, placeOf, type Place } from '../layout.ts';
import type { Program, WriteUse } from '../typescript.ts';

/** Where a fix points when the file belongs to no module of its own. */
const SOME_STATE_FILE = 'the state file of a module';

function stateFile(place: Place): string {
  return place.module === NO_MODULE ? SOME_STATE_FILE : `${place.module}.state.ts`;
}

function finding(place: Place, { target, at }: WriteUse): Finding {
  const state = stateFile(place);

  return {
    code: RuleCode.DirectWrite,
    severity: Severity.Error,
    file: place.path,
    range: at,
    message: `${place.path} writes \`${target}\` directly; effects change state only by calling a transition exported by ${state}.`,
    fix: `Add a transition to ${state} that makes this write, call it here instead, and keep the Signal inside the state file behind an Accessor (SHR-L010).`,
    docs: docsFor(RuleCode.DirectWrite),
  };
}

/** Every signal an effects file writes itself. */
export function directWrite(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);

    if (place?.layer !== Layer.Effects) return [];

    return program.writesOf(file).map((write) => finding(place, write));
  });
}
