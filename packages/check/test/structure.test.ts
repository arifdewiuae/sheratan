// SHR-L003 (SPEC §4): no `shared/` directory anywhere, and every file under
// `ui/` in exactly one component folder. The rule reads paths, so each case is
// about where a file sits rather than what it contains.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { check } from './project.ts';

/** A file with no imports and nothing to say, so only its path is under test. */
const FILE = 'export const nothing = 0;\n';

const found = (files: Record<string, string>): (readonly [string, string])[] =>
  check(files).map((finding) => [finding.code, finding.file] as const);

/** The canonical layout, as SPEC §4 draws it: none of it may be reported. */
const LAYOUT: Record<string, string> = {
  'app.ts': FILE,
  'lib/format.ts': FILE,
  'lib/nested/deep/helper.ts': FILE,
  'services/feed.contract.ts': FILE,
  'ui/button/button.view.ts': FILE,
  'ui/button/button.test.ts': FILE,
  'ui/button/index.ts': FILE,
  'ui/data-table/index.ts': FILE,
  'modules/todo/index.ts': "export const kind = 'view';\n",
  'modules/todo/todo.view.ts': FILE,
  'modules/todo/parts/row.ts': FILE,
};

const SHARED = 'shared/format.ts';

test('a file in shared/ is told to move by what it is', () => {
  assert.deepEqual(check({ [SHARED]: FILE }), [
    {
      code: 'SHR-L003',
      severity: 'error',
      file: SHARED,
      range: { line: 1, column: 1 },
      message: `${SHARED} is in a \`shared/\` directory, which groups files by who uses them rather than by what they are; allowed: modules/, ui/, lib/, services/.`,
      fix: 'Move it by what it is: modules/<name>/ if it has state or I/O — shared state is an ordinary module — ui/<component>/ if it is a stateless component, lib/ if it is a pure function, services/ if it does I/O behind a contract.',
      docs: 'https://sheratan.dev/errors/SHR-L003',
    },
  ]);
});

test('shared/ is banned wherever it sits, and every file in it is reported', () => {
  assert.deepEqual(
    found({
      'shared/one.ts': FILE,
      'shared/two.ts': FILE,
      'lib/shared/three.ts': FILE,
      'modules/todo/shared/four.ts': FILE,
    }),
    [
      [RuleCode.Structure, 'lib/shared/three.ts'],
      [RuleCode.Structure, 'modules/todo/shared/four.ts'],
      [RuleCode.Structure, 'shared/one.ts'],
      [RuleCode.Structure, 'shared/two.ts'],
    ],
  );
});

test('a file named shared is not a shared directory', () => {
  assert.deepEqual(found({ 'lib/shared.ts': FILE }), []);
});

test('a folder inside a ui/ component says to namespace by prefix', () => {
  const nested = 'ui/data-table/head/cell.view.ts';

  assert.deepEqual(check({ [nested]: FILE }), [
    {
      code: 'SHR-L003',
      severity: 'error',
      file: nested,
      range: { line: 1, column: 1 },
      message: `${nested} sits below the component folder ui/data-table/; allowed under ui/: one level, the component itself.`,
      fix: 'Namespace by prefix rather than by folder: move it to ui/data-table-head/, or into ui/data-table/ as a file when only that component uses it.',
      docs: 'https://sheratan.dev/errors/SHR-L003',
    },
  ]);
});

test('a loose file in ui/ is told a component is a folder', () => {
  const loose = 'ui/button.view.ts';

  assert.deepEqual(check({ [loose]: FILE }), [
    {
      code: 'SHR-L003',
      severity: 'error',
      file: loose,
      range: { line: 1, column: 1 },
      message: `${loose} is a file directly in ui/, and a ui/ component is a folder; allowed under ui/: ui/<component>/<file>.`,
      fix: 'Give it a folder of its own — ui/button/button.view.ts, with an index.ts beside it — or move it into the one module that uses it.',
      docs: 'https://sheratan.dev/errors/SHR-L003',
    },
  ]);
});

test('a ui/ barrel is a loose file too, however deep the component below it is', () => {
  assert.deepEqual(
    found({ 'ui/index.ts': FILE, 'ui/button/index.ts': FILE, 'ui/button/parts/icon.ts': FILE }),
    [
      [RuleCode.Structure, 'ui/button/parts/icon.ts'],
      [RuleCode.Structure, 'ui/index.ts'],
    ],
  );
});

test('the canonical layout is reported nowhere', () => {
  assert.deepEqual(found(LAYOUT), []);
});
