// The Week 1 gate: 500-row reordering within 2x of Solid (Docs/EVAL.md Gates).
//
// Builds both arms with the same esbuild settings, serves them over HTTP, and
// drives real Chromium through Playwright — 5 runs per arm, interleaved, so a
// machine that warms up over the session does not hand the advantage to
// whichever arm ran first.
//
// Usage: pnpm perf    (see ../README.md for the install step)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { transformAsync } from '@babel/core';
import solid from 'babel-preset-solid';
import { build } from 'esbuild';
import { chromium } from 'playwright';

import { FRAME_BUDGET_MS } from './driver.ts';
import { FRAMES, ROWS, SWAPS_PER_FRAME } from './workload.ts';

const root = import.meta.dirname;

/** The production bundle a user installs, not `src` — the arm has to be the shipped thing. */
const SHERATAN = resolve(root, '../../../packages/core/dist/prod/index.js');

/** Runs per arm. Five, with the median and the spread reported (EVAL 2.5). */
const RUNS = 5;

/** The gate. Outside it, reconciliation gets fixed before anything else. */
const GATE = 2;

/** Port for the throwaway server. Nothing else in this repo uses it. */
const PORT = 5199;
const ORIGIN = `http://localhost:${String(PORT)}`;

const OK = 200;
const NOT_FOUND = 404;
const PERCENT = 100;
const P95 = 0.95;
const MEDIAN = 0.5;

/** Decimal places: milliseconds read at two, a multiple at two. */
const PLACES = 2;

const PAGE_TYPE = 'text/html; charset=utf-8';
const SCRIPT_TYPE = 'text/javascript; charset=utf-8';

interface Arm {
  readonly label: string;
  /** Both the URL it is served at and the name of its bundle. */
  readonly path: string;
  readonly entry: string;
}

const ARMS: readonly Arm[] = [
  { label: 'Sheratan', path: 'sheratan', entry: './sheratan.ts' },
  { label: 'Solid 1.9', path: 'solid', entry: './solid.jsx' },
];

/** Solid compiled by its own compiler. A runtime template engine would understate the baseline. */
const solidJsx = {
  name: 'solid-jsx',
  setup(builder) {
    builder.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const compiled = await transformAsync(source, {
        filename: args.path,
        presets: [[solid, { generate: 'dom' }]],
        babelrc: false,
        configFile: false,
      });

      return { contents: compiled?.code ?? '', loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

async function bundle(arm: Arm): Promise<string> {
  const result = await build({
    stdin: {
      contents: `
        import { start } from '${arm.entry}';
        import { measure } from './driver.ts';
        globalThis.__bench = () => measure(start(document.getElementById('app')));
      `,
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2024',
    platform: 'browser',
    alias: { sheratan: SHERATAN },
    conditions: ['module', 'browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [solidJsx],
    write: false,
    logLevel: 'silent',
  });

  return result.outputFiles[0]!.text;
}

function page(script: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>reorder</title>
<style>body{margin:0;font:12px/1.4 system-ui}.row{display:flex;gap:8px}</style></head>
<body><div id="app"></div><script type="module" src="${script}"></script></body>
</html>`;
}

/** Every route the throwaway server answers: one page and one bundle per arm. */
async function routesFor(arms: readonly Arm[]): Promise<Map<string, readonly [string, string]>> {
  const routes = new Map<string, readonly [string, string]>();

  for (const arm of arms) {
    const script = `/${arm.path}.js`;

    routes.set(script, [SCRIPT_TYPE, await bundle(arm)]);
    routes.set(`/${arm.path}`, [PAGE_TYPE, page(script)]);
  }

  return routes;
}

function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);

  return sorted[Math.max(0, rank - 1)]!;
}

/** What one run of one arm cost. */
interface Run {
  readonly p95: number;
  readonly median: number;
  readonly dropped: number;
}

function summarise(samples: readonly number[]): Run {
  return {
    p95: quantile(samples, P95),
    median: quantile(samples, MEDIAN),
    dropped: samples.filter((one) => one > FRAME_BUDGET_MS).length / samples.length,
  };
}

function ms(value: number): string {
  return value.toFixed(PLACES);
}

function line(arm: Arm, runs: readonly Run[]): string {
  const p95s = runs.map((one) => one.p95);
  const spread = [...p95s].sort((left, right) => left - right);

  return (
    `${arm.label.padEnd(12)} ${ms(quantile(p95s, MEDIAN)).padStart(7)} ms   ` +
    `${ms(spread[0]!)}–${ms(spread.at(-1)!)} ms   ` +
    `${ms(quantile(runs.map((one) => one.median), MEDIAN)).padStart(10)} ms   ` +
    `${(quantile(runs.map((one) => one.dropped), MEDIAN) * PERCENT).toFixed(1).padStart(8)}%`
  );
}

const routes = await routesFor(ARMS);

const server = createServer((request, response) => {
  const route = routes.get(new URL(request.url ?? '/', ORIGIN).pathname);

  if (route === undefined) {
    response.writeHead(NOT_FOUND).end();

    return;
  }

  response.writeHead(OK, { 'content-type': route[0] }).end(route[1]);
});

await new Promise<void>((ready) => server.listen(PORT, ready));

// Frame scheduling is the measurement, so the browser must not throttle or
// background the page while it runs.
const browser = await chromium.launch({
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

const results = new Map<string, Run[]>(ARMS.map((arm) => [arm.label, []]));

for (let run = 1; run <= RUNS; run += 1) {
  for (const arm of ARMS) {
    const context = await browser.newContext();
    const tab = await context.newPage();

    await tab.goto(`${ORIGIN}/${arm.path}`);

    const samples = await tab.evaluate(
      () => (globalThis as { __bench: () => Promise<readonly number[]> }).__bench(),
    );

    results.get(arm.label)!.push(summarise(samples));

    await context.close();

    process.stdout.write(`run ${String(run)}/${String(RUNS)}  ${arm.label.padEnd(10)} done\n`);
  }
}

await browser.close();
server.close();

console.log(
  `\n${String(ROWS)} rows, ${String(SWAPS_PER_FRAME)} swaps per frame, ` +
    `${String(FRAMES)} measured frames, ${String(RUNS)} runs, headless Chromium\n`,
);
console.log('arm          p95 (median)   p95 spread        median frame   over budget');

for (const arm of ARMS) {
  console.log(line(arm, results.get(arm.label)!));
}

const [ours, baseline] = ARMS.map((arm) =>
  quantile(
    results.get(arm.label)!.map((one) => one.p95),
    MEDIAN,
  ),
);

const ratio = ours! / baseline!;
const met = ratio < GATE;

console.log(
  `\nSheratan / Solid on p95: ${ratio.toFixed(PLACES)}x   ` +
    `gate: < ${GATE.toFixed(PLACES)}x   ${met ? 'PASS' : 'FAIL'}\n`,
);

process.exitCode = met ? 0 : 1;
