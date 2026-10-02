// `sheratan explain` (SPEC §10): one code in full, or every code in a line.
// The terminal form is for a person; `--json` is a versioned envelope, the
// same contract `check --json` keeps, so an agent that has a finding's code
// can ask for the rest in one call.

import { Severity } from '../../../check/src/finding.ts';
import { DOCS_BASE_URL } from '../../../core/src/codes.ts';
import { paint, Style, type Terminal } from '../terminal.ts';
import { CHECKER } from './checker.ts';
import type { Code, Entry, ExampleFiles, Explanation } from './explanation.ts';
import { RUNTIME } from './runtime.ts';

/** The shape `--json` prints. `version` goes up when a field changes meaning, never when a code is added. */
export const EXPLAIN_VERSION = 1;

/**
 * Codes SPEC §4 has numbered and nothing checks yet. Asking for one is told
 * so, rather than that it does not exist; each leaves this list in the change
 * that enforces it and gains an entry in `checker.ts`.
 */
export const RESERVED: readonly string[] = [
  'SHR-L005',
  'SHR-L009',
  'SHR-L011',
  'SHR-V001',
  'SHR-V002',
  'SHR-V003',
  'SHR-V004',
];

const TABLE: { readonly [C in Code]: Entry } = { ...RUNTIME, ...CHECKER };

const INDENT = '  ';

const CODE_INDENT = `${INDENT}${INDENT}`;

/** Two spaces of JSON indent, as `check --json` prints. */
const JSON_INDENT = 2;

/** Codes are printed upper case; a reader typing one need not be. */
function normalise(code: string): string {
  return code.trim().toUpperCase();
}

function isCode(code: string): code is Code {
  return Object.hasOwn(TABLE, code);
}

function explanation(code: Code): Explanation {
  return { code, ...TABLE[code], docs: DOCS_BASE_URL + code };
}

/** Every explained code, in code order. */
export function explanations(): readonly Explanation[] {
  const codes = Object.keys(TABLE).filter(isCode).toSorted();

  return codes.map(explanation);
}

/** The explanation for `code`, or why there is none: reserved, or not a code at all. */
export function explain(code: string): Explanation | string {
  const wanted = normalise(code);

  if (isCode(wanted)) return explanation(wanted);

  if (RESERVED.includes(wanted)) {
    return `${wanted} is reserved by SPEC §4 and not checked yet; \`sheratan explain\` lists the codes that are.`;
  }

  return `\`${code}\` is not a Sheratan code; \`sheratan explain\` lists every one.`;
}

/** Each file as its path, then its source indented under it. */
function files(example: ExampleFiles): string {
  return Object.entries(example)
    .map(([path, source]) => {
      const body = source
        .trimEnd()
        .split('\n')
        .map((line) => (line === '' ? '' : `${CODE_INDENT}${line}`));

      return [`${INDENT}${path}`, ...body].join('\n');
    })
    .join('\n\n');
}

/** One code in full: what it is, why, code that is caught beside code that is not, and the page. */
export function explainText(terminal: Terminal, entry: Explanation): string {
  const style = entry.severity === Severity.Error ? Style.Error : Style.Warning;
  const where = `${paint(terminal, style, entry.severity)}, caught by the ${entry.caughtBy}`;

  return [
    `${paint(terminal, Style.Strong, entry.code)}  ${where}`,
    entry.title,
    entry.why,
    `${paint(terminal, Style.Error, 'Wrong')}\n${files(entry.wrong)}`,
    `${paint(terminal, Style.Strong, 'Right')}\n${files(entry.right)}`,
    paint(terminal, Style.Muted, `docs ${entry.docs}`),
  ].join('\n\n');
}

/** One code for a machine, in the versioned envelope. */
export function explainJson(entry: Explanation): string {
  return JSON.stringify({ version: EXPLAIN_VERSION, ...entry }, undefined, JSON_INDENT);
}

/** Every code in a line, for a reader who does not know which one to ask about yet. */
export function listText(terminal: Terminal, all: readonly Explanation[]): string {
  const width = Math.max(...all.map((entry) => entry.severity.length));

  const lines = all.map(
    (entry) =>
      `${paint(terminal, Style.Strong, entry.code)}  ${entry.severity.padEnd(width)}  ${entry.title}`,
  );

  return [
    ...lines,
    '',
    'sheratan explain <code> says why, with code that is caught beside code that is not.',
  ].join('\n');
}

/** Every code for a machine: enough to choose one, and where its page is. */
export function listJson(all: readonly Explanation[]): string {
  const codes = all.map(({ code, severity, caughtBy, title, docs }) => ({
    code,
    severity,
    caughtBy,
    title,
    docs,
  }));

  return JSON.stringify({ version: EXPLAIN_VERSION, codes }, undefined, JSON_INDENT);
}
