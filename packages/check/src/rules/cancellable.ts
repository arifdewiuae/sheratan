// SHR-L007 (SPEC §5b): every promise-returning method on a service contract
// takes an `AbortSignal`. A module that cannot cancel a request cannot be
// unmounted honestly — the response arrives for a view that is gone, and the
// effect that has to drop it in `onDispose()` has nothing to drop.
//
// The rule reads the contract's declared types, so a method inherited from a
// base interface or written as a property of function type counts the same as
// one written with parentheses.

import {
  docsFor,
  FILE_START,
  RuleCode,
  Severity,
  type Finding,
  type Position,
} from '../finding.ts';
import { Layer, pathOf, placeOf, type Place } from '../layout.ts';
import type { ContractMethod, Program } from '../typescript.ts';

/** The type a cancellable method takes, wherever in its parameters it sits. */
const SIGNAL = /\bAbortSignal\b/;

/** Where a finding lands: the declaration, or the contract when that is a package's. */
function locate(place: Place, method: ContractMethod, root: string): [string, Position] {
  const path = pathOf(root, method.file);

  return path === undefined ? [place.path, FILE_START] : [path, method.at];
}

function cancellableFinding(place: Place, method: ContractMethod, root: string): Finding {
  const call = `${method.owner}.${method.name}`;
  const [file, range] = locate(place, method, root);

  return {
    code: RuleCode.Cancellable,
    severity: Severity.Error,
    file,
    range,
    message: `${call} returns ${method.returns} and takes no AbortSignal, so a caller cannot cancel it; allowed on a contract: every promise-returning method takes one.`,
    fix: `Give it a signal the caller can abort — ${method.name}(…, signal: AbortSignal), or an options object carrying one — and hand it to the transport, so an effect can drop the request in onDispose().`,
    docs: docsFor(RuleCode.Cancellable),
  };
}

/** Every promise-returning contract method that cannot be cancelled. */
export function cancellable(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);

    if (place?.layer !== Layer.Contract) return [];

    return program
      .methodsOf(file)
      .filter((method) => method.awaited && !method.takes.some((type) => SIGNAL.test(type)))
      .map((method) => cancellableFinding(place, method, root));
  });
}
