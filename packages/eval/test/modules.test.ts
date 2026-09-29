// The two things an install outside the repository takes from it: its pnpm
// and its supply-chain policy. Either one lost is a tree the repository would
// not have installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { REPOSITORY } from '../src/confine.ts';
import { pinnedManifest, rootPolicy } from '../src/modules.ts';

test("an install outside the repository uses the repository's pnpm", async () => {
  const root = JSON.parse(await readFile(join(REPOSITORY, 'package.json'), 'utf8')) as {
    packageManager: string;
  };

  const manifest = JSON.parse(await pinnedManifest({ name: 'x', private: true })) as {
    packageManager: string;
  };

  assert.equal(manifest.packageManager, root.packageManager);
});

test('the policy is carried over whole, with nothing left to find as a workspace', async () => {
  const policy = await rootPolicy();

  assert.match(policy, /^packages: \[\]$/mu);
  assert.doesNotMatch(policy, /packages\/\*/u);

  for (const setting of [
    'minimumReleaseAge',
    'trustPolicy',
    'blockExoticSubdeps',
    'strictDepBuilds',
  ]) {
    assert.match(policy, new RegExp(`^${setting}:`, 'mu'), `${setting} was dropped`);
  }
});
