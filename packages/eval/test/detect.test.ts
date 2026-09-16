// The detector is both the agent's input and the verdict on its output, so a
// rule that quietly matches nothing would score every run as a repair. Each
// rule is proved to fire, and proved not to fire on the things that look like
// it (AGENTS.md: break the code once).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CASES } from '../src/cases.ts';
import { detect } from '../src/detect.ts';
import { RuleCode } from '../src/rules.ts';
import { inject, readTree } from '../src/tree.ts';
import type { SourceFile } from '../src/source.ts';

const HOSTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hosts');

const tree: SourceFile[] = await readTree(HOSTS);

function one(path: string, text: string): SourceFile[] {
  return [{ path, text }];
}

test('the host app, as committed, has nothing to report', () => {
  assert.deepEqual(detect(tree), []);
});

test('every case injects exactly the violation it claims', () => {
  for (const violation of CASES) {
    const found = detect(inject(tree, violation));
    const codes = new Set(found.map((entry) => entry.code));

    assert.ok(found.length > 0, `${violation.id} produced no finding`);
    assert.deepEqual([...codes], [violation.code], `${violation.id} reported the wrong rule`);

    assert.ok(
      found.every((entry) => entry.file.includes(`modules/${violation.host}/`)),
      `${violation.id} reported outside its host`,
    );
  }
});

test('every finding carries the fields the agent is given (SPEC §8)', () => {
  const [sample] = CASES;

  assert.ok(sample);

  const [first] = detect(inject(tree, sample));

  assert.ok(first);
  assert.equal(first.severity, 'error');
  assert.ok(first.message.length > 0);
  assert.ok(first.fix.length > 0, 'the fix field is the thing under test');
  assert.match(first.docs, /^https:\/\/sheratan\.dev\/errors\/L\d{3}$/);
  assert.ok(first.range.line > 0);
  assert.ok(first.range.column > 0);
});

// ------------------------------------------------------------- L002

test('L002 fires on an I/O global in a view', () => {
  const [first] = detect(
    one('modules/a/a.view.ts', 'export const x = () => {\n  document.title = "hi";\n};\n'),
  );

  assert.ok(first);
  assert.equal(first.code, RuleCode.ViewIO);
  assert.equal(first.range.line, 2);
});

test('L002 ignores the same word in a comment, a string or a property', () => {
  const text = `// document.title is not allowed here
const note = 'call fetch in effects';
export const x = (host: { document: string }) => host.document;
`;

  assert.deepEqual(detect(one('modules/a/a.view.ts', text)), []);
});

test('L002 does not apply outside a view', () => {
  const text = 'export const x = () => {\n  document.title = "hi";\n};\n';

  assert.deepEqual(detect(one('modules/a/a.effects.ts', text)), []);
});

// ------------------------------------------------------------- L005

test('L005 fires when effects writes a signal', () => {
  const found = detect(
    one('modules/a/a.effects.ts', 'export const x = (state) => {\n  state.rows.set([]);\n};\n'),
  );

  const [first] = found;

  assert.ok(first);
  assert.equal(first.code, RuleCode.DirectWrite);
  assert.match(first.message, /state\.rows\.set/);
});

test('L005 leaves a Map or Set built in the same file alone', () => {
  const text = `export const x = () => {
  const seen = new Map<string, number>();

  seen.set('a', 1);
};
`;

  assert.deepEqual(detect(one('modules/a/a.effects.ts', text)), []);
});

test('L005 does not apply to a state file, which is where writes belong', () => {
  const text = 'export const x = (rows) => {\n  rows.set([]);\n};\n';

  assert.deepEqual(detect(one('modules/a/a.state.ts', text)), []);
});

// ------------------------------------------------------------- L001

test('L001 fires on a reach past another module’s index', () => {
  const text = "import { x } from '../b/b.state.ts';\n";
  const found = detect(one('modules/a/a.effects.ts', text));

  const [first] = found;

  assert.ok(first);
  assert.equal(first.code, RuleCode.Boundary);
  assert.match(first.fix, /\.\.\/b\/index\.ts/);
});

test('L001 allows the index, the module’s own files and anything outside modules', () => {
  const text = `import { x } from '../b/index.ts';
import { y } from './a.state.ts';
import { z } from '../../services/api.contract.ts';
import { w } from 'sheratan';
`;

  assert.deepEqual(detect(one('modules/a/a.effects.ts', text)), []);
});

test('L001 sees an export … from as well as an import', () => {
  const text = "export type { X } from '../b/b.state.ts';\n";

  const [first] = detect(one('modules/a/index.ts', text));

  assert.ok(first);
  assert.equal(first.code, RuleCode.Boundary);
});
