// SHR-L004 (SPEC §4): `resource`, `mutation`, `stream` and `onDispose` are
// called in `*.effects.ts` and nowhere else. The rule reads calls, so each
// case is about where a call sits and what the callee actually resolves to.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only, type Files } from './project.ts';

/** SHR-L004's own findings: a fixture here is a file, not always a whole module. */
const check = only(RuleCode.EffectsOnly);

const found = (files: Files): (readonly [string, string, number])[] =>
  check(files).map((finding) => [finding.file, finding.message, finding.range.line] as const);

const INDEX = "export const kind = 'full';\n";

const STATE = `import { resource } from 'sheratan';

export function createTodoState(): { readonly ready: () => boolean } {
  const rows = resource({ key: () => [1] as const, fetch: async () => 1 });

  return { ready: () => rows.status() === 'success' };
}
`;

test('a resource created in state is reported where the call is', () => {
  assert.deepEqual(check({ 'modules/todo/index.ts': INDEX, 'modules/todo/todo.state.ts': STATE }), [
    {
      code: 'SHR-L004',
      severity: 'error',
      file: 'modules/todo/todo.state.ts',
      range: { line: 4, column: 16 },
      message:
        'modules/todo/todo.state.ts calls `resource()`, which reads data asynchronously; only todo.effects.ts may call it.',
      fix: 'Create it in todo.effects.ts and pass what it reads to a transition; the view reads state.',
      docs: 'https://sheratan.dev/errors/SHR-L004',
    },
  ]);
});

test('each API says what it starts and where it belongs', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.view.ts': `import { onDispose, stream } from 'sheratan';

export function todoView(): string {
  onDispose(() => {});
  stream({ key: () => [1] as const, open: () => () => {} });

  return 'todo';
}
`,
    'lib/save.ts': `import { mutation } from 'sheratan';

export const save = (): unknown => mutation({ run: async () => {} });
`,
  };

  assert.deepEqual(
    found(files).map((row) => row[1]),
    [
      'lib/save.ts calls `mutation()`, which writes through a service; only the effects file of a module may call it.',
      'modules/todo/todo.view.ts calls `onDispose()`, which registers teardown the runtime cannot see; only todo.effects.ts may call it.',
      'modules/todo/todo.view.ts calls `stream()`, which subscribes to a source; only todo.effects.ts may call it.',
    ],
  );
});

test('the effects file itself may call every one of them', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.effects.ts': `import { mutation, onDispose, resource, stream } from 'sheratan';

export function createTodoEffects(): { readonly start: () => void } {
  resource({ key: () => [1] as const, fetch: async () => 1 });
  mutation({ run: async () => {} });
  stream({ key: () => [1] as const, open: () => () => {} });
  onDispose(() => {});

  return { start: () => {} };
}
`,
  };

  assert.deepEqual(found(files), []);
});

test('an alias is reported by the name the runtime exports, not the local one', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.state.ts': `import { stream as subscribe } from 'sheratan';

export const rows = (): unknown => subscribe({ key: () => [1] as const, open: () => () => {} });
`,
  };

  assert.deepEqual(
    found(files).map((row) => row[1]),
    [
      'modules/todo/todo.state.ts calls `stream()`, which subscribes to a source; only todo.effects.ts may call it.',
    ],
  );
});

test('a local function of the same name is not the runtime API', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.state.ts': `function stream(): number {
  return 1;
}

export const rows = (): number => stream();
`,
  };

  assert.deepEqual(found(files), []);
});

test('a local declared over the import is the local, not the import', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.state.ts': `import { stream } from 'sheratan';

export type Rows = typeof stream;

export function rows(): number {
  const stream = (): number => 1;

  return stream();
}
`,
  };

  assert.deepEqual(found(files), []);
});

test('a same-named export of another package is not the runtime API', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'lib/other.ts': 'export const onDispose = (fn: () => void): void => { fn(); };\n',
    'modules/todo/todo.state.ts': `import { onDispose } from '../../lib/other.ts';

export const stop = (): void => { onDispose(() => {}); };
`,
  };

  assert.deepEqual(found(files), []);
});

test('a type-only import cannot be called and is not reported', () => {
  const files = {
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.state.ts': `import type { Resource } from 'sheratan';

export const rows = (r: Resource<number>): number => r();
`,
  };

  assert.deepEqual(found(files), []);
});

test('the canonical layout is reported nowhere', () => {
  const files = {
    'app.ts': 'export const started = 1;\n',
    'lib/format.ts': 'export const pad = (n: number): string => `${n}`;\n',
    'services/feed.contract.ts': 'export interface Feed { readonly kind: string }\n',
    'modules/todo/index.ts': INDEX,
    'modules/todo/todo.state.ts': `import { signal } from 'sheratan';

export function createTodoState(): { readonly n: () => number } {
  const n = signal(1);

  return { n: () => n() };
}
`,
    'modules/todo/todo.view.ts': "export const todoView = (): string => 'todo';\n",
  };

  assert.deepEqual(found(files), []);
});
