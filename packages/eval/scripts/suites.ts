// Proves the hidden suites before they are allowed to score anything.
//
//   pnpm --filter @sheratan/eval suites
//   pnpm --filter @sheratan/eval suites -- --arm sheratan --task T01
//
// Two halves, and a suite needs both:
//
//   1. Against the arm's reference implementation, everything passes. A
//      correct app that a hidden test fails is a hidden test that would have
//      failed a correct agent, and every run of that task would be noise.
//   2. Against the reference with one thing broken, exactly the tests that
//      name that break fail. A suite that passes a broken app is measuring
//      nothing, and would report a wash as a result.

import { armNamed, type Arm } from '../src/arm.ts';
import { MUTATIONS, type Mutation } from '../src/mutations.ts';
import { mutatedOf, REFERENCES } from '../src/reference.ts';
import { runSuite, WEEK_0 } from '../src/suite.ts';
import { setUpStage } from '../src/stage.ts';
import type { SuiteRun } from '../src/iterate.ts';

const FAILED = 1;

function valueOf(argv: readonly string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);

  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

/** One suite, on its own stage, torn down however it ends. */
async function against(arm: Arm, task: string): Promise<SuiteRun> {
  await using stage = await setUpStage({ arm });

  const run = await runSuite(task, stage.origin, stage.backend);
  const reached = stage.tampering();

  // A suite that asked for a test-only surface at the app's origin would void
  // every run it ever scored. Caught here, once, rather than in the matrix.
  if (reached.length === 0) return run;

  return { ...run, ok: false, failing: [...run.failing, `reached ${reached.join(', ')}`] };
}

function report(label: string, ok: boolean, detail: readonly string[]): void {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}`);

  if (!ok) for (const line of detail) console.log(`        ${line}`);
}

/**
 * The reference is a legal app by the arm's own definition. It is also the
 * only coverage the shell around `hosts/` gets: that shell is a fragment —
 * its entry imports a file it does not contain — so it cannot be typechecked
 * where it sits, and is checked here, assembled, by the command the arm ships.
 */
async function proveClean(arm: Arm): Promise<boolean> {
  await using stage = await setUpStage({ arm });

  const run = await stage.clean();

  report('clean', run.ok, [run.output.trim()]);

  return !run.ok;
}

/** Every task's suite against a correct app. Anything but green is a failure. */
async function proveReference(arm: Arm, tasks: readonly string[]): Promise<boolean> {
  console.log(`${arm.label}\n`);

  let failed = false;

  for (const task of tasks) {
    // eslint-disable-next-line no-await-in-loop -- each task owns two servers and a port
    const run = await against(arm, task);

    // No names at all means the runner never produced a report: a config
    // error or a crash, which would otherwise print as a silent failure.
    const detail = run.failing.length > 0 ? run.failing : [run.raw];

    report(task, run.ok, detail);

    failed ||= !run.ok;
  }

  return failed;
}

/** What a mutation was supposed to cost, against what it did. */
function mismatch(mutation: Mutation, run: SuiteRun): readonly string[] {
  if (run.ok) return ['nothing failed — the suite does not notice this break'];

  const wanted = mutation.fails.toSorted();
  const got = run.failing.toSorted();

  if (wanted.join('\n') === got.join('\n')) return [];

  return [
    'expected these to fail, and only these:',
    ...wanted.map((name) => `  - ${name}`),
    'these failed:',
    ...got.map((name) => `  - ${name}`),
  ];
}

/** Each mutation, which must break exactly the tests it names. */
async function proveMutations(arm: Arm, mutations: readonly Mutation[]): Promise<boolean> {
  console.log('');

  let failed = false;

  for (const mutation of mutations) {
    // eslint-disable-next-line no-await-in-loop -- each mutation owns two servers and a port
    const run = await against(mutatedOf(arm, mutation), mutation.task);
    const wrong = mismatch(mutation, run);

    report(`${mutation.id} — ${mutation.summary}`, wrong.length === 0, wrong);

    failed ||= wrong.length > 0;
  }

  return failed;
}

const argv = process.argv.slice(2);
const id = valueOf(argv, '--arm', 'sheratan');
const arm = armNamed(REFERENCES, id);
const only = valueOf(argv, '--task', '');
const wanted = (task: string): boolean => only === '' || task === only;

const tasks = WEEK_0.filter(wanted);
const mutations = (MUTATIONS.get(id) ?? []).filter((one) => wanted(one.task));

if (mutations.length === 0) {
  throw new Error(
    `No mutations for ${id}${only === '' ? '' : ` ${only}`}; the proof is half of one.`,
  );
}

const brokenReference = await proveReference(arm, tasks);
const unclean = await proveClean(arm);
const brokenMutations = await proveMutations(arm, mutations);

if (brokenReference || unclean || brokenMutations) process.exitCode = FAILED;
