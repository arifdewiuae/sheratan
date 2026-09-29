// Turns a results directory into the table that goes in the writeup.
//
//   pnpm --filter @sheratan/eval report                # the newest run
//   pnpm --filter @sheratan/eval report -- <directory>

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PACKAGE } from '../src/sandbox.ts';

const PERCENT = 100;
const MONEY = 2;
const NAME_WIDTH = 22;

interface Run {
  readonly case: string;
  readonly host: string;
  readonly code: string;
  readonly pass: boolean;
  readonly repaired: boolean;
  readonly behaviourKept: boolean;
  readonly cycles: readonly string[];
  readonly costUSD: number;
  readonly durationMs: number;
}

interface Summary {
  readonly when: string;
  readonly model: string;
  readonly told: string;
  readonly total: number;
  readonly passed: number;
  readonly rate: number;
  readonly gate: number;
  readonly met: boolean;
  readonly costUSD: number;
}

/**
 * Whether this directory holds a finished **self-repair** run. Both halves
 * matter: a run still in progress has no summary yet, and a task or matrix
 * run has a summary of an entirely different shape. `runs.jsonl` is what only
 * this eval writes, so it is what the newest run is recognised by — otherwise
 * `pnpm report` would pick up the newest task run and fail reading it.
 */
async function finished(results: string, name: string): Promise<boolean> {
  try {
    await readFile(join(results, name, 'runs.jsonl'), 'utf8');

    return true;
  } catch {
    return false;
  }
}

async function newest(): Promise<string> {
  const results = join(PACKAGE, 'results');
  const entries = await readdir(results, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const done = await Promise.all(names.map(async (name) => finished(results, name)));

  const last = names
    .filter((_unused, index) => done[index] === true)
    .toSorted()
    .at(-1);

  if (last === undefined) throw new Error('no results to report');

  return join(results, last);
}

function share(runs: readonly Run[], of: (run: Run) => boolean): string {
  const count = runs.filter(of).length;

  return `${String(count)}/${String(runs.length)}`;
}

function rule(runs: readonly Run[], code: string): string {
  const mine = runs.filter((run) => run.code === code);
  const passed = mine.filter((run) => run.pass).length;
  const rate = ((passed / mine.length) * PERCENT).toFixed(0);

  return `| \`${code}\` | ${String(passed)}/${String(mine.length)} | ${rate}% |`;
}

const named = process.argv.slice(2).find((argument) => argument !== '--');
const where = named ?? (await newest());
const summary = JSON.parse(await readFile(join(where, 'summary.json'), 'utf8')) as Summary;
const lines = (await readFile(join(where, 'runs.jsonl'), 'utf8')).trim().split('\n');
const runs = lines.map((line) => JSON.parse(line) as Run);

const seconds = runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length / 1000;

console.log(`# Week 0 self-repair — ${summary.when}\n`);

console.log(
  `Model \`${summary.model}\`, told \`${summary.told}\`, one turn per case, ` +
    `${String(runs.length)} runs.\n`,
);

console.log(
  `**${String(summary.passed)}/${String(summary.total)} ` +
    `(${(summary.rate * PERCENT).toFixed(1)}%)** against a gate of ` +
    `${String(summary.gate * PERCENT)}% — **${summary.met ? 'met' : 'not met'}**.\n`,
);

console.log('| Rule | Passed | Rate |');
console.log('|---|---|---|');

for (const code of new Set(runs.map((run) => run.code))) console.log(rule(runs, code));

console.log('\n| Case | Passed |');
console.log('|---|---|');

for (const id of new Set(runs.map((run) => run.case))) {
  const mine = runs.filter((run) => run.case === id);

  console.log(`| \`${id.padEnd(NAME_WIDTH)}\` | ${share(mine, (run) => run.pass)} |`);
}

console.log('\nWhere the failures were:\n');

console.log(`- checker still reports something: ${share(runs, (run) => !run.repaired)}`);
console.log(`- behaviour suite broken: ${share(runs, (run) => !run.behaviourKept)}`);

console.log(
  `- structure fixed but behaviour broken: ${share(runs, (run) => run.repaired && !run.behaviourKept)}`,
);

console.log(
  `- runtime module cycle introduced (not scored): ${share(runs, (run) => run.cycles.length > 0)}`,
);

console.log(
  `\nCost $${summary.costUSD.toFixed(MONEY)}, ${seconds.toFixed(1)}s per run on average.`,
);
