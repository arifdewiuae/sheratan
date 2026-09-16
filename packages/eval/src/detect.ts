// The structural half of the Week 0 gate. It finds the three violation classes
// of EVAL-TASKS §5 and reports them in the SPEC §8 shape.
//
// EVAL-TASKS §5 says the checker JSON is hand-written in Week 0. This is
// stricter: the same code produces what the agent reads and judges what the
// agent submits, so a run cannot pass because the input was written kindly.
//
// It is a scanner, not the checker. `sheratan check` is Week 3 and works over
// the TypeScript compiler API; what this covers is written down in the README.

import { RuleCode, docsFor, type Finding } from './rules.ts';
import { blank, positionOf, type SourceFile } from './source.ts';

/** Globals a view may not touch; the message names where each one belongs. */
const IO_GLOBALS = new Map<string, string>([
  ['fetch', 'I/O lives in *.effects.ts, behind a service contract'],
  ['XMLHttpRequest', 'I/O lives in *.effects.ts, behind a service contract'],
  ['localStorage', 'storage is I/O: it belongs in *.effects.ts behind a contract'],
  ['sessionStorage', 'storage is I/O: it belongs in *.effects.ts behind a contract'],
  ['document', 'a view describes markup with html``; DOM access belongs in *.effects.ts'],
  ['window', 'browser APIs belong in *.effects.ts, with teardown in onDispose()'],
  ['navigator', 'browser APIs belong in *.effects.ts, with teardown in onDispose()'],
  ['setTimeout', 'timers belong in *.effects.ts, with teardown in onDispose()'],
  ['setInterval', 'timers belong in *.effects.ts, with teardown in onDispose()'],
]);

const VIEW = '.view.ts';
const EFFECTS = '.effects.ts';
const INDEX = 'index.ts';
const SEVERITY = 'error';

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)[^\n]*?from\s*(['"])([^'"]+)\1/g;

/** One level up and into a sibling: `../other/file.ts`, never `../../lib`. */
const SIBLING = /^\.\.\/([^/]+)\/(.+)$/;

const UP = '..';

/** What an identifier has to be followed by to be a use rather than a name. */
const USED = new Set(['.', '(', '[']);
const MEMBER_SET = /(?:^|[^\w$.])([\w$]+(?:\.[\w$]+)*)\.set\s*\(/g;

const LOCAL_COLLECTION =
  /(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*new\s+(?:Set|Map|WeakMap)\b/g;

/** Where a finding is, and what it says. */
interface Report {
  readonly offset: number;
  readonly message: string;
  readonly fix: string;
}

function finding(code: RuleCode, file: SourceFile, report: Report): Finding {
  const { offset, message, fix } = report;

  return {
    code,
    severity: SEVERITY,
    file: file.path,
    range: positionOf(file.text, offset),
    message,
    fix,
    docs: docsFor(code),
  };
}

/** The module a path belongs to, or undefined for anything outside `modules/`. */
function moduleOf(path: string): string | undefined {
  const match = /(?:^|\/)modules\/([^/]+)\//.exec(path);

  return match?.[1];
}

function viewIO(file: SourceFile, blanked: string): Finding[] {
  if (!file.path.endsWith(VIEW)) return [];

  const found: Finding[] = [];

  for (const match of blanked.matchAll(IDENTIFIER)) {
    const name = match[0];
    const where = match.index;
    const advice = IO_GLOBALS.get(name);

    // A property access of the same name is someone else's object, and a bare
    // name in a type is a member, not a call. Only a use of the global counts.
    if (advice === undefined || blanked[where - 1] === '.') continue;
    if (!USED.has(blanked.slice(where + name.length).trimStart()[0] ?? '')) continue;

    found.push(
      finding(RuleCode.ViewIO, file, {
        offset: where,
        message: `a view may not use \`${name}\`: ${advice}.`,
        fix: `Move the \`${name}\` call into this module's *.effects.ts, have it invoke a transition on *.state.ts, and read the result in the view.`,
      }),
    );
  }

  return found;
}

function directWrite(file: SourceFile, blanked: string): Finding[] {
  if (!file.path.endsWith(EFFECTS)) return [];

  // A `Set` or `Map` built in this file has a `.set` of its own, and writing to
  // it is bookkeeping rather than state.
  const local = new Set([...blanked.matchAll(LOCAL_COLLECTION)].map((match) => match[1]));
  const found: Finding[] = [];

  for (const match of blanked.matchAll(MEMBER_SET)) {
    const target = match[1] as string;

    if (local.has(target.split('.')[0])) continue;

    found.push(
      finding(RuleCode.DirectWrite, file, {
        offset: match.index + match[0].indexOf(target),
        message: `effects may not write state directly: \`${target}.set(…)\` changes a signal that *.state.ts owns.`,
        fix: `Add a transition to this module's *.state.ts that makes this change, and call that transition here instead. One transition is one commit.`,
      }),
    );
  }

  return found;
}

function boundary(file: SourceFile): Finding[] {
  const owner = moduleOf(file.path);

  if (owner === undefined) return [];

  const found: Finding[] = [];

  for (const match of file.text.matchAll(IMPORT_FROM)) {
    const specifier = match[2] as string;
    const reached = SIBLING.exec(specifier);
    const other = reached?.[1];
    const target = reached?.[2];

    if (other === undefined || other === UP || other === owner || target === INDEX) continue;

    found.push(
      finding(RuleCode.Boundary, file, {
        offset: match.index + match[0].indexOf(specifier),
        message: `\`${owner}\` reached into \`${other}\`'s internals: \`${specifier}\` is not that module's public surface.`,
        fix: `Import from '../${other}/${INDEX}' instead. If what you need is not exported there, export it from ${other}'s index.ts rather than deepening the import.`,
      }),
    );
  }

  return found;
}

function before(left: Finding, right: Finding): number {
  if (left.range.line !== right.range.line) return left.range.line - right.range.line;

  return left.range.column - right.range.column;
}

/** Every violation in a tree, in file order then position order. */
export function detect(files: readonly SourceFile[]): Finding[] {
  return files.flatMap((file) => {
    const blanked = blank(file.text);

    const all = [...viewIO(file, blanked), ...directWrite(file, blanked), ...boundary(file)];

    return all.toSorted(before);
  });
}
