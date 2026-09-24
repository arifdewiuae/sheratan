// The command as a user gets it. `packages/cli` tests the source; this runs
// the file the tarball carries, because `bin` points at the built bundle and
// nothing else proves that bundle works.
//
// It also proves the halves of the optional peer dependency: with no compiler
// resolvable, `check` answers with an install line rather than a resolver's
// stack trace, and `--help` still answers at all. And it proves `create`, which
// is the one command whose data — the template — is shipped beside the bundle
// rather than inside it.

import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = resolve(root, 'dist/cli/sheratan.js');
const app = resolve(root, '../../examples/hello');

const SHEBANG = '#!/usr/bin/env node';

/** The owner-writable, everyone-executable bits npm expects on a `bin`. */
const EXECUTABLE = 0o111;

const CLEAN = 0;

/** What a scaffolded app must contain before anything else is believed. */
const SCAFFOLDED: readonly string[] = [
  'package.json',
  'index.html',
  'app.ts',
  'styles/global.css',
  'services/devices.contract.ts',
  'modules/devices/index.ts',
];

const CANNOT_RUN = 2;

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function sheratan(entry: string, args: readonly string[], cwd: string): Run {
  return spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8' });
}

function expect(condition: boolean, complaint: string): void {
  if (!condition) throw new Error(complaint);
}

// The version a scaffolded app is told to install is written down rather than
// resolved at run time, so this is the only thing keeping it true.
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version: string;
};

const constant = await readFile(resolve(root, '../cli/src/version.ts'), 'utf8');

expect(
  constant.includes(`'${manifest.version}'`),
  `RUNTIME_VERSION in packages/cli/src/version.ts disagrees with packages/core/package.json ` +
    `(${manifest.version}); a scaffolded app would ask npm for a version that is not this one.`,
);

const mode = (await stat(command)).mode;

expect(
  (mode & EXECUTABLE) !== 0,
  `${command} is not executable, so npm cannot link it as a command`,
);

const checked = sheratan(command, ['check', app], root);

expect(checked.status === CLEAN, `the built command failed on examples/hello: ${checked.stderr}`);
expect(!checked.stdout.startsWith(SHEBANG), 'the command printed its own source');
expect(checked.stdout.trim() === 'No violations.', `unexpected output: ${checked.stdout}`);

// A copy outside the workspace has no `typescript` above it to resolve, which
// is exactly the install that leaves the optional peer dependency out.
const bare = await mkdtemp(resolve(tmpdir(), 'sheratan-cli-'));

await cp(resolve(root, 'dist/cli'), resolve(bare, 'cli'), { recursive: true });

// The template rides beside the bundle, and `create` finds it with one
// relative URL — so the copy has to keep them the same distance apart.
await cp(resolve(root, 'dist/template'), resolve(bare, 'template'), { recursive: true });

const alone = resolve(bare, 'cli/sheratan.js');
const helped = sheratan(alone, ['--help'], bare);

expect(helped.status === CLEAN, `--help needs no compiler, but exited ${String(helped.status)}`);
expect(helped.stdout.includes('sheratan check [directory]'), '--help printed no usage');

const unchecked = sheratan(alone, ['check', '.'], bare);

expect(
  unchecked.status === CANNOT_RUN,
  `a missing compiler must exit ${String(CANNOT_RUN)}, not ${String(unchecked.status)}`,
);

expect(
  unchecked.stderr.includes('npm install -D typescript@7'),
  `a missing compiler must say what to install: ${unchecked.stderr}`,
);

// `create` needs no compiler either: it copies a directory and edits one
// manifest, which is the whole command.
const made = resolve(bare, 'shop');
const created = sheratan(alone, ['create', made], bare);

expect(
  created.status === CLEAN,
  `create needs no compiler, but exited ${String(created.status)}: ${created.stderr}`,
);

const present = await Promise.all(
  SCAFFOLDED.map(async (file) => (await readFile(resolve(made, file), 'utf8')).length > 0),
);

expect(present.every(Boolean), `the scaffolded app is missing one of ${SCAFFOLDED.join(', ')}`);

const scaffolded = JSON.parse(await readFile(resolve(made, 'package.json'), 'utf8')) as {
  name: string;
  dependencies: Record<string, string>;
};

expect(scaffolded.name === 'shop', `the app was named ${scaffolded.name}, not after its folder`);

expect(
  scaffolded.dependencies['sheratan'] === `^${manifest.version}`,
  `the app asks for sheratan@${String(scaffolded.dependencies['sheratan'])}, not ^${manifest.version}`,
);

// `build` is the other half of the optional peer dependency: it strips types
// with Node's own stripper, so it has to work in the same bare copy where
// `check` cannot run at all.
const site = resolve(bare, 'site');

const ENTRY =
  "import { kind } from './modules/todo/index.ts';\n\nexport const started: string = kind;\n";

const MODULE = "export const kind: string = 'view';\n";

await mkdir(resolve(site, 'modules/todo'), { recursive: true });

await writeFile(resolve(site, 'app.ts'), ENTRY);
await writeFile(resolve(site, 'modules/todo/index.ts'), MODULE);

const stripped = sheratan(alone, ['build', site], bare);

expect(
  stripped.status === CLEAN,
  `build needs no compiler, but exited ${String(stripped.status)}: ${stripped.stderr}`,
);

const emitted = await readFile(resolve(site, 'dist/app.js'), 'utf8');

expect(emitted.includes("'./modules/todo/index.js'"), `build left a .ts import: ${emitted}`);
expect(!emitted.includes(': string'), `build left a type annotation behind: ${emitted}`);

process.stdout.write(
  'the built command creates, checks, builds, helps and asks for the compiler it needs\n',
);
