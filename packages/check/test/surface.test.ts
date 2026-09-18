// SHR-L010 (SPEC §4 "The state surface"): accessors and transitions leave a
// state file; the writable Signal does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { check } from './project.ts';

const COMPLIANT = `import { computed, signal, type Accessor } from 'sheratan';

export interface TodoState {
  readonly items: Accessor<readonly string[]>;
  readonly count: Accessor<number>;
  readonly added: (item: string) => void;
}

export function createTodoState(): TodoState {
  const items = signal<readonly string[]>([]);

  return {
    items,
    count: computed(() => items().length),
    added: (item) => items.set([...items(), item]),
  };
}
`;

test('a surface of accessors and transitions is clean', () => {
  assert.deepEqual(check({ 'modules/todo/todo.state.ts': COMPLIANT }), []);
});

test('a Signal on the declared interface is reported at its declaration', () => {
  const widened = COMPLIANT.replace(
    'readonly items: Accessor<readonly string[]>;',
    'readonly items: Signal<readonly string[]>;',
  ).replace('type Accessor }', 'type Accessor, type Signal }');

  assert.deepEqual(check({ 'modules/todo/todo.state.ts': widened }), [
    {
      code: 'SHR-L010',
      severity: 'error',
      file: 'modules/todo/todo.state.ts',
      range: { line: 4, column: 3 },
      message:
        'modules/todo/todo.state.ts hands out `items` as Signal<readonly string[]>, which callers can write; allowed on a state surface: accessors and transitions.',
      fix: 'Declare `items` as Accessor<readonly string[]> on the public interface and keep the Signal inside modules/todo/todo.state.ts; callers change it through a transition exported beside it.',
      docs: 'https://sheratan.dev/errors/SHR-L010',
    },
  ]);
});

test('an inferred surface is checked too: what the factory returns is what callers get', () => {
  const findings = check({
    'modules/todo/todo.state.ts': `import { signal } from 'sheratan';

export const createTodoState = () => {
  const items = signal(0);

  return { items, reset: (): void => items.set(0) };
};
`,
  });

  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.range.line]),
    [[RuleCode.StateSurface, 6]],
  );
});

test('a Signal exported from the module itself is reported', () => {
  const findings = check({
    'modules/todo/todo.state.ts': `import { signal } from 'sheratan';

export const items = signal(0);

export const reset = (): void => items.set(0);
`,
  });

  assert.deepEqual(
    findings.map((finding) => [finding.message.split(',')[0], finding.range]),
    [['modules/todo/todo.state.ts hands out `items` as Signal<number>', { line: 3, column: 14 }]],
  );
});

test('something with a set method that is not itself callable is not a Signal', () => {
  const findings = check({
    'modules/todo/todo.state.ts': `export interface TodoState {
  readonly index: ReadonlyMap<string, number>;
  readonly tags: Set<string>;
}

export const createTodoState = (): TodoState => ({ index: new Map(), tags: new Set() });

export const labels = (): readonly string[] => [];
`,
  });

  assert.deepEqual(findings, []);
});

test('a writable member declared in another file is reported where it is declared', () => {
  const findings = check({
    'modules/todo/surface.ts': `import type { Signal } from 'sheratan';

export interface TodoState {
  readonly items: Signal<number>;
}
`,
    'modules/todo/todo.state.ts': `import { signal } from 'sheratan';

import type { TodoState } from './surface.ts';

export const createTodoState = (): TodoState => ({ items: signal(0) });
`,
  });

  assert.deepEqual(
    findings.map((finding) => [
      finding.file,
      finding.range.line,
      finding.message.split(' hands')[0],
    ]),
    [['modules/todo/surface.ts', 4, 'modules/todo/todo.state.ts']],
  );
});

test('only state files are held to it: effects may pass a Signal around internally', () => {
  const findings = check({
    'modules/todo/todo.effects.ts': `import { signal } from 'sheratan';

export const createTodoEffects = () => ({ busy: signal(false) });
`,
  });

  assert.deepEqual(findings, []);
});

test('a writable shape that is not called Signal is still writable, and the fix still applies', () => {
  const [finding] = check({
    'modules/todo/todo.state.ts': `export interface Box {
  (): number;
  set(value: number): void;
}

export interface TodoState {
  readonly total: Box;
}

export declare const createTodoState: () => TodoState;
`,
  });

  assert.ok(finding);
  assert.equal(finding.range.line, 7);
  assert.match(finding.fix, /Declare `total` as Accessor<T>/);
});

test('a member a mapped type produced has no declaration, so it is reported at the factory', () => {
  const findings = check({
    'modules/todo/todo.state.ts': `import { signal, type Signal } from 'sheratan';

export const createTodoState = (): Record<'items', Signal<number>> => ({ items: signal(0) });
`,
  });

  assert.deepEqual(
    findings.map(({ file, range, message }) => [file, range, message.split(' as ')[0]]),
    [
      [
        'modules/todo/todo.state.ts',
        { line: 3, column: 14 },
        'modules/todo/todo.state.ts hands out `items`',
      ],
    ],
  );
});

test('a state file with no exports hands out nothing', () => {
  assert.deepEqual(
    check({ 'modules/todo/todo.state.ts': 'const draft = 0;\n\nvoid draft;\n' }),
    [],
  );
});
