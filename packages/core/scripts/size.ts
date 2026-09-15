// Size budget. A framework that claims to be small has to prove it on every
// commit: each scenario below is bundled, tree-shaken, minified and
// brotli-compressed, then compared against size-budget.json.
//
//   node scripts/size.ts            check against the budget
//   node scripts/size.ts --update   record current sizes as the new budget

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budgetFile = resolve(root, 'size-budget.json');
const entry = resolve(root, 'dist/prod/index.js');

/** Room to absorb formatting noise before a build fails. */
const TOLERANCE = 1.02;

async function measure(names: readonly string[]): Promise<number> {
  const imports = names.join(', ');

  const result = await build({
    stdin: {
      contents: `export { ${imports} } from ${JSON.stringify(entry)};`,
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2022',
    write: false,
  });

  const output = result.outputFiles[0];

  if (output === undefined) throw new Error(`esbuild produced nothing for ${imports}`);

  return brotliCompressSync(output.contents, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  }).byteLength;
}

// What a real app imports, rather than one export at a time: nearly every
// name pulls in the same graph, so per-export numbers say nothing.
const SCENARIOS: Record<string, readonly string[]> = {
  everything: [
    'batch',
    'computed',
    'each',
    'flush',
    'html',
    'onDispose',
    'render',
    'signal',
    'watch',
  ],
  'state only': ['signal', 'computed', 'batch'],
  widget: ['signal', 'computed', 'html', 'render'],
  'widget with lists': ['signal', 'computed', 'html', 'render', 'each'],
};

const measured = await Promise.all(
  Object.entries(SCENARIOS).map(
    async ([scenario, names]) => [scenario, await measure(names)] as const,
  ),
);

const sizes: Record<string, number> = Object.fromEntries(measured);

if (process.argv.includes('--update')) {
  await writeFile(budgetFile, `${JSON.stringify(sizes, null, 2)}\n`);

  process.stdout.write(
    `size budget written: ${JSON.stringify(sizes['everything'])} B brotli for everything\n`,
  );
} else {
  const budget = JSON.parse(await readFile(budgetFile, 'utf8')) as Record<string, number>;
  const failures: string[] = [];

  for (const [name, size] of Object.entries(sizes)) {
    const limit = budget[name];

    if (limit === undefined) {
      failures.push(`${name}: no budget recorded; run \`node scripts/size.ts --update\``);
      continue;
    }

    const allowed = Math.ceil(limit * TOLERANCE);

    if (size > allowed) failures.push(`${name}: ${String(size)} B > ${String(allowed)} B budget`);
  }

  for (const [scenario, size] of Object.entries(sizes)) {
    process.stdout.write(`${scenario.padEnd(20)} ${String(size).padStart(6)} B brotli\n`);
  }

  if (failures.length > 0) {
    process.stderr.write(`\nsize budget exceeded:\n  ${failures.join('\n  ')}\n`);
    process.exit(1);
  }
}
