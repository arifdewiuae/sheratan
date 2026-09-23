// SHR-T001 (SPEC §4): a module's state and effects have tests beside them,
// as a warning. The rule reads the disk, so every case here is about which
// files exist rather than what is in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only } from './project.ts';

/** SHR-T001's own findings: a fixture here is a module missing other parts. */
const check = only(RuleCode.Tested);

/** Nothing in a file matters to this rule; only whether it is there. */
const FILE = 'export const nothing = 0;\n';

const found = (files: Record<string, string>): string[] =>
  check(files).map((finding) => finding.file);

/** A `full` module with its tests: the shape `sheratan generate module` writes. */
const TESTED: Record<string, string> = {
  'modules/todo/index.ts': "export const kind = 'full';\n",
  'modules/todo/todo.state.ts': FILE,
  'modules/todo/todo.state.test.ts': FILE,
  'modules/todo/todo.effects.ts': FILE,
  'modules/todo/todo.effects.test.ts': FILE,
  'modules/todo/todo.view.ts': FILE,
};

test('state with no test beside it is a warning, not an error', () => {
  assert.deepEqual(check({ 'modules/todo/todo.state.ts': FILE }), [
    {
      code: 'SHR-T001',
      severity: 'warning',
      file: 'modules/todo/todo.state.ts',
      range: { line: 1, column: 1 },
      message:
        "modules/todo/todo.state.ts has no tests; a module's state and effects are tested beside the file they cover, as modules/todo/todo.state.test.ts.",
      fix: 'Add modules/todo/todo.state.test.ts — a state file is a pure function, so a test calls a transition and reads the accessors — no DOM and no mocks.',
      docs: 'https://sheratan.dev/errors/SHR-T001',
    },
  ]);
});

test('effects is told what its test needs instead: a fake contract', () => {
  const fixes = check({ 'modules/todo/todo.effects.ts': FILE }).map(
    (finding) => [finding.file, finding.fix] as const,
  );

  assert.deepEqual(fixes, [
    [
      'modules/todo/todo.effects.ts',
      'Add modules/todo/todo.effects.test.ts — hand the effects factory a fake contract, run the effect, and assert which transition it invoked.',
    ],
  ]);
});

test('a module with both test files is reported nowhere', () => {
  assert.deepEqual(found(TESTED), []);
});

test('a test file is not itself asked for a test', () => {
  assert.deepEqual(
    found({ 'modules/todo/todo.state.ts': FILE, 'modules/todo/todo.state.test.ts': FILE }),
    [],
  );
});

test('the test sits beside the file it covers, under one name', () => {
  assert.deepEqual(
    found({
      'modules/todo/todo.state.ts': FILE,
      'modules/todo/todo.state.spec.ts': FILE,
      'modules/orders/orders.state.ts': FILE,
      'test/orders.state.test.ts': FILE,
    }),
    ['modules/orders/orders.state.ts', 'modules/todo/todo.state.ts'],
  );
});

test('a view, a component, a contract and a helper are not asked for tests', () => {
  assert.deepEqual(
    found({
      'app.ts': FILE,
      'lib/format.ts': FILE,
      'services/feed.contract.ts': FILE,
      'services/feed.http.ts': FILE,
      'ui/button/button.view.ts': FILE,
      'modules/todo/index.ts': "export const kind = 'view';\n",
      'modules/todo/todo.view.ts': FILE,
      'modules/todo/parts/row.ts': FILE,
    }),
    [],
  );
});
