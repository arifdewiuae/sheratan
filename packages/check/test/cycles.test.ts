// SHR-L008 over lib/ (SPEC §4): a utility may use another, but not in a
// circle. A cycle has no first file to load, and no file in it can be
// understood — or moved — without the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RuleCode } from '../src/index.ts';
import { check } from './project.ts';

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
