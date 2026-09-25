// Running a hidden suite against a live stage, and reporting it the one way
// EVAL-TASKS §1.4 allows: the names of what failed, never the assertions.
//
// The asymmetry is the instrument. The checker speaks in full, because a
// machine-readable remedy is what SPEC A3 claims; the suite gives names only,
// because an agent that could read the assertions would be writing to them
// instead of to the task. `raw` is kept for the log a person reads afterwards
// and is never handed to a session.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { SuiteRun } from './iterate.ts';
import { PACKAGE } from './sandbox.ts';

/**
 * EVAL-TASKS §2: the Week 0 gate is these three tasks, and only these three.
 * A task with no suite here scores nothing, which `task.ts` refuses to do
 * quietly.
 */
export const WEEK_0: readonly string[] = ['T01', 'T03', 'T04'];

/** How long one task's suite may take before the iteration is abandoned. */
const SUITE_TIMEOUT_MS = 300_000;

/** The runner, resolved from this package rather than from the sandbox. */
const PLAYWRIGHT = join(PACKAGE, 'node_modules', '.bin', 'playwright');

/** How a failing test reads when it sits inside a `describe`. */
const SEPARATOR = ' › ';

/** The shape of the JSON reporter's output, to the depth this reads it. */
interface ReportSpec {
  readonly title: string;
  readonly ok: boolean;
}

interface ReportSuite {
  readonly title: string;
  readonly specs?: readonly ReportSpec[];
  readonly suites?: readonly ReportSuite[];
}

interface Report {
  readonly suites?: readonly ReportSuite[];
  readonly errors?: readonly unknown[];
}

/** Every failing spec under one suite, named by the path a person would read. */
function failuresIn(suite: ReportSuite, within: readonly string[]): string[] {
  const path = [...within, suite.title];

  const here = (suite.specs ?? [])
    .filter((spec) => !spec.ok)
    .map((spec) => [...path.slice(1), spec.title].join(SEPARATOR));

  const below = (suite.suites ?? []).flatMap((nested) => failuresIn(nested, path));

  return [...here, ...below];
}

/**
 * The names of everything that failed. The top level of the report is one
 * entry per file, whose title is the filename — dropped, because a failing
 * test's name is what the agent is told and the file it lives in is not
 * something it is meant to know.
 */
export function failuresOf(report: Report): readonly string[] {
  return (report.suites ?? []).flatMap((suite) => failuresIn(suite, []));
}

/** What the runner said, whether or not it produced a report. */
interface Ran {
  readonly code: number | null;
  readonly output: string;
}

function play(task: string, env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise<Ran>((settle) => {
    const child = spawn(PLAYWRIGHT, ['test', `suites/${task}.spec.ts`], {
      cwd: PACKAGE,
      env,
      timeout: SUITE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    const take = (chunk: Buffer): void => {
      output += chunk.toString();
    };

    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => settle({ code: null, output: `${output}${error.message}` }));
    child.on('close', (code) => settle({ code, output }));
  });
}

/** The report the run wrote, or nothing when it never got as far as one. */
async function reportIn(file: string): Promise<Report | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Report;
  } catch {
    return undefined;
  }
}

/**
 * Runs one task's hidden suite against a running stage.
 *
 * A run that never produced a report — a config error, a crash, a timeout —
 * is a failure with no names, which `feedbackFor` says out loud rather than
 * reporting as a pass with an empty list.
 *
 * @example
 * const run = await runSuite('T01', stage.origin, stage.backend);
 */
export async function runSuite(task: string, origin: string, backend: string): Promise<SuiteRun> {
  const into = await mkdtemp(resolve(tmpdir(), 'sheratan-suite-'));
  const file = join(into, 'report.json');

  try {
    const ran = await play(task, {
      ...process.env,
      EVAL_ORIGIN: origin,
      EVAL_BACKEND: backend,
      PLAYWRIGHT_JSON_OUTPUT_NAME: file,
    });

    const report = await reportIn(file);
    const failing = report === undefined ? [] : failuresOf(report);

    return { ok: ran.code === 0 && report !== undefined, failing, raw: ran.output };
  } finally {
    await rm(into, { recursive: true, force: true });
  }
}

/** What judges a declared-done app, by task id. */
export type Suite = (origin: string, backend: string) => Promise<SuiteRun>;

/**
 * The suites this build can score with. A task absent from here has none, and
 * a run of it measures only that the arm called itself done.
 */
export const SUITES: ReadonlyMap<string, Suite> = new Map(
  WEEK_0.map((task) => [task, async (origin, backend) => runSuite(task, origin, backend)]),
);
