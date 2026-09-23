// SHR-L002 (SPEC §4): views and state do no I/O. Each case is a real project,
// so "a global" means what the type checker resolves, not a matching name.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { check } from './project.ts';

/** Every global L002 knows, as SPEC §4 lists them by what they do. */
const IO_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'requestIdleCallback',
  'document',
  'window',
  'globalThis',
  'self',
  'navigator',
  'location',
  'history',
  'alert',
  'confirm',
  'prompt',
];

const VIEW = 'modules/todo/todo.view.ts';

/** A file that touches each of `names`, one per line from line 2. */
const touching = (names: readonly string[]): string =>
  `export const probe = (): unknown => [\n${names.map((name) => `  ${name},\n`).join('')}];\n`;

const found = (files: Record<string, string>): (readonly [string, string, number])[] =>
  check(files).map((finding) => [finding.code, finding.file, finding.range.line] as const);

test('a view calling fetch is told where the request belongs', () => {
  assert.deepEqual(
    check({ [VIEW]: "export const load = (): Promise<Response> => fetch('/todos');\n" }),
    [
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
  );
});

test('every I/O global is reported in a view, one finding each, where it is used', () => {
  assert.deepEqual(
    found({ [VIEW]: touching(IO_GLOBALS) }),
    IO_GLOBALS.map((_, index) => [RuleCode.Io, VIEW, index + 2]),
  );
});

test('each kind of I/O gets the fix for that kind', () => {
  const fixes = check({
    [VIEW]: touching(['fetch', 'localStorage', 'setTimeout', 'document']),
  }).map((finding) => finding.fix.split(' ').slice(0, 2).join(' '));

  assert.deepEqual(fixes, ['Call it', 'Read and', 'Schedule it', 'Read or']);
});

test('state and a module helper may not do I/O either', () => {
  const findings = check({
    'modules/todo/todo.state.ts': touching(['localStorage']),
    'modules/todo/row.ts': touching(['document']),
  });

  assert.deepEqual(
    findings.map((finding) => [finding.file, finding.message.split('; ')[1]]),
    [
      [
        'modules/todo/row.ts',
        'allowed in a view: markup from state, and intents that effects carry out.',
      ],
      ['modules/todo/todo.state.ts', 'allowed in state: signals, computeds and pure transitions.'],
    ],
  );
});

test('effects, services, app.ts and the rest of the layout may do I/O', () => {
  const io = touching(['fetch', 'document', 'setTimeout']);

  assert.deepEqual(
    check({
      'modules/todo/todo.effects.ts': io,
      'services/http.ts': io,
      'app.ts': io,
      'lib/clock.ts': io,
      'ui/button/button.view.ts': io,
      'modules/todo/todo.view.test.ts': io,
    }),
    [],
  );
});

test('a local that shares a global name is not the global', () => {
  assert.deepEqual(
    check({
      [VIEW]:
        "export const probe = (document: string, self = 1): unknown => {\n  const location = 'here';\n\n  return [document, self, location];\n};\n",
    }),
    [],
  );
});

test('a member or a type named like a global is not a use of it', () => {
  assert.deepEqual(
    found({
      [VIEW]:
        'export type Page = typeof window;\n\nexport const probe = (page: Page): unknown => [\n  page.fetch,\n  { fetch: 1 }.fetch,\n];\n',
    }),
    [],
  );
});

test('window.fetch is one use, reported at window; a shorthand property is a use', () => {
  assert.deepEqual(
    found({
      [VIEW]: 'export const probe = (): unknown => [\n  window.fetch,\n  { document },\n];\n',
    }),
    [
      [RuleCode.Io, VIEW, 2],
      [RuleCode.Io, VIEW, 3],
    ],
  );
});

test("a package's own fetch is an import, not the global", () => {
  assert.deepEqual(
    check({
      'node_modules/http-kit/package.json': JSON.stringify({
        name: 'http-kit',
        types: 'index.d.ts',
      }),
      'node_modules/http-kit/index.d.ts':
        'export declare function fetch(url: string): Promise<string>;\n',
      [VIEW]:
        "import { fetch } from 'http-kit';\n\nexport const probe = (): unknown => fetch('/x');\n",
    }),
    [],
  );
});

test('globals that do no I/O are fine in a view', () => {
  assert.deepEqual(
    check({ [VIEW]: touching(['Math.max', 'JSON.stringify', 'structuredClone', 'Intl']) }),
    [],
  );
});
