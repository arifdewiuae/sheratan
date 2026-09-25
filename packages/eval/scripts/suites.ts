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

import { existsSync } from 'node:fs';

import { armNamed, type Arm } from '../src/arm.ts';
import { MUTATIONS, type Mutation } from '../src/mutations.ts';
import { INSTALLED, mutatedOf, REFERENCES } from '../src/reference.ts';
import { runSuite, WEEK_0 } from '../src/suite.ts';
import { setUpStage } from '../src/stage.ts';
import type { SuiteRun } from '../src/iterate.ts';

const FAILED = 1;

/** Where the one arm whose tree may be missing is installed from. */
const INSTALL_IN = 'controls/react';

function valueOf(argv: readonly string[], flag: string, fallback: string): string {
  const at = argv.indexOf(flag);

  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

const argv = process.argv.slice(2);

/** One task, or every Week 0 task when the flag is absent. */
const only = valueOf(argv, '--task', '');

const inScope = (task: string): boolean => only === '' || task === only;

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

/** Whether this arm's reference has a tree to borrow, and what to do if not. */
function installed(id: string): boolean {
  const modules = INSTALLED.get(id);

  return modules !== undefined && existsSync(modules);
}

/**
 * Said loudly, and never in passing. A proof that quietly covers one arm is
 * the failure this whole script exists to prevent: the suites would be green
 * against the framework they were written beside, and untested against the one
 * they are supposed to be neutral towards.
 */
function announceSkip(id: string): void {
  console.log(`SKIP  ${id} — nothing installed at ${String(INSTALLED.get(id))}`);
  console.log('      The suites are NOT proved against this arm.');
  console.log(`      pnpm --dir ${INSTALL_IN} install --ignore-workspace\n`);
}

/** One arm's reference, both halves. */
async function prove(id: string, tasks: readonly string[]): Promise<boolean> {
  const arm = armNamed(REFERENCES, id);
  const mutations = (MUTATIONS.get(id) ?? []).filter((one) => inScope(one.task));

  if (mutations.length === 0) {
    throw new Error(
      `No mutations for ${id}${only === '' ? '' : ` ${only}`}; the proof is half of one.`,
    );
  }

  const brokenReference = await proveReference(arm, tasks);
  const unclean = await proveClean(arm);
  const brokenMutations = await proveMutations(arm, mutations);

  return brokenReference || unclean || brokenMutations;
}

const tasks = WEEK_0.filter(inScope);

// No `--arm` means every arm that has a reference. A suite is neutral or it is
// not, and asking about one arm at a time is for debugging, not for the proof.
const named = valueOf(argv, '--arm', '');
const ids = named === '' ? [...REFERENCES.keys()] : [named];

// Resolved before anything is stood up, so a name that is not an arm is told
// what the arms are rather than reported as an arm with nothing installed.
for (const id of ids) armNamed(REFERENCES, id);

let failed = false;
const proved: string[] = [];

for (const id of ids) {
  if (!installed(id)) {
    announceSkip(id);

    // Asked for by name, it is an error: the answer to "prove React" is not
    // silence. Reached by default, it is a gap the banner above has named.
    failed ||= named !== '';

    continue;
  }

  // eslint-disable-next-line no-await-in-loop -- each arm owns every port its stages take
  failed ||= await prove(id, tasks);
  proved.push(id);

  console.log('');
}

console.log(`proved against: ${proved.length === 0 ? 'nothing' : proved.join(', ')}`);

if (failed) process.exitCode = FAILED;
