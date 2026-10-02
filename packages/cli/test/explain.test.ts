// `sheratan explain`: the table is complete, every example says what it
// claims, and the command prints both shapes. An example nobody ran is a
// claim, and the one place an agent goes to learn a rule must not teach it
// wrong — so a wrong example has to be caught with its own code, and a right
// one must not be.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { Window } from 'happy-dom';

import { RuleCode } from '../../check/src/finding.ts';
import { check } from '../../check/test/project.ts';
import { ErrorCode, SheratanError } from '../../core/src/index.ts';
import { explain, explanations, RESERVED } from '../src/explain/explain.ts';
import { CaughtBy, type Explanation, type ExampleFiles } from '../src/explain/explanation.ts';
import { Exit, run } from '../src/index.ts';
import { recorder } from './terminal.ts';

const CORE = pathToFileURL(resolve(import.meta.dirname, '../../core/src/index.ts')).href;

const ALL = explanations();

const window = new Window();

globalThis.document = window.document as unknown as Document;

/** Writes a runtime example to disk with `sheratan` pointed at the runtime's source, and imports its `app.ts`. */
async function runApp(files: ExampleFiles): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sheratan-explain-')));

  try {
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source.replaceAll("from 'sheratan'", `from '${CORE}'`));
    }

    document.body.innerHTML = '';

    await import(pathToFileURL(join(root, 'app.ts')).href);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const codesOf = (files: ExampleFiles): readonly string[] =>
  check(files).map((finding) => finding.code);

test('every code the runtime throws and the checker reports is explained, and nothing else', () => {
  const expected = [...Object.values(ErrorCode), ...Object.values(RuleCode)].toSorted();

  assert.deepEqual(
    ALL.map((entry) => entry.code),
    expected,
  );
});

test('a reserved code is not also an explained one', () => {
  for (const code of RESERVED) assert.equal(typeof explain(code), 'string', code);
});

for (const entry of ALL.filter((each) => each.caughtBy === CaughtBy.Checker)) {
  test(`${entry.code}: the wrong example is reported with it, and the right one is not`, () => {
    assert.ok(codesOf(entry.wrong).includes(entry.code), 'the wrong example is not caught');
    assert.ok(!codesOf(entry.right).includes(entry.code), 'the right example is caught');
  });
}

for (const entry of ALL.filter((each) => each.caughtBy === CaughtBy.Runtime)) {
  test(`${entry.code}: the wrong example throws it, and the right one runs`, async () => {
    await assert.rejects(
      runApp(entry.wrong),
      (error: unknown) => error instanceof SheratanError && error.code === entry.code,
    );

    await runApp(entry.right);
  });
}

test('one code prints what it is, why, both examples and the page', async () => {
  const { terminal, out, err } = recorder();

  assert.equal(await run(['explain', 'SHR-L007'], terminal), Exit.Clean);
  assert.deepEqual(err, []);

  const text = out.join('');

  assert.match(text, /^SHR-L007 {2}error, caught by the checker\n/u);
  assert.match(text, /\nWrong\n {2}services\/devices\.contract\.ts\n/u);
  assert.match(text, /\n {6}list\(\): Promise<readonly Device\[\]>;\n/u);
  assert.match(text, /\nRight\n/u);
  assert.match(text, /\ndocs https:\/\/sheratan\.dev\/errors\/SHR-L007$/u);
});

test('a code is found whatever its case', async () => {
  const { terminal, out } = recorder();

  assert.equal(await run(['explain', 'shr-r008'], terminal), Exit.Clean);
  assert.match(out.join(''), /^SHR-R008/u);
});

test('--json prints the whole explanation in the versioned envelope', async () => {
  const { terminal, out } = recorder();

  assert.equal(await run(['explain', 'SHR-T001', '--json'], terminal), Exit.Clean);

  const printed = JSON.parse(out.join('')) as Explanation & { version: number };

  assert.equal(printed.version, 1);
  assert.equal(printed.code, 'SHR-T001');
  assert.equal(printed.severity, 'warning');
  assert.equal(printed.caughtBy, 'checker');
  assert.equal(printed.docs, 'https://sheratan.dev/errors/SHR-T001');
  assert.ok('modules/devices/devices.state.test.ts' in printed.right);
});

test('no code lists every code, one line each, and says how to ask for one', async () => {
  const { terminal, out } = recorder();

  assert.equal(await run(['explain'], terminal), Exit.Clean);

  const lines = out.join('').split('\n');

  assert.equal(lines.filter((line) => line.startsWith('SHR-')).length, ALL.length);
  assert.ok(lines.includes("SHR-T001  warning  A module's state or effects has no test beside it"));
  assert.match(lines.at(-1) ?? '', /sheratan explain <code>/u);
});

test('the list in JSON names each code, its severity, where it is caught and its page', async () => {
  const { terminal, out } = recorder();

  assert.equal(await run(['explain', '--json'], terminal), Exit.Clean);

  const printed = JSON.parse(out.join('')) as { version: number; codes: readonly object[] };

  assert.equal(printed.version, 1);
  assert.equal(printed.codes.length, ALL.length);

  assert.deepEqual(Object.keys(printed.codes[0] ?? {}), [
    'code',
    'severity',
    'caughtBy',
    'title',
    'docs',
  ]);
});

test('a reserved code says it is not checked yet, on stderr, and exits 2', async () => {
  const { terminal, out, err } = recorder();

  assert.equal(await run(['explain', 'SHR-V001', '--json'], terminal), Exit.Usage);
  assert.deepEqual(out, []);
  assert.match(err.join(''), /SHR-V001 is reserved by SPEC §4 and not checked yet/u);
});

test('something that is not a code says so, and exits 2', async () => {
  const { terminal, out, err } = recorder();

  assert.equal(await run(['explain', 'L001'], terminal), Exit.Usage);
  assert.deepEqual(out, []);
  assert.match(err.join(''), /`L001` is not a Sheratan code/u);
});
