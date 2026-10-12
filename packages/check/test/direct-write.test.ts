// SHR-L005 (SPEC §4, §13): `*.effects.ts` changes state only by calling a
// transition. The best-effort backstop to SHR-L010: it finds a write the type
// system lets through because the state surface was widened first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only } from './project.ts';

const check = only(RuleCode.DirectWrite);

const WIDENED_STATE = `import { signal, type Signal } from 'sheratan';

export interface TodoState {
  readonly items: Signal<readonly string[]>;
  readonly loaded: (items: readonly string[]) => void;
}

export function createTodoState(): TodoState {
  const items = signal<readonly string[]>([]);

  return { items, loaded: (next) => items.set(next) };
}
`;

/** An effects file over the widened state, with `body` as what it does on load. */
const effects = (body: string): string => `import { signal } from 'sheratan';

import type { TodoState } from './todo.state.ts';

export function createTodoEffects(state: TodoState): () => void {
  return () => {
${body}
  };
}
`;

const project = (body: string): Record<string, string> => ({
  'modules/todo/todo.state.ts': WIDENED_STATE,
  'modules/todo/todo.effects.ts': effects(body),
});

const linesOf = (files: Record<string, string>): number[] =>
  check(files).map((finding) => finding.range.line);

test('effects that call a transition are clean', () => {
  assert.deepEqual(check(project("    state.loaded(['milk']);")), []);
});

test('a write through the state object is reported at the signal it writes', () => {
  assert.deepEqual(check(project("    state.items.set(['milk']);")), [
    {
      code: 'SHR-L005',
      severity: 'error',
      file: 'modules/todo/todo.effects.ts',
      range: { line: 7, column: 5 },
      message:
        'modules/todo/todo.effects.ts writes `state.items` directly; effects change state only by calling a transition exported by todo.state.ts.',
      fix: 'Add a transition to todo.state.ts that makes this write, call it here instead, and keep the Signal inside the state file behind an Accessor (SHR-L010).',
      docs: 'https://sheratan.dev/errors/SHR-L005',
    },
  ]);
});

test('the write is found by its type, so a destructured signal is no escape', () => {
  const body = "    const { items } = state;\n    const list = items;\n\n    list.set(['milk']);";

  assert.deepEqual(linesOf(project(body)), [10]);
});

test('a signal effects created for itself is still a write effects may not make', () => {
  const body = '    const count = signal(0);\n\n    count.set(1);';

  assert.deepEqual(linesOf(project(body)), [9]);
});

test('a set() on something that is not a signal is not a write to state', () => {
  const body = "    const seen = new Map<string, number>();\n\n    seen.set('milk', 1);";

  assert.deepEqual(check(project(body)), []);
});

test('only effects are asked: a state file writes its own signals', () => {
  assert.deepEqual(check({ 'modules/todo/todo.state.ts': WIDENED_STATE }), []);
});
