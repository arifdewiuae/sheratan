// EVAL-TASKS §1.1: the hidden suites are framework-neutral by construction.
//
// "By construction" is a claim, and a claim with nothing checking it is a
// comment. Two things have to hold, and neither is visible in a passing run:
//
//   1. No suite names a framework. A suite that mentions one has stopped
//      being the same measurement for both arms, whichever way it leans.
//   2. No suite names a test-only surface. Those are reached at `evalkit`'s
//      own address, and a suite that asked for one at the app's origin would
//      be recorded as tampering — voiding every run it was scoring.
//   3. Every arm is proved with the same breaks. A suite that has been shown
//      to notice a missing rollback in one framework and never asked about it
//      in the other is not one instrument, whatever its text says.
//
// `harness.ts` is the one exemption from the second rule, because it is the
// one file that owns the two origins and keeps that knowledge out of the
// suites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MUTATIONS } from '../src/mutations.ts';
import { REFERENCES } from '../src/reference.ts';
import { PACKAGE } from '../src/sandbox.ts';
import { SUITES, WEEK_0 } from '../src/suite.ts';

const SUITES_DIR = join(PACKAGE, 'suites');

/** The one file allowed to know where `evalkit` actually is. */
const HARNESS = 'harness.ts';

/** Names that would make a suite one arm's rather than both arms'. */
const FRAMEWORKS =
  /\b(?:sheratan|react|preact|vue|svelte|solid-js|angular|qwik|vite|tanstack|zustand|redux|jquery)\b/iu;

/** The prefixes `evalkit` puts its test-only surfaces behind. */
const HIDDEN = ['__control', '__inspect'];

async function suiteFiles(): Promise<readonly string[]> {
  return (await readdir(SUITES_DIR)).filter((name) => name.endsWith('.ts')).toSorted();
}

async function textOf(name: string): Promise<string> {
  return readFile(join(SUITES_DIR, name), 'utf8');
}

/** Every suite file with its contents, read once rather than once per rule. */
async function suiteTexts(): Promise<readonly (readonly [string, string])[]> {
  const files = await suiteFiles();

  return Promise.all(files.map(async (name) => [name, await textOf(name)] as const));
}

test('every task the gate scores has a suite, and every suite has a task', async () => {
  const files = await suiteFiles();
  const specs = files.filter((name) => name.endsWith('.spec.ts')).map((name) => name.slice(0, -8));

  assert.deepEqual(specs, [...WEEK_0].toSorted());
  assert.deepEqual([...SUITES.keys()].toSorted(), [...WEEK_0].toSorted());
});

test('no hidden suite names a framework', async () => {
  const texts = await suiteTexts();

  assert.ok(texts.length > 0, 'there are no suites to check');

  for (const [name, text] of texts) {
    const found = FRAMEWORKS.exec(text);

    // `assert.ok`, not `assert.equal`: a failed `equal` prints the whole file
    // it matched in, and the name it found is the only part worth reading.
    assert.ok(
      found === null,
      `${name} names ${found?.[0] ?? ''}; a suite that knows which arm it is running is not one measurement`,
    );
  }
});

test('only the harness knows where the test-only surfaces are', async () => {
  for (const [name, text] of await suiteTexts()) {
    if (name === HARNESS) continue;

    for (const surface of HIDDEN) {
      assert.ok(
        !text.includes(surface),
        `${name} names ${surface}; asking for one at the app's origin voids the run it is scoring`,
      );
    }
  }
});

test('the harness is what reaches them, so the exemption is not vacuous', async () => {
  const text = await textOf(HARNESS);

  for (const surface of HIDDEN) {
    assert.ok(text.includes(surface), `${HARNESS} no longer reaches ${surface}`);
  }
});

/** What one arm's reference is proved with, as a comparable set of names. */
function breaksFor(arm: string): readonly string[] {
  return (MUTATIONS.get(arm) ?? []).map((one) => one.id).toSorted();
}

test('every reference is proved with something, not merely run', async () => {
  for (const arm of REFERENCES.keys()) {
    assert.ok(
      breaksFor(arm).length > 0,
      `${arm} has a reference and no mutations: the suites would be shown to pass it and never shown to catch it`,
    );
  }
});

test('the arms are proved with the same breaks, or they are not one instrument', async () => {
  const [first, ...rest] = [...REFERENCES.keys()];

  assert.ok(first !== undefined, 'no references at all');

  for (const arm of rest) {
    assert.deepEqual(
      breaksFor(arm),
      breaksFor(first),
      `${arm} and ${first} are proved with different breaks; whichever is missing is an assertion nobody has shown would fire for that arm`,
    );
  }
});
