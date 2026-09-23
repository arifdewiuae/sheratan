// The two formats, from findings the rules cannot produce yet: a warning, and
// enough of them to count. `Finding` is the checker's public shape, so a
// hand-written one is the same object a rule returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Finding } from '../../check/src/index.ts';
import { report, reportJson, REPORT_VERSION } from '../src/index.ts';
import { recorder } from './terminal.ts';

const finding = (severity: Finding['severity'], file: string): Finding => ({
  code: 'SHR-L001',
  severity,
  file,
  range: { line: 3, column: 1 },
  message: `${file} cannot import effects; allowed: lib, ui, own state.`,
  fix: 'Move the call into todo.effects.ts and expose the result via todo.state.ts.',
  docs: 'https://sheratan.dev/errors/SHR-L001',
});

/** The escapes `paint` writes, spelled out here so the test pins the bytes. */
const ESCAPE = '\u001B[';

const RED = `${ESCAPE}31m`;

const YELLOW = `${ESCAPE}33m`;

const STRONG = `${ESCAPE}1m`;

const RESET = `${ESCAPE}0m`;

const ERROR = finding('error', 'modules/todo/todo.view.ts');

const WARNING = finding('warning', 'modules/todo/todo.state.ts');

test('the summary counts errors and warnings apart, and says nothing twice', () => {
  const { terminal } = recorder();

  assert.match(report(terminal, [ERROR, WARNING]), /\n1 error, 1 warning\.$/);
  assert.match(report(terminal, [ERROR, ERROR, WARNING, WARNING]), /\n2 errors, 2 warnings\.$/);
  assert.equal(report(terminal, []), 'No violations.');
});

test('severity is what the line is coloured by, and only when colour is on', () => {
  const plain = recorder();
  const painted = recorder(true);
  const coloured = report(painted.terminal, [ERROR, WARNING]);

  assert.ok(report(plain.terminal, [ERROR]).startsWith('modules/todo/todo.view.ts:3:1  error '));
  assert.ok(!report(plain.terminal, [ERROR]).includes(ESCAPE));
  assert.ok(coloured.includes(`${RED}error${RESET}`));
  assert.ok(coloured.includes(`${YELLOW}warning${RESET}`));
  assert.ok(coloured.includes(`${STRONG}modules/todo/todo.view.ts:3:1${RESET}`));
});

test('JSON carries the version, and the findings unchanged', () => {
  assert.deepEqual(JSON.parse(reportJson([ERROR, WARNING])), {
    version: REPORT_VERSION,
    findings: [ERROR, WARNING],
  });
});
