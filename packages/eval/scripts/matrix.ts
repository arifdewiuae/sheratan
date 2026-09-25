// The Week 0 gate's second half: median iterations to green, Sheratan against
// React, over every task the gate is ruled on.
//
//   pnpm --filter @sheratan/eval matrix                    # the whole grid
//   pnpm --filter @sheratan/eval matrix -- --seeds 1       # the smoke
//   pnpm --filter @sheratan/eval matrix -- --resume <dir>  # finish, or reprint
//
// Three things about how it runs, each of which changes what the number means.
//
// **The two arms of a seed run next to each other.** A grid that did all of
// one arm and then all of the other would put hours between the halves of
// every comparison, and any drift in the model or the service over those hours
// would land entirely on one arm. Paired in time, drift hits both.
//
// **Every cell is written as it finishes.** Thirty runs is hours and tens of
// dollars; `--resume` picks up a directory and re-runs only what is missing,
// so a crash costs one cell. A directory with every cell present prints the
// table and spends nothing, which is also how a result is re-read later.
//
// **The verdict is computed, not eyeballed.** `src/analysis.ts` holds the
// arithmetic and `test/analysis.test.ts` proves it for nothing, because the
// two judgement calls in it — censoring at the cap, and refusing to read a
// missing arm as a tie — decide the gate and are invisible in a table.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { ARMS } from '../src/arms/index.ts';
import { armNamed, type Arm } from '../src/arm.ts';
import { assertWithinBudget, type Count, countTokens, describeCount } from '../src/budget.ts';
import {
  type ArmResult,
  type Cell,
  type TaskResult,
  type Verdict,
  verdictOf,
} from '../src/analysis.ts';
import { runCell, stemOf, systemFor } from '../src/cell.ts';
import { ITERATION_CAP } from '../src/iterate.ts';
import { readTaskSet, type TaskSet, taskNamed, type Task } from '../src/frozen.ts';
import { SUITES, WEEK_0 } from '../src/suite.ts';
import { TOOLS } from '../src/session.ts';
import { stampedInto } from '../src/results.ts';

const MODEL = 'claude-sonnet-5';
/** EVAL-TASKS §1.4 step 5, as amended on 2026-09-25 from five. */
const SEEDS = 3;
const MONEY = 2;
const SECONDS = 1000;
const LIST = ',';

/** Who is on trial, and who they have to be no worse than (EVAL §2.3). */
const SUBJECT = 'sheratan';
const CONTROL = 'react';

/**
 * How many tasks the gate asks for: "median iterations on **≥ 3 tasks** no
 * worse than React" (EVAL §2.3). It is a constant and not the size of
 * whatever grid was asked for, so a one-task smoke reads "1 of 3 tasks
 * (3 needed): NOT MET" rather than announcing that the gate is met.
 */
const GATE_TASKS = 3;

/** How wide an arm's label is padded to, so two rows line up under a task. */
const LABEL_WIDTH = 36;

/** Wide enough for the longest arm id, so the seed column lines up as it runs. */
const ARM_WIDTH = Math.max(...[...ARMS.keys()].map((id) => id.length));

/** How a results directory carries the time it started, for a resumed run. */
const STAMPED = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/u;

interface Options {
  readonly tasks: readonly string[];
  readonly arms: readonly string[];
  readonly seeds: number;
  readonly model: string;
  readonly cap: number;
  readonly resume: string;
}

function valueOf(argv: readonly string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);

  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

function listOf(argv: readonly string[], flag: string, fallback: readonly string[]): string[] {
  const given = valueOf(argv, flag, '');

  return given === '' ? [...fallback] : given.split(LIST);
}

/** The arms a result moves a gate for, which is what a grid runs by default. */
const GATING = [...ARMS.values()].filter((arm) => arm.gates).map((arm) => arm.id);

function options(argv: readonly string[]): Options {
  return {
    tasks: listOf(argv, '--tasks', WEEK_0),
    arms: listOf(argv, '--arms', GATING),
    seeds: Number(valueOf(argv, '--seeds', String(SEEDS))),
    model: valueOf(argv, '--model', MODEL),
    cap: Number(valueOf(argv, '--cap', String(ITERATION_CAP))),
    resume: valueOf(argv, '--resume', ''),
  };
}

