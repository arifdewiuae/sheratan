// The task eval (EVAL-TASKS §1.4): one task, one arm, an agent with a shell,
// up to ten iterations.
//
//   pnpm --filter @sheratan/eval task -- --task T01 --arm sheratan
//   pnpm --filter @sheratan/eval task -- --task T01 --arm react --seeds 5
//
// One cell of the grid, by hand. `matrix.ts` runs the whole grid the Week 0
// gate is decided on, through the same `runCell` this does — a probe that
// priced a cell differently from the way the matrix ran it would be pricing
// something else.
//
// Every prompt, reply and iteration is written under results/, and those logs
// are committed: a number nobody can re-read is not evidence.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ARMS } from '../src/arms/index.ts';
import { armNamed, type Arm } from '../src/arm.ts';
import { assertWithinBudget, countTokens, describeCount } from '../src/budget.ts';
import { type Cell, spreadOf } from '../src/analysis.ts';
import { runCell, systemFor } from '../src/cell.ts';
import { ITERATION_CAP } from '../src/iterate.ts';
import { readTaskSet, taskNamed, type Task } from '../src/frozen.ts';
import { SUITES } from '../src/suite.ts';
import { TOOLS } from '../src/session.ts';
import { stampedInto } from '../src/results.ts';

const MODEL = 'claude-sonnet-5';
const SEEDS = 5;
const MONEY = 2;
const SECONDS = 1000;

interface Options {
  readonly task: string;
  readonly arm: string;
  readonly seeds: number;
  readonly model: string;
  readonly cap: number;
  readonly smoke: boolean;
}

function valueOf(argv: readonly string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);

  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

function options(argv: readonly string[]): Options {
  return {
    task: valueOf(argv, '--task', 'T01'),
    arm: valueOf(argv, '--arm', 'sheratan'),
    seeds: Number(valueOf(argv, '--seeds', String(SEEDS))),
    model: valueOf(argv, '--model', MODEL),
    cap: Number(valueOf(argv, '--cap', String(ITERATION_CAP))),
    smoke: argv.includes('--smoke'),
  };
}

/** Says what this run can and cannot be quoted for. */
function announce(task: Task, arm: Arm, opts: Options): void {
  console.log(`${task.id} — ${task.title}`);

  console.log(
    `arm ${arm.label}, model ${opts.model}, ${String(opts.seeds)} seeds, cap ${String(opts.cap)}\n`,
  );

  if (SUITES.has(task.id)) return;

  console.log(
    'NO HIDDEN SUITE. This build has none, so convergence here means the arm\n' +
      'called itself done and the project was clean — not that the task was met.\n' +
      'No gate number may come from this run.\n',
  );
}

/** One line per seed, as it finishes, because a matrix is watched not awaited. */
function say(cell: Cell): void {
  const how = cell.converged ? `converged in ${String(cell.iterations)}` : 'did not converge';
  const voided = cell.tampering.length === 0 ? '' : `  VOID: reached ${cell.tampering.join(', ')}`;

  console.log(
    `seed ${String(cell.seed)}  ${how}  $${cell.costUSD.toFixed(MONEY)}  ` +
      `${(cell.durationMs / SECONDS).toFixed(0)}s${voided}`,
  );
}

const opts = options(process.argv.slice(2));
const set = await readTaskSet();
const task = taskNamed(set, opts.task);
const arm = armNamed(ARMS, opts.arm);

if (!SUITES.has(task.id) && !opts.smoke) {
  throw new Error(
    `${task.id} has no hidden suite in this build, so a run of it scores nothing. ` +
      'Pass --smoke to run it anyway, for cost and wall-clock only.',
  );
}

// EVAL-TASKS §1.5 asserts the budget **before a run starts**, so a document
// that has grown past it costs two probes rather than a matrix of runs and a
// retraction. It is measured per run, not per seed: the document does not
// change between seeds.
const count = await countTokens(await readFile(arm.docs, 'utf8'), opts.model);

console.log(`${describeCount(arm, count)}\n`);

assertWithinBudget(arm, count);

const { stamp, into } = await stampedInto(`${task.id}-${arm.id}`);

// Identical for every seed of a run, so it is recorded once rather than
// thirty times. It is the whole of what the arm was told, which is the thing
// a reader of the result will want to check first (EVAL §2.5).
await writeFile(join(into, 'system.txt'), await systemFor(arm), 'utf8');

announce(task, arm, opts);

const cells: Cell[] = [];

for (let seed = 1; seed <= opts.seeds; seed++) {
  // eslint-disable-next-line no-await-in-loop -- each seed owns two servers and a port
  const cell = await runCell({ task, arm, seed, model: opts.model, cap: opts.cap, into });

  cells.push(cell);
  say(cell);
}

// A run that reached for a test-only surface is void, whatever it then did:
// counting it as converged would let an arm improve its own number by
// cheating and have the cheating recorded in a field nobody sums.
const scored = cells.filter((cell) => cell.tampering.length === 0);
const cost = cells.reduce((sum, cell) => sum + cell.costUSD, 0);

// Censored at the cap: a run that never converged is a recorded outcome
// (§1.4 step 4), and dropping it would flatter whichever arm fails more.
// `analysis.ts` says why at length, and `test/analysis.test.ts` proves it.
const iterations = scored.map((cell) => cell.iterations).toSorted((a, b) => a - b);

await writeFile(
  join(into, 'summary.json'),
  `${JSON.stringify(
    {
      when: stamp,
      taskSet: set.version,
      digest: set.digest,
      task: task.id,
      arm: arm.id,
      gates: arm.gates,
      model: opts.model,
      // The independent variable against the self-repair half, which runs
      // `--restricted`. Recorded rather than described: what the agent could
      // do is the difference between the two instruments.
      tools: TOOLS,
      // The other controlled variable (§1.5), with both raw totals so the
      // subtraction is auditable from the log alone.
      docBudget: count,
      seeds: opts.seeds,
      cap: opts.cap,
      hiddenSuite: SUITES.has(task.id),
      scored: scored.length,
      converged: scored.filter((cell) => cell.converged).length,
      iterations,
      spread: iterations.length === 0 ? undefined : spreadOf(iterations),
      costUSD: cost,
      voided: cells.length - scored.length,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const converged = scored.filter((cell) => cell.converged).length;

console.log(`\n${String(converged)}/${String(scored.length)} converged`);
console.log(`iterations ${iterations.length === 0 ? 'none' : iterations.join(', ')}`);
console.log(`cost $${cost.toFixed(MONEY)} · logs in ${into}`);
