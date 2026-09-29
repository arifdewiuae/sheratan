// The confinement, proved against the operating system rather than read off
// the profile. A profile that looks right and denies nothing is exactly what
// the first matrix ran without noticing, so every rule here is exercised on a
// real file by a real process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertConfined,
  confine,
  profileFor,
  REPOSITORY,
  transcriptDirOf,
  TRANSCRIPTS,
} from '../src/confine.ts';

const MACOS = process.platform === 'darwin';
const ONLY_MACOS = { skip: MACOS ? false : 'sandbox-exec exists only on macOS' };

/** Whether a process under `profile` can read `path`. */
async function canRead(path: string, profile: string): Promise<boolean> {
  const wrapped = confine('/bin/cat', [path], profile);

  return new Promise<boolean>((settle) => {
    const child = spawn(wrapped.command, [...wrapped.args], { stdio: 'ignore' });

    child.on('close', (code) => settle(code === 0));
  });
}

/** A directory named the way the stage names a sandbox, with one file in it. */
async function sandbox(arm: string): Promise<{ root: string; file: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `sheratan-eval-${arm}-`)));
  const file = join(root, 'package.json');

  await writeFile(file, '{}\n', 'utf8');

  return { root, file };
}

test('a transcript directory is named the way Claude Code names it', () => {
  // A real directory from the first matrix, and the sandbox it was for.
  const root =
    '/private/var/folders/kp/r9wzq81d2fd7x_215r7_598w0000gn/T/sheratan-eval-sheratan-3RVGmh';

  assert.equal(
    transcriptDirOf(root),
    join(
      TRANSCRIPTS,
      '-private-var-folders-kp-r9wzq81d2fd7x-215r7-598w0000gn-T-sheratan-eval-sheratan-3RVGmh',
    ),
  );
});

test('the profile names every place it denies, and its own two exceptions last', () => {
  const profile = profileFor('/private/var/T/sheratan-eval-react-abc');

  assert.ok(profile.includes(`(subpath "${REPOSITORY}")`));
  assert.ok(profile.includes('(subpath "/private/tmp")'));

  assert.ok(
    profile.endsWith(
      '(allow file-read* file-write* (subpath "/private/var/T/sheratan-eval-react-abc"))',
    ),
  );
});

test(
  'the repository is unreadable from inside and the sandbox is readable',
  ONLY_MACOS,
  async () => {
    const own = await sandbox('sheratan');

    try {
      const profile = profileFor(own.root);

      assert.equal(await canRead(join(REPOSITORY, 'package.json'), profile), false);
      assert.equal(await canRead(own.file, profile), true);
      await assertConfined(profile, own.file);
    } finally {
      await rm(own.root, { recursive: true, force: true });
    }
  },
);

test(
  'another sandbox is unreadable, so a crashed run leaves nothing to find',
  ONLY_MACOS,
  async () => {
    const own = await sandbox('sheratan');
    const other = await sandbox('react');

    try {
      assert.equal(await canRead(other.file, profileFor(own.root)), false);
    } finally {
      await rm(own.root, { recursive: true, force: true });
      await rm(other.root, { recursive: true, force: true });
    }
  },
);

test(
  "shared /tmp is unreadable, so one seed cannot find the last one's scripts",
  ONLY_MACOS,
  async () => {
    const own = await sandbox('sheratan');
    const left = await mkdtemp('/private/tmp/sheratan-left-');
    const script = join(left, 'verify.mjs');

    try {
      await writeFile(script, 'export {};\n', 'utf8');

      assert.equal(await canRead(script, profileFor(own.root)), false);
    } finally {
      await rm(own.root, { recursive: true, force: true });
      await rm(left, { recursive: true, force: true });
    }
  },
);

test('a profile that lets the repository through is refused before a run', ONLY_MACOS, async () => {
  const own = await sandbox('sheratan');

  try {
    await assert.rejects(assertConfined('(version 1)(allow default)', own.file), /does not hold/u);
  } finally {
    await rm(own.root, { recursive: true, force: true });
  }
});
