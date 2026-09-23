// The process boundary itself: the shim in `bin/` is the one file `run()`
// cannot prove, so it is run as a real command against the app in this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dirname, '../bin/sheratan.ts');

const HELLO = resolve(import.meta.dirname, '../../../examples/hello');

const sheratan = (...args: readonly string[]): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('the command checks the example app clean, and says so on stdout', () => {
  const run = sheratan('check', HELLO);

  assert.equal(run.status, 0);
  assert.equal(run.stdout, 'No violations.\n');
  assert.equal(run.stderr, '');
});

test('a piped run carries no escape codes, whatever the terminal is', () => {
  const run = sheratan('check', HELLO, '--json');

  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).findings.length, 0);
  assert.ok(!run.stdout.includes('\u001B['));
});

test('an unusable command exits 2 with the reason on stderr', () => {
  const run = sheratan('check', 'no/such/project');

  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /could not open/);
});