/** One cell of the grid, before it is run. */
interface Planned {
  readonly task: Task;
  readonly arm: Arm;
  readonly seed: number;
}

/**
 * The grid, in the order it is run: a task, a seed, then both arms. The arms
 * innermost is the whole point — see the note at the top.
 */
function plan(tasks: readonly Task[], arms: readonly Arm[], seeds: number): Planned[] {
  const planned: Planned[] = [];

  for (const task of tasks) {
    for (let seed = 1; seed <= seeds; seed++) {
      for (const arm of arms) planned.push({ task, arm, seed });
    }
  }

  return planned;
}

/** A cell this directory already holds, or nothing if it has to be run. */
async function alreadyRun(into: string, one: Planned): Promise<Cell | undefined> {
  const stem = stemOf(one.task.id, one.arm.id, one.seed);

  try {
    return JSON.parse(await readFile(join(into, `${stem}.cell.json`), 'utf8')) as Cell;
  } catch {
    return undefined;
  }
}

/** One line per cell as it lands, because a grid is watched, not awaited. */
function say(one: Planned, cell: Cell, reused: boolean): void {
  const how = cell.converged ? `converged in ${String(cell.iterations)}` : 'did not converge';
  const money = reused ? 'from disk' : `$${cell.costUSD.toFixed(MONEY)}`;
  const voided = cell.tampering.length === 0 ? '' : `  VOID: reached ${cell.tampering.join(', ')}`;

  console.log(
    `${one.task.id} ${one.arm.id.padEnd(ARM_WIDTH)} seed ${String(one.seed)}  ` +
      `${how}  ${money}  ${(cell.durationMs / SECONDS).toFixed(0)}s${voided}`,
  );
}

/** One arm's row under a task, or a line saying it has nothing to show. */
function rowFor(label: string, result: ArmResult | undefined): string {
  const name = label.padEnd(LABEL_WIDTH);

  if (result === undefined) return `  ${name}no scored runs`;

  const { median, q1, q3 } = result.spread;
  const voided = result.voided === 0 ? '' : `  ${String(result.voided)} VOID`;

  return (
    `  ${name}median ${median.toFixed(1)}  IQR ${q1.toFixed(1)}–${q3.toFixed(1)}  ` +
    `converged ${String(result.converged)}/${String(result.scored)}  ` +
    `$${result.costUSD.toFixed(MONEY)}${voided}`
  );
}

/**
 * Which way one task fell. A comparison missing an arm is unmeasured, and
 * saying "worse" would read as a result where there is none — the verdict
 * already refuses to count it, and the table has to say the same thing.
 */
function howItFell(result: TaskResult): string {
  if (result.subject === undefined || result.control === undefined) return 'not measured';

  return result.noWorse ? 'no worse' : 'WORSE';
}

/** The table, and then the one sentence the project is gated on. */
function print(verdict: Verdict, set: TaskSet, labels: ReadonlyMap<string, string>): void {
  console.log('');

  for (const result of verdict.tasks) {
    console.log(`${result.task} — ${taskNamed(set, result.task).title}`);
    console.log(rowFor(labels.get(SUBJECT) ?? SUBJECT, result.subject));
    console.log(rowFor(labels.get(CONTROL) ?? CONTROL, result.control));
    console.log(`  ${howItFell(result)}\n`);
  }

  console.log(
    `Week 0 gate — median iterations no worse than the control on ` +
      `${String(verdict.noWorse)} of ${String(verdict.tasks.length)} tasks ` +
      `(${String(verdict.needed)} needed): ${verdict.met ? 'MET' : 'NOT MET'}`,
  );

  if (verdict.tasks.length >= verdict.needed) return;

  console.log(`\nThis grid is smaller than the gate, so it cannot meet it whatever it says.`);
}

const opts = options(process.argv.slice(2));
const set = await readTaskSet();
const tasks = opts.tasks.map((id) => taskNamed(set, id));
const arms = opts.arms.map((id) => armNamed(ARMS, id));

