// The `sheratan` command as the tarball carries it: one bundle of the CLI and
// the checker, in plain JavaScript, with a shebang. `bin` in package.json
// points at it, which is what makes `npx sheratan check` resolve.
//
// Two things this build must keep true. The compiler stays **external**: it is
// an optional peer dependency, so it is resolved from the project being
// checked rather than copied in here. And the entry must not reach it at load
// — `bin/sheratan.ts` imports the command through `await import`, and code
// splitting is what keeps that import in a chunk of its own, so `--help` and
// the missing-compiler message work with no TypeScript installed.

import { chmod, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, '../cli/bin/sheratan.ts');
const outdir = resolve(root, 'dist/cli');
const command = resolve(outdir, 'sheratan.js');

/** esbuild keeps the entry's own hashbang; this is the assertion that it did. */
const SHEBANG = '#!/usr/bin/env node';

/** Readable and runnable by anyone, writable by its owner: what npm links as a command. */
const EXECUTABLE = 0o755;

// Chunk names carry a content hash, so yesterday's chunks would otherwise ride
// along in the tarball for ever.
await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: [entry],
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  legalComments: 'none',
  // Resolved from the checked project, never bundled: see ADR 0005 and the
  // `peerDependenciesMeta.optional` entry in package.json.
  external: ['typescript', 'typescript/*'],
});

const bundle = await readFile(command, 'utf8');

if (bundle.includes('typescript/unstable')) {
  throw new Error('The command entry loads the compiler; --help must work without one.');
}

if (!bundle.startsWith(SHEBANG)) {
  throw new Error(`The command lost its hashbang, so a shell cannot run it: ${SHEBANG}`);
}

await chmod(command, EXECUTABLE);

process.stdout.write(`built ${command} (${String(Buffer.byteLength(bundle))} bytes)\n`);
