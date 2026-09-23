// SHR-L003 (SPEC §4): the project layout itself, which needs no type checker —
// a path is either somewhere the layout has a place for or it is not. Two
// things go wrong. `shared/` groups files by who uses them rather than by what
// they are, and grows into a second application with no rules of its own. A
// folder inside a `ui/` component is the same move one directory down: it
// rebuilds a hierarchy where the component's own folder was the whole surface.

import { docsFor, RuleCode, Severity, type Finding, type Position } from '../finding.ts';
import { pathOf } from '../layout.ts';
import type { Program } from '../typescript.ts';

/** A layout finding is about a whole file, so it points at its first character. */
const FILE_START: Position = { line: 1, column: 1 };

const SHARED = 'shared';

const UI = 'ui';

/** `ui/<component>/<file>`: the one shape a file under `ui/` may have. */
const UI_DEPTH = 3;

/** The extension chain: `button.view.ts` → `button`, the folder it should have had. */
const EXTENSIONS = /\..*$/;

/** What is wrong with one file's path, and what to write instead. */
type Problem = Pick<Finding, 'message' | 'fix'>;

function shared(path: string): Problem {
  return {
    message: `${path} is in a \`shared/\` directory, which groups files by who uses them rather than by what they are; allowed: modules/, ui/, lib/, services/.`,
    fix: 'Move it by what it is: modules/<name>/ if it has state or I/O — shared state is an ordinary module — ui/<component>/ if it is a stateless component, lib/ if it is a pure function, services/ if it does I/O behind a contract.',
  };
}

function loose(path: string, file: string): Problem {
  const component = file.replace(EXTENSIONS, '');

  return {
    message: `${path} is a file directly in ui/, and a ui/ component is a folder; allowed under ui/: ui/<component>/<file>.`,
    fix: `Give it a folder of its own — ui/${component}/${file}, with an index.ts beside it — or move it into the one module that uses it.`,
  };
}

function nested(path: string, component: string, folder: string): Problem {
  return {
    message: `${path} sits below the component folder ui/${component}/; allowed under ui/: one level, the component itself.`,
    fix: `Namespace by prefix rather than by folder: move it to ui/${component}-${folder}/, or into ui/${component}/ as a file when only that component uses it.`,
  };
}

/** What is wrong with `path`, or nothing when the layout has a place for it. */
function problemOf(path: string): Problem | undefined {
  const segments = path.split('/');
  const directories = segments.slice(0, -1);
  const [top = '', component = '', folder = ''] = segments;

  if (directories.includes(SHARED)) return shared(path);

  if (top !== UI || segments.length === UI_DEPTH) return undefined;

  if (segments.length < UI_DEPTH) return loose(path, component);

  return nested(path, component, folder);
}

/** Every file the project layout has no place for. */
export function structure(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const path = pathOf(root, file);
    const problem = path === undefined ? undefined : problemOf(path);

    if (path === undefined || problem === undefined) return [];

    return [
      {
        code: RuleCode.Structure,
        severity: Severity.Error,
        file: path,
        range: FILE_START,
        ...problem,
        docs: docsFor(RuleCode.Structure),
      },
    ];
  });
}
