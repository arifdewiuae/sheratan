// The production build: one minified ESM file whose errors carry a code and a
// docs link instead of message text (SPEC A3). The development build is what
// `tsc` emits — readable, with source maps into the TypeScript.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Plugin } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/prod/index.js');
const declarations = resolve(root, 'dist/dev');

// TypeScript 7.0.2 applies `rewriteRelativeImportExtensions` to emitted
// JavaScript but not to emitted declarations, which keep `./x.ts` and fail to
// resolve for consumers. scripts/verify-types.ts is the check that catches it.
async function rewriteDeclarationExtensions(): Promise<void> {
  const files = (await readdir(declarations)).filter((file) => file.endsWith('.d.ts'));

  await Promise.all(
    files.map(async (file) => {
      const path = resolve(declarations, file);
      const source = await readFile(path, 'utf8');
      const fixed = source.replaceAll(/(from\s+'\.[^']*)\.ts'/g, "$1.js'");

      if (fixed !== source) await writeFile(path, fixed);
    }),
  );
}

await rewriteDeclarationExtensions();

// Swapping a module is how development-only code leaves the bundle: `env.ts`
// takes the message table with it, `trace.ts` the causal trace (SPEC §7).
// Guarding the call sites with `DEV` is not enough on its own — esbuild folds
// the branch but keeps the module, so the code would ship unreachable.
const SWAPPED = new Set(['env', 'trace']);

const productionModules: Plugin = {
  name: 'sheratan-production-modules',
  setup(current) {
    current.onResolve({ filter: /\/(env|trace)\.ts$/ }, (args) => {
      const name = args.path.slice(args.path.lastIndexOf('/') + 1, -'.ts'.length);

      if (!SWAPPED.has(name)) return null;

      return { path: resolve(dirname(args.importer), `${name}.prod.ts`) };
    });
  },
};

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  plugins: [productionModules],
});

const bundle = await readFile(outfile, 'utf8');
const leaked = 'onDispose() needs an owner';

if (bundle.includes(leaked)) {
  throw new Error(`Production bundle still carries development messages: ${leaked}`);
}

if (!bundle.includes('sheratan.dev/errors/')) {
  throw new Error('Production bundle lost the docs link errors point at.');
}

// SPEC §7: the trace is absent from production, not merely switched off in it.
// Asserted rather than assumed, because a `DEV` branch that fails to fold is
// invisible — the bundle still works, it just carries what it promised not to.
for (const absent of ['__sheratan', 'recomputed', 'causal']) {
  if (bundle.includes(absent)) {
    throw new Error(`Production bundle still carries the causal trace: ${absent}`);
  }
}

// The package entry is ESM-only; state it next to the output so a consumer
// unpacking dist/ sees it too. `sideEffects` has to be restated as well: a
// bundler reads the *nearest* package.json to the file it is shaking, so
// without this one the root's promise never reaches the code it is about and
// an app that imports only `signal` still ships the template engine.
await writeFile(
  resolve(root, 'dist/prod/package.json'),
  `${JSON.stringify({ type: 'module', sideEffects: false }, null, 2)}\n`,
);

process.stdout.write(`built ${outfile} (${String(Buffer.byteLength(bundle))} bytes)\n`);