for (const task of tasks) {
  if (SUITES.has(task.id)) continue;

  throw new Error(
    `${task.id} has no hidden suite in this build, so a run of it scores nothing ` +
      'and no gate number may come from it.',
  );
}

// EVAL-TASKS §1.5, before a single dollar is spent: a document that has grown
// past the budget costs two counts here, and a whole matrix and a retraction
// if it is noticed afterwards.
const counts = new Map<string, Count>();

for (const arm of arms) {
  // eslint-disable-next-line no-await-in-loop -- the counter is the model's own, one call per arm
  const count = await countTokens(await readFile(arm.docs, 'utf8'), opts.model);

  console.log(describeCount(arm, count));
  assertWithinBudget(arm, count);
  counts.set(arm.id, count);
}

/**
 * The directory to carry on in, which has to be one that exists: a typo would
 * otherwise read as an empty grid and quietly re-run every cell in it.
 */
function resuming(given: string): { stamp: string; into: string } {
  const into = resolve(given);

  if (!existsSync(into)) throw new Error(`No results directory at ${into}.`);

  // A resumed run keeps the time the grid started, which is in the name of
  // the directory. Rewriting `when` as empty would lose the one field that
  // says when the number was measured.
  return { stamp: STAMPED.exec(basename(into))?.[1] ?? '', into };
}

const started = opts.resume === '' ? await stampedInto('matrix') : resuming(opts.resume);

const into = started.into;

console.log(`\n${opts.resume === '' ? 'results in' : 'resuming'} ${into}\n`);

// The whole of what each arm was told, recorded once rather than fifteen
// times. It is the first thing a reader of the result will want to check.
for (const arm of arms) {
  // eslint-disable-next-line no-await-in-loop -- two small files, once
  await writeFile(join(into, `system-${arm.id}.txt`), await systemFor(arm), 'utf8');
}

const planned = plan(tasks, arms, opts.seeds);
const cells: Cell[] = [];

/** Everything known so far, rewritten after every cell so a kill costs nothing. */
async function record(): Promise<Verdict> {
  const verdict = verdictOf(opts.tasks, cells, { subject: SUBJECT, control: CONTROL }, GATE_TASKS);

  await writeFile(
    join(into, 'matrix.json'),
    `${JSON.stringify(
      {
        when: started.stamp,
        taskSet: set.version,
        digest: set.digest,
        model: opts.model,
        tools: TOOLS,
        docBudget: Object.fromEntries(counts),
        tasks: opts.tasks,
        arms: opts.arms,
        subject: SUBJECT,
        control: CONTROL,
        seeds: opts.seeds,
        cap: opts.cap,
        planned: planned.length,
        ran: cells.length,
        costUSD: cells.reduce((sum, cell) => sum + cell.costUSD, 0),
        verdict,
        cells,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return verdict;
}

/** One cell, from disk if it is already there. */
async function fill(one: Planned): Promise<void> {
  const reused = await alreadyRun(into, one);
  const cell = reused ?? (await runCell({ ...one, model: opts.model, cap: opts.cap, into }));

  cells.push(cell);
  say(one, cell, reused !== undefined);

  await record();
}

for (const one of planned) {
  try {
    // eslint-disable-next-line no-await-in-loop -- each cell owns two servers and a port
    await fill(one);
  } catch (error) {
    // Everything before this cell is on disk and costs nothing to keep. Said
    // here rather than left to a stack trace, because the alternative a reader
    // reaches for is starting the grid again.
    console.error(`\n${stemOf(one.task.id, one.arm.id, one.seed)} failed: ${String(error)}`);
    console.error(`\nEverything before it is kept. To carry on:\n`);
    console.error(`  pnpm --filter @sheratan/eval matrix -- --resume ${into}\n`);

    throw error;
  }
}

const labels = new Map(arms.map((arm) => [arm.id, arm.label]));

print(await record(), set, labels);

console.log(
  `\n${String(cells.length)} cells · ` +
    `$${cells.reduce((sum, cell) => sum + cell.costUSD, 0).toFixed(MONEY)} · ${into}`,
);
