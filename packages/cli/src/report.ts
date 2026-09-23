// How findings reach a reader. Two formats, one list: the terminal form is
// four lines an editor can click, and `--json` is the versioned machine
// surface (SPEC §8) that an agent parses in one call.

import type { Finding } from '../../check/src/index.ts';
import { Severity } from '../../check/src/index.ts';
import { paint, Style, type Terminal } from './terminal.ts';

/**
 * The shape `sheratan check --json` prints. It is a public API: `version` goes
 * up when a field changes meaning, never when a rule is added.
 */
export interface Report {
  readonly version: number;
  readonly findings: readonly Finding[];
}

/** The current report shape. */
export const REPORT_VERSION = 1;

const INDENT = '  ';

/** Two spaces of JSON indent, so a human can read what an agent parses. */
const JSON_INDENT = 2;

function headline(terminal: Terminal, finding: Finding): string {
  const { line, column } = finding.range;
  const style = finding.severity === Severity.Error ? Style.Error : Style.Warning;
  const where = paint(terminal, Style.Strong, `${finding.file}:${String(line)}:${String(column)}`);

  return `${where}  ${paint(terminal, style, finding.severity)} ${finding.code}`;
}

/** One finding, as four lines: where, what, the fix, the page. */
function human(terminal: Terminal, finding: Finding): string {
  const fix = `${INDENT}fix  ${finding.fix}`;
  const docs = paint(terminal, Style.Muted, `${INDENT}docs ${finding.docs}`);

  return [headline(terminal, finding), `${INDENT}${finding.message}`, fix, docs].join('\n');
}

function count(total: number, noun: string): string {
  return total === 1 ? `1 ${noun}` : `${String(total)} ${noun}s`;
}

/** What the run adds up to, in the words a reader needs: nothing, or how much. */
function summary(findings: readonly Finding[]): string {
  const errors = findings.filter((finding) => finding.severity === Severity.Error).length;
  const warnings = findings.length - errors;

  if (findings.length === 0) return 'No violations.';

  return `${count(errors, 'error')}, ${count(warnings, 'warning')}.`;
}

/** Every finding for a human, one block each, with the count last. */
export function report(terminal: Terminal, findings: readonly Finding[]): string {
  const blocks = findings.map((finding) => human(terminal, finding));

  return blocks.concat(summary(findings)).join('\n\n');
}

/** Every finding for a machine, in the versioned envelope. */
export function reportJson(findings: readonly Finding[]): string {
  const body: Report = { version: REPORT_VERSION, findings };

  return JSON.stringify(body, undefined, JSON_INDENT);
}
