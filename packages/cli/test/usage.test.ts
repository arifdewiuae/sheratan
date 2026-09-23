// What the command says when it cannot do what was asked. Every wrong
// invocation names the command that does exist, and none of it reaches
// stdout, so `--json` output is never mixed with prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Exit, run } from '../src/index.ts';
import { messageOf } from '../src/run.ts';
import { recorder } from './terminal.ts';

const USAGE = /sheratan check \[directory\] \[--json\]/;

test('--help prints the usage on stdout and exits 0', () => {
  const { terminal, out, err } = recorder();

  assert.equal(run(['--help'], terminal), Exit.Clean);
  assert.match(out.join(''), USAGE);
  assert.deepEqual(err, []);
});

test('-h is the same as --help', () => {
  const { terminal, out } = recorder();

  assert.equal(run(['-h'], terminal), Exit.Clean);
  assert.match(out.join(''), USAGE);
});

test('no command at all is a usage error on stderr', () => {
  const { terminal, out, err } = recorder();

  assert.equal(run([], terminal), Exit.Usage);
  assert.deepEqual(out, []);
  assert.match(err.join(''), /needs a command; this build ships check/);
  assert.match(err.join(''), USAGE);
});

test('a command SPEC specifies but Week 3 has not built says so by name', () => {
  const { terminal, err } = recorder();

  assert.equal(run(['dev'], terminal), Exit.Usage);
  assert.match(err.join(''), /sheratan dev is specified but not built yet/);
});

test('a command that does not exist at all is told apart from one that will', () => {
  const { terminal, err } = recorder();

  assert.equal(run(['lint'], terminal), Exit.Usage);
  assert.match(err.join(''), /sheratan has no command `lint`/);
});

test('an unknown flag fails with the parser reason and the usage', () => {
  const { terminal, err } = recorder();

  assert.equal(run(['check', '--fix'], terminal), Exit.Usage);
  assert.match(err.join(''), /--fix/);
  assert.match(err.join(''), USAGE);
});

test('something thrown that is not an Error still prints', () => {
  assert.equal(messageOf('the compiler walked out'), 'the compiler walked out');

  assert.equal(
    messageOf(new Error('could not open tsconfig.json')),
    'could not open tsconfig.json',
  );
});
