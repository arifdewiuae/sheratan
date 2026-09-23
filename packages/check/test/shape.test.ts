// SHR-L006 (SPEC §4): a module's files are fixed by the kind its index.ts
// declares. The kind is read from the type of that export, so these fixtures
// declare it the way an app does.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only, type Files } from './project.ts';

/** SHR-L006's own findings: a fixture missing a view is missing other things too. */
const check = only(RuleCode.Shape);

const VIEW = "export const todoView = (): string => 'todo';\n";

const STATE = 'export const createTodoState = (): { rows: () => number } => ({ rows: () => 0 });\n';

const EFFECTS =
  'export const createTodoEffects = (): { start: () => void } => ({ start: () => undefined });\n';

const index = (kind: string): string => `export const kind = ${kind};\n`;

/** A module of each kind, written the way SPEC §4 draws it. */
const CANONICAL: Files = {
  'modules/todo/index.ts': index("'view'"),
  'modules/todo/todo.view.ts': VIEW,
  'modules/orders/index.ts': index("'full'"),
  'modules/orders/orders.state.ts': STATE,
  'modules/orders/orders.effects.ts': EFFECTS,
  'modules/orders/orders.view.ts': VIEW,
  // A component only this module uses: an ordinary file, no layer suffix.
  'modules/orders/row.ts': VIEW,
};

/** Where each finding landed, and what it said. */
const found = (files: Files): (readonly [string, string])[] =>
  check(files).map((finding) => [finding.file, finding.message] as const);

/** Everything the checker said about a project, message and fix together. */
const said = (files: Files): string =>
  check(files)
    .map((finding) => `${finding.message}\n${finding.fix}`)
    .join('\n');

test('both kinds, written as SPEC draws them, are reported nowhere', () => {
  assert.deepEqual(check(CANONICAL), []);
});

test('a full module missing a file is told which file, where its kind is declared', () => {
  assert.deepEqual(
    check({
      'modules/todo/index.ts': index("'full'"),
      'modules/todo/todo.state.ts': STATE,
      'modules/todo/todo.view.ts': VIEW,
    }),
    [
      {
        code: 'SHR-L006',
        severity: 'error',
        file: 'modules/todo/index.ts',
        range: { line: 1, column: 14 },
        message:
          "modules/todo declares kind 'full' but has no todo.effects.ts; a full module is todo.state.ts, todo.effects.ts, todo.view.ts and index.ts.",
        fix: "Add modules/todo/todo.effects.ts, or declare kind 'view' in modules/todo/index.ts if the module has no state or I/O of its own.",
        docs: 'https://sheratan.dev/errors/SHR-L006',
      },
    ],
  );
});

test('a view module with no view is told to add one, with no other way out', () => {
  assert.equal(
    said({ 'modules/todo/index.ts': index("'view'"), 'modules/todo/helpers.ts': VIEW }),
    "modules/todo declares kind 'view' but has no todo.view.ts; a view module is todo.view.ts and index.ts.\nAdd modules/todo/todo.view.ts.",
  );
});

test('a view module that has state or effects is told to declare itself full', () => {
  assert.deepEqual(
    found({
      'modules/todo/index.ts': index("'view'"),
      'modules/todo/todo.view.ts': VIEW,
      'modules/todo/todo.state.ts': STATE,
      'modules/todo/todo.effects.ts': EFFECTS,
    }),
    [
      [
        'modules/todo/todo.effects.ts',
        "modules/todo declares kind 'view' but has todo.effects.ts; a view module is todo.view.ts and index.ts.",
      ],
      [
        'modules/todo/todo.state.ts',
        "modules/todo declares kind 'view' but has todo.state.ts; a view module is todo.view.ts and index.ts.",
      ],
    ],
  );
});

test('a module with no index.ts is told what an index declares', () => {
  const files = { 'modules/todo/todo.view.ts': VIEW };

  assert.deepEqual(
    check(files).map((finding) => [finding.file, finding.range]),
    [['modules/todo/todo.view.ts', { line: 1, column: 1 }]],
  );

  assert.match(said(files), /modules\/todo has no index\.ts/);
  assert.match(said(files), /export const kind = 'view' \(or 'full'\)/);
});

test('a module with no index.ts is named once, at its first file', () => {
  const findings = found({
    'modules/todo/todo.view.ts': VIEW,
    'modules/todo/row.ts': VIEW,
    'modules/todo/actions.ts': VIEW,
  });

  assert.deepEqual(
    findings.map(([file]) => file),
    ['modules/todo/actions.ts'],
  );
});

test('an index that exports no kind says which two words it may say', () => {
  const files = {
    'modules/todo/index.ts': "export const createTodo = (): string => 'todo';\n",
    'modules/todo/todo.view.ts': VIEW,
  };

  assert.deepEqual(
    check(files).map((finding) => finding.file),
    ['modules/todo/index.ts'],
  );

  assert.match(said(files), /exports no kind/);
  assert.match(said(files), /export const kind = 'view' or 'full'/);
});

test('a kind that is not a literal is not a declaration', () => {
  const widened = said({
    'modules/todo/index.ts': "export const kind: string = 'view';\n",
    'modules/todo/todo.view.ts': VIEW,
  });

  assert.match(widened, /declares kind as string; allowed: the literal 'view' or 'full'/);
  assert.match(widened, /with no type annotation/);
});

test('a kind nobody defined is reported as what it says', () => {
  assert.match(
    said({ 'modules/todo/index.ts': index("'partial'"), 'modules/todo/todo.view.ts': VIEW }),
    /declares kind as "partial"/,
  );
});

test('a layer suffix under another name is a rename, reported once', () => {
  assert.deepEqual(
    found({ 'modules/todo/index.ts': index("'view'"), 'modules/todo/row.view.ts': VIEW }),
    [
      [
        'modules/todo/row.view.ts',
        "modules/todo/row.view.ts carries a module file's suffix under another name; allowed in modules/todo: todo.view.ts, and files with no layer suffix.",
      ],
    ],
  );
});

test('a second file of a layer is the one reported, not the module', () => {
  const findings = found({
    'modules/todo/index.ts': index("'view'"),
    'modules/todo/todo.view.ts': VIEW,
    'modules/todo/row.view.ts': VIEW,
  });

  assert.deepEqual(
    findings.map(([file]) => file),
    ['modules/todo/row.view.ts'],
  );
});

test("a test file is not one of the module's files", () => {
  assert.deepEqual(
    check({
      'modules/todo/index.ts': index("'view'"),
      'modules/todo/todo.view.ts': VIEW,
      'modules/todo/todo.state.test.ts': STATE,
      'modules/todo/row.view.test.ts': VIEW,
    }),
    [],
  );
});
