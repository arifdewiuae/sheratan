// SHR-L008 (SPEC §4): a utility may use another, and a module may use another,
// but never in a circle. A cycle has no first node to load, and nothing in it
// can be understood — or moved — without the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { only } from './project.ts';

/** SHR-L008's own findings: these fixtures are loops, not whole modules. */
const check = only(RuleCode.Cycle);

const uses = (path: string, name: string): string =>
  `import { ${name} } from '${path}';\n\nexport const probe = ${name};\n`;

test('lib/ may import lib/ when nothing comes back round', () => {
  assert.deepEqual(
    check({
      'lib/money.ts': 'export const money = (n: number): string => n.toFixed(2);\n',
      'lib/price.ts': uses('./money.ts', 'money'),
      'lib/invoice.ts': uses('./price.ts', 'probe'),
    }),
    [],
  );
});

test('two lib/ files importing each other are one cycle, reported once', () => {
  const findings = check({
    'lib/b.ts': uses('./a.ts', 'probe'),
    'lib/a.ts': `// Utility a.\n\n${uses('./b.ts', 'probe')}`,
  });

  assert.deepEqual(findings, [
    {
      code: 'SHR-L008',
      severity: 'error',
      file: 'lib/a.ts',
      range: { line: 3, column: 1 },
      message:
        'lib/a.ts is part of an import cycle: lib/a.ts → lib/b.ts → lib/a.ts; allowed: lib may import lib, never back round to itself.',
      fix: 'Move what the files in the cycle share into a new lib/ file that imports none of them, and import that from each.',
      docs: 'https://sheratan.dev/errors/SHR-L008',
    },
  ]);
});

test('a longer cycle names every file in it, in order', () => {
  const [finding] = check({
    'lib/a.ts': uses('./b.ts', 'probe'),
    'lib/b.ts': uses('./c.ts', 'probe'),
    'lib/c.ts': uses('./a.ts', 'probe'),
    'lib/d.ts': uses('./a.ts', 'probe'),
  });

  assert.ok(finding);
  assert.match(finding.message, /lib\/a\.ts → lib\/b\.ts → lib\/c\.ts → lib\/a\.ts;/);
});

test('a file importing itself is a cycle of one', () => {
  const findings = check({ 'lib/a.ts': uses('./a.ts', 'probe') });

  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.message.split(';')[0]]),
    [[RuleCode.Cycle, 'lib/a.ts is part of an import cycle: lib/a.ts → lib/a.ts']],
  );
});

test('two separate cycles are two findings', () => {
  const findings = check({
    'lib/a.ts': uses('./b.ts', 'probe'),
    'lib/b.ts': uses('./a.ts', 'probe'),
    'lib/x.ts': uses('./y.ts', 'probe'),
    'lib/y.ts': uses('./x.ts', 'probe'),
  });

  assert.deepEqual(
    findings.map((finding) => finding.file),
    ['lib/a.ts', 'lib/x.ts'],
  );
});

test('a type-only import still counts: the dependency is real even if erased', () => {
  const findings = check({
    'lib/a.ts': "import type { B } from './b.ts';\n\nexport interface A {\n  readonly b?: B;\n}\n",
    'lib/b.ts': "import type { A } from './a.ts';\n\nexport interface B {\n  readonly a?: A;\n}\n",
  });

  assert.deepEqual(
    findings.map((finding) => finding.code),
    [RuleCode.Cycle],
  );
});

/** A module whose effects use each of `others` through its index. */
const module = (name: string, ...others: readonly string[]): Record<string, string> => ({
  [`modules/${name}/index.ts`]: `export const kind = 'full';\n\nexport const ${name} = 1;\n`,
  [`modules/${name}/${name}.effects.ts`]: others
    .map((other) => `import { ${other} } from '../${other}/index.ts';\n`)
    .concat(`\nexport const uses = [${others.join(', ')}];\n`)
    .join(''),
});

test('a module may use another when nothing comes back round', () => {
  assert.deepEqual(check({ ...module('orders', 'session'), ...module('session') }), []);
});

test('two modules using each other are one cycle, reported at the first import', () => {
  const findings = check({ ...module('orders', 'session'), ...module('session', 'orders') });

  assert.deepEqual(findings, [
    {
      code: 'SHR-L008',
      severity: 'error',
      file: 'modules/orders/orders.effects.ts',
      range: { line: 1, column: 1 },
      message:
        'modules/orders/orders.effects.ts is part of an import cycle: modules/orders → modules/session → modules/orders; allowed: a module may use another, never one that leads back to itself.',
      fix: 'Decide which module depends on the other and remove the import going the opposite way: move what both need into services/ if it does I/O or lib/ if it is pure, and import it from each.',
      docs: 'https://sheratan.dev/errors/SHR-L008',
    },
  ]);
});

test('a cycle through three modules names each module once, in order', () => {
  const [finding, ...rest] = check({
    ...module('a', 'b'),
    ...module('b', 'c'),
    ...module('c', 'a'),
  });

  assert.deepEqual(rest, []);
  assert.match(finding?.message ?? '', /: modules\/a → modules\/b → modules\/c → modules\/a;/);
});

test("a module's own files importing each other are not a cycle between modules", () => {
  assert.deepEqual(
    check({
      'modules/todo/index.ts':
        "import { createTodoEffects } from './todo.effects.ts';\n\nexport const kind = 'full';\n\nexport const create = createTodoEffects;\n",
      'modules/todo/todo.state.ts': 'export const createTodoState = (): number => 1;\n',
      'modules/todo/todo.effects.ts':
        "import { createTodoState } from './todo.state.ts';\n\nexport const createTodoEffects = createTodoState;\n",
    }),
    [],
  );
});

test('a type-only import closes a module cycle too', () => {
  const findings = check({
    ...module('orders', 'session'),
    'modules/session/index.ts':
      "import type { orders } from '../orders/index.ts';\n\nexport const kind = 'full';\n\nexport const session = (o: typeof orders): number => o;\n",
  });

  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.file]),
    [[RuleCode.Cycle, 'modules/orders/orders.effects.ts']],
  );
});
