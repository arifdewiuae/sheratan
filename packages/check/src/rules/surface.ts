// SHR-L010: a `*.state.ts` hands out accessors and transitions, never the
// writable Signal (SPEC §4 "The state surface"). With the handle kept inside
// the file, `state.rows.set(…)` from effects or a view stops compiling — the
// compile-time half of what SHR-L005 can only chase through call sites.

import { relative, sep } from 'node:path';

import { docsFor, RuleCode, Severity, type Finding } from '../finding.ts';
import { Layer, placeOf } from '../layout.ts';
import type { Program, SurfaceMember } from '../typescript.ts';

const SIGNAL_TYPE = /^Signal</;

const ACCESSOR_TYPE = 'Accessor<';

function finding(root: string, stateFile: string, member: SurfaceMember): Finding {
  const accessor = SIGNAL_TYPE.test(member.printed)
    ? member.printed.replace(SIGNAL_TYPE, ACCESSOR_TYPE)
    : 'Accessor<T>';

  return {
    code: RuleCode.StateSurface,
    severity: Severity.Error,
    file: relative(root, member.file).split(sep).join('/'),
    range: member.at,
    message: `${stateFile} hands out \`${member.name}\` as ${member.printed}, which callers can write; allowed on a state surface: accessors and transitions.`,
    fix: `Declare \`${member.name}\` as ${accessor} on the public interface and keep the Signal inside ${stateFile}; callers change it through a transition exported beside it.`,
    docs: docsFor(RuleCode.StateSurface),
  };
}

/** Every writable handle a state module lets out. */
export function surface(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);

    if (place?.layer !== Layer.State) return [];

    return program
      .surfaceOf(file)
      .filter((member) => member.writable)
      .map((member) => finding(root, place.path, member));
  });
}
