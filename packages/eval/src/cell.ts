// One cell of the matrix: one task, one arm, one seed, start to finish.
//
// It lives here rather than in a script because two scripts run it — `task.ts`
// for a single cell by hand, `matrix.ts` for the grid the Week 0 gate is
// decided on — and a matrix whose cells were run by different code from the
// probes that priced them would not be the same measurement.
//
// Everything the cell said is written as it finishes, not at the end of the
// run: a grid of thirty costs tens of dollars and hours, and a crash on the
// twenty-fifth must not take the first twenty-four with it.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Arm } from './arm.ts';
import type { Cell } from './analysis.ts';
import { CONTRACT_FILE, type Task } from './frozen.ts';
import { iterate, type SuiteRun, type TaskRun } from './iterate.ts';
import { openSession } from './session.ts';
import { SUITES } from './suite.ts';
import { setUpStage } from './stage.ts';

/** How the JSON on disk is indented, so a person can read a diff of it. */
const INDENT = 2;

/** What a task with no hidden suite in this build is judged with instead. */
export const NO_SUITE: SuiteRun = { ok: true, failing: [], raw: 'no hidden suite ran' };

/**
 * The documentation and the API contract, appended to the agent's own system
 * prompt. §1.5 budgets the documentation; §6 puts the contract outside that
 * budget, identically for every arm.
 *
 * @example
 * const session = openSession({ root, model, system: await systemFor(arm) });
 */
export async function systemFor(arm: Arm): Promise<string> {
  const [docs, contract] = await Promise.all([
    readFile(arm.docs, 'utf8'),
    readFile(CONTRACT_FILE, 'utf8'),
  ]);

  return `${docs}\n\n---\n\n${contract}`;
}

/** What one cell is run with. */
export interface CellOptions {
  readonly task: Task;
  readonly arm: Arm;
  readonly seed: number;
  readonly model: string;
  readonly cap: number;
  /** The results directory this cell's log and record are written into. */
  readonly into: string;
}

/** How one cell's files are named, and how a resumed run recognises it. */
export function stemOf(task: string, arm: string, seed: number): string {
  return `${task}-${arm}-seed${String(seed)}`;
}

/** The scalar record, which is what the verdict is computed from. */
function recordOf(options: CellOptions, run: TaskRun): Cell {
  return {
    task: options.task.id,
    arm: options.arm.id,
    seed: options.seed,
    converged: run.converged,
    iterations: run.iterations,
    costUSD: run.costUSD,
    durationMs: run.durationMs,
    tampering: run.tampering,
  };
}

/** The stage, the session and the loop — everything but the bookkeeping. */
async function work(options: CellOptions): Promise<TaskRun> {
  await using stage = await setUpStage({ arm: options.arm, seed: options.seed });

  const system = await systemFor(options.arm);
  const session = openSession({ root: stage.root, model: options.model, system });
  const suite = SUITES.get(options.task.id);

  return await iterate({
    session,
    judge: {
      clean: async () => stage.clean(),
      suite: async () => (suite === undefined ? NO_SUITE : suite(stage.origin, stage.backend)),
    },
    prompt: `${options.task.prompt}\n\nThe app is served at ${stage.origin}.`,
    cap: options.cap,
    tampering: () => stage.tampering(),
  });
}

/**
 * Runs one cell and writes both of its files: the full conversation, for a
 * reader, and the scalar record, for the verdict and for a resumed run.
 *
 * @example
 * const cell = await runCell({ task, arm, seed: 1, model, cap: 10, into });
 */
export async function runCell(options: CellOptions): Promise<Cell> {
  const stem = stemOf(options.task.id, options.arm.id, options.seed);
  const run = await work(options);
  const record = recordOf(options, run);

  await writeFile(
    join(options.into, `${stem}.log.json`),
    `${JSON.stringify(run.log, null, INDENT)}\n`,
    'utf8',
  );

  await writeFile(
    join(options.into, `${stem}.cell.json`),
    `${JSON.stringify(record, null, INDENT)}\n`,
    'utf8',
  );

  return record;
}
