// The command as a user gets it. `packages/cli` tests the source; this runs
// the file the tarball carries, because `bin` points at the built bundle and
// nothing else proves that bundle works.
//
// It also proves the halves of the optional peer dependency: with no compiler
// resolvable, `check` answers with an install line rather than a resolver's
// stack trace, and `--help` still answers at all.

import { cp, mkdtemp, stat } from 'node:fs/promises';
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

process.stdout.write('the built command checks, helps and asks for the compiler it needs\n');
