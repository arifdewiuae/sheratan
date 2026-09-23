// `sheratan check` end to end: a real project on disk, through argument
// parsing, the checker and the formatter, to an exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { project } from '../../check/test/project.ts';
import { Exit, run } from '../src/index.ts';
import { recorder } from './terminal.ts';

const VIEW = 'modules/todo/todo.view.ts';

const FETCHING = "export const load = (): Promise<Response> => fetch('/todos');\n";

const CLEAN = { 'lib/format.ts': 'export const pad = (n: number): string => String(n);\n' };

test('a clean project says so and exits 0', () => {
  using made = project(CLEAN);
  const { terminal, out, err } = recorder();

  assert.equal(run(['check', made.root], terminal), Exit.Clean);
  assert.deepEqual(out, ['No violations.']);
  assert.deepEqual(err, []);
});

test('a violation prints where, what, the fix and the page, then exits 1', () => {
  using made = project({ [VIEW]: FETCHING });
  const { terminal, out } = recorder();

  assert.equal(run(['check', made.root], terminal), Exit.Violations);

  assert.equal(
    out.join(''),
    [
      `${VIEW}:1:46  error SHR-L002`,
      `  ${VIEW} uses \`fetch\`, which is network I/O; allowed in a view: markup from state, and intents that effects carry out.`,
      '  fix  Call it from todo.effects.ts through a service contract (services/*.contract.ts), and hand the result to a transition in todo.state.ts.',
      '  docs https://sheratan.dev/errors/SHR-L002',
      '',
      '1 error, 0 warnings.',
    ].join('\n'),
  );
});

test('--json prints one versioned object, whatever the order of the arguments', () => {
  using made = project({ [VIEW]: FETCHING });
  const { terminal, out } = recorder();

  assert.equal(run(['check', '--json', made.root], terminal), Exit.Violations);

  const printed: unknown = JSON.parse(out.join(''));

  assert.deepEqual(printed, {
    version: 1,
    findings: [
      {
        code: 'SHR-L002',
        severity: 'error',
        file: VIEW,
        range: { line: 1, column: 46 },
        message: `${VIEW} uses \`fetch\`, which is network I/O; allowed in a view: markup from state, and intents that effects carry out.`,
        fix: 'Call it from todo.effects.ts through a service contract (services/*.contract.ts), and hand the result to a transition in todo.state.ts.',
        docs: 'https://sheratan.dev/errors/SHR-L002',
      },
    ],
  });
});

test('a clean project in JSON is an empty list, not an empty output', () => {
  using made = project(CLEAN);
  const { terminal, out } = recorder();

  assert.equal(run(['check', '--json', made.root], terminal), Exit.Clean);
  assert.deepEqual(JSON.parse(out.join('')), { version: 1, findings: [] });
});

test('a project that will not open fails with the reason, not as a clean result', () => {
  const { terminal, out, err } = recorder();

  assert.equal(run(['check', 'no/such/project'], terminal), Exit.Usage);
  assert.deepEqual(out, []);
  assert.match(err.join(''), /could not open/);
});

test('the checked directory defaults to the one the command runs in', () => {
  using made = project(CLEAN);
  const { terminal } = recorder();
  const cwd = process.cwd();

  process.chdir(made.root);

  try {
    assert.equal(run(['check'], terminal), Exit.Clean);
  } finally {
    process.chdir(cwd);
  }
});
