// The task eval (EVAL-TASKS §1.4): one task, one arm, an agent with a shell,
// up to ten iterations. The other half of the Week 0 gate — `run.ts` is the
// self-repair half, and this is the one that has never been measured.
//
//   pnpm --filter @sheratan/eval task -- --task T01 --arm sheratan --smoke
//   pnpm --filter @sheratan/eval task -- --task T01 --arm sheratan --seeds 5
//
// Every prompt, reply and iteration is written under results/, and those logs
// are committed: a number nobody can re-read is not evidence.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ARMS } from '../src/arms/index.ts';
import { armNamed, type Arm } from '../src/arm.ts';
import { assertWithinBudget, countTokens, describeCount } from '../src/budget.ts';
import { CONTRACT_FILE, readTaskSet, taskNamed, type Task } from '../src/frozen.ts';
import { iterate, ITERATION_CAP, type SuiteRun, type TaskRun } from '../src/iterate.ts';
import { openSession, TOOLS } from '../src/session.ts';
import { PACKAGE } from '../src/sandbox.ts';
import { setUpStage } from '../src/stage.ts';

const MODEL = 'claude-sonnet-5';
const SEEDS = 5;
const MONEY = 2;
const SECONDS = 1000;

/**
 * The hidden suites, by task id. Empty in this build: the suites are their own
 * change, and a half-written one scoring a run is worse than none at all.
 */
const SUITES: ReadonlyMap<string, (origin: string, backend: string) => Promise<SuiteRun>> =
  new Map();

/** What `--smoke` judges with instead. Loud on purpose — see `announce`. */
const NO_SUITE: SuiteRun = { ok: true, failing: [], raw: 'no hidden suite ran' };

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

/**
 * The documentation and the API contract, appended to the agent's own system
 * prompt. §1.5 budgets the documentation; §6 puts the contract outside that
 * budget, identically for every arm.
 */
async function systemFor(arm: Arm): Promise<string> {
  const [docs, contract] = await Promise.all([
    readFile(arm.docs, 'utf8'),
    readFile(CONTRACT_FILE, 'utf8'),
  ]);

  return `${docs}\n\n---\n\n${contract}`;
}

/** What one seed of one task on one arm is run with. */
interface Once {
  readonly task: Task;
  readonly arm: Arm;
  readonly seed: number;
  readonly opts: Options;
  /** The results directory this seed's logs are written into. */
  readonly into: string;
}

/** One seed, start to finish, with everything it said kept on disk. */
async function once({ task, arm, seed, opts, into }: Once): Promise<TaskRun> {
  const stage = await setUpStage({ arm, seed });
  const stem = `${task.id}-${arm.id}-seed${String(seed)}`;

  try {
    const system = await systemFor(arm);
    const session = openSession({ root: stage.root, model: opts.model, system });
    const suite = SUITES.get(task.id);

    const run = await iterate({
      session,
      judge: {
        clean: async () => stage.clean(),
        suite: async () => (suite === undefined ? NO_SUITE : suite(stage.origin, stage.backend)),
      },
      prompt: `${task.prompt}\n\nThe app is served at ${stage.origin}.`,
      cap: opts.cap,
      tampering: () => stage.tampering(),
    });

    await writeFile(
      join(into, `${stem}.log.json`),
      `${JSON.stringify(run.log, null, 2)}\n`,
      'utf8',
    );

    return run;
  } finally {
    await stage[Symbol.asyncDispose]();
  }
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

const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
const into = join(PACKAGE, 'results', `${stamp}-${task.id}-${arm.id}`);

await mkdir(into, { recursive: true });

// Identical for every seed of a run, so it is recorded once rather than
// thirty times. It is the whole of what the arm was told, which is the thing
// a reader of the result will want to check first (EVAL §2.5).
await writeFile(join(into, 'system.txt'), await systemFor(arm), 'utf8');

announce(task, arm, opts);

const runs: TaskRun[] = [];

for (let seed = 1; seed <= opts.seeds; seed++) {
  // eslint-disable-next-line no-await-in-loop -- each seed owns two servers and a port
  const run = await once({ task, arm, seed, opts, into });

  runs.push(run);

  const how = run.converged ? `converged in ${String(run.iterations)}` : 'did not converge';

  console.log(
    `seed ${String(seed)}  ${how}  $${run.costUSD.toFixed(MONEY)}  ` +
      `${(run.durationMs / SECONDS).toFixed(0)}s` +
      (run.tampering.length === 0 ? '' : `  VOID: reached ${run.tampering.join(', ')}`),
  );
}

// A run that reached for a test-only surface is void, whatever it then did:
// counting it as converged would let an arm improve its own number by
// cheating and have the cheating recorded in a field nobody sums.
const scored = runs.filter((run) => run.tampering.length === 0);
const converged = scored.filter((run) => run.converged);
const cost = runs.reduce((sum, run) => sum + run.costUSD, 0);
const iterations = converged.map((run) => run.iterations).toSorted((a, b) => a - b);

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
      converged: converged.length,
      iterations,
      costUSD: cost,
      voided: runs.length - scored.length,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`\n${String(converged.length)}/${String(scored.length)} converged`);
console.log(`iterations ${iterations.length === 0 ? 'none' : iterations.join(', ')}`);
console.log(`cost $${cost.toFixed(MONEY)} · logs in ${into}`);
