// `sheratan create` end to end: the template on disk, through the scaffolder,
// to a directory a person can install and run. What the scaffolded app *is* —
// clean under the checker, and exercising every rule — is asserted where the
// checker lives (`packages/check/test/template.test.ts`); this suite is about
// the copy and the two edits it makes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Exit, run, scaffoldApp } from '../src/index.ts';
import { RUNTIME_VERSION } from '../src/version.ts';
import { recorder } from './terminal.ts';

/** A directory to scaffold into, removed when the block that made it ends. */
interface Space extends Disposable {
  /** A path inside the temp directory that does not exist yet. */
  readonly free: string;
  /** The temp directory itself, which does exist. */
  readonly taken: string;
}

function space(): Space {
  const taken = realpathSync(mkdtempSync(join(tmpdir(), 'sheratan-create-')));

  return {
    taken,
    free: join(taken, 'app'),
    [Symbol.dispose]: (): void => {
      rmSync(taken, { recursive: true, force: true });
    },
  };
}

function manifestOf(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
}

test('a new app is written where it was asked for', async () => {
  using where = space();

  const app = await scaffoldApp({ root: where.free, name: 'shop' });

  assert.equal(app.root, where.free);
  assert.equal(app.name, 'shop');
  assert.equal(app.version, RUNTIME_VERSION);
});

test('the app has every file it needs to run and be checked', async () => {
  using where = space();

  await scaffoldApp({ root: where.free, name: 'shop' });

  for (const file of [
    'index.html',
    'tsconfig.json',
    'app.ts',
    'styles/global.css',
    'services/devices.contract.ts',
    'modules/devices/devices.state.ts',
    'modules/devices/devices.effects.ts',
    'modules/devices/devices.view.ts',
    'modules/devices/devices.css',
    'modules/devices/index.ts',
    'modules/devices/devices.state.test.ts',
    'modules/devices/devices.effects.test.ts',
  ]) {
    assert.ok(readFileSync(join(where.free, file), 'utf8').length > 0, `${file} is missing`);
  }
});

test('the manifest takes the app name and a real runtime version', async () => {
  using where = space();

  await scaffoldApp({ root: where.free, name: 'shop' });

  const manifest = manifestOf(where.free);

  assert.equal(manifest['name'], 'shop');
  assert.deepEqual(manifest['dependencies'], { sheratan: `^${RUNTIME_VERSION}` });
  // The template is a workspace member in this repository, and an app that
  // shipped with that link would not install anywhere else.
  assert.ok(!JSON.stringify(manifest).includes('workspace:'), 'a workspace link was copied out');
});

test('the workspace link tree is never copied', async () => {
  using where = space();

  await scaffoldApp({ root: where.free, name: 'shop' });

  assert.throws(() => readFileSync(join(where.free, 'node_modules/sheratan/package.json')));
});

test('a name npm could not accept is refused before anything is written', async () => {
  using where = space();

  await assert.rejects(
    () => scaffoldApp({ root: where.free, name: 'My App' }),
    /cannot be a package name/,
  );

  assert.throws(() => readFileSync(join(where.free, 'package.json')));
});

test('a directory with files in it is refused', async () => {
  using where = space();

  writeFileSync(join(where.taken, 'README.md'), '# mine\n');

  await assert.rejects(
    () => scaffoldApp({ root: where.taken, name: 'shop' }),
    /never writes into an existing project/,
  );
});

test('an existing but empty directory is fine', async () => {
  using where = space();

  const app = await scaffoldApp({ root: where.taken, name: 'shop' });

  assert.equal(manifestOf(app.root)['name'], 'shop');
});

test('the app gets its lint and format config as dotfiles', async () => {
  using where = space();

  await scaffoldApp({ root: where.free, name: 'shop' });

  assert.ok(readFileSync(join(where.free, '.oxlintrc.json'), 'utf8').includes('complexity'));
  assert.ok(readFileSync(join(where.free, '.oxfmtrc.json'), 'utf8').includes('printWidth'));
  // Undotted in the template, so this repository's own lint does not discover
  // and merge it; the app is where it becomes live.
  assert.throws(() => readFileSync(join(where.free, 'oxlintrc.json')));
});

test('a scaffolded app passes its own lint config', async () => {
  using where = space();

  await scaffoldApp({ root: where.free, name: 'shop' });

  const oxlint = resolve(import.meta.dirname, '../../../node_modules/.bin/oxlint');

  const linted = spawnSync(oxlint, ['--deny-warnings'], {
    cwd: where.free,
    encoding: 'utf8',
  });

  assert.equal(
    linted.status,
    0,
    `the template ships a config its own files fail:\n${linted.stdout}${linted.stderr}`,
  );
});

test('the command says what it made and what to run next', async () => {
  using where = space();
  const { terminal, out, err } = recorder();

  assert.equal(await run(['create', where.free], terminal), Exit.Clean);
  assert.equal(err.length, 0);
  assert.match(out[0] ?? '', /npm install/u);
  assert.match(out[0] ?? '', /npm run dev/u);
});

test('a path is allowed, and the app is named after its last segment', async () => {
  using where = space();
  const { terminal } = recorder();

  assert.equal(await run(['create', join(where.taken, 'nested/shop')], terminal), Exit.Clean);
  assert.equal(manifestOf(join(where.taken, 'nested/shop'))['name'], 'shop');
});

test('create with no name is a usage error, not a directory called undefined', async () => {
  const { terminal, out, err } = recorder();

  assert.equal(await run(['create'], terminal), Exit.Usage);
  assert.deepEqual(out, []);
  assert.match(err[0] ?? '', /needs a name for the app/u);
});

test('create is no longer listed as unbuilt', async () => {
  const { terminal, out } = recorder();

  await run(['--help'], terminal);

  assert.match(out[0] ?? '', /sheratan create <app>/u);
  assert.doesNotMatch(out[0] ?? '', /not built yet: .*create/u);
});
