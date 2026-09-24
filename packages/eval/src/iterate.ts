// EVAL-TASKS §1.4, and nothing else.
//
//   1. The agent works with a shell and file edits.
//   2. When it declares the task done, the harness runs the hidden suite and
//      the arm's clean commands. That is one iteration.
//   3. On failure it is given the full checker output and the names of the
//      failing tests — never their bodies.
//   4. Cap ten. Not converging is a recorded outcome, not a discarded run.
//
// The suite and the clean commands arrive as a `Judge`, so what is scored is
// injected rather than reached for. That is what lets the protocol be proved
// against a fake arm, for nothing, instead of against a model, for money.

import type { Reply, Session } from './session.ts';

/** EVAL-TASKS §1.4: ten, and it is enforced rather than hoped for. */
export const ITERATION_CAP = 10;

/** What the hidden suite said. Only `failing` is ever shown to the agent. */
export interface SuiteRun {
  readonly ok: boolean;
  /** Test names, never bodies (§1.4 step 3). */
  readonly failing: readonly string[];
  /** Kept for the raw log. The agent does not see this. */
  readonly raw: string;
}

/** What the arm's clean commands said. The agent sees all of this. */
export interface CleanRun {
  readonly ok: boolean;
  readonly output: string;
}

/** The two things a declared-done app is judged on. */
export interface Judge {
  clean(): Promise<CleanRun>;
  suite(): Promise<SuiteRun>;
}

/** One pass through step 2. */
export interface Iteration {
  /** 1-based, so "converged in 3" reads as it sounds. */
  readonly n: number;
  readonly clean: CleanRun;
  readonly suite: SuiteRun;
  readonly pass: boolean;
  readonly reply: Reply;
}

/** What one task, one arm, one seed produced. */
export interface TaskRun {
  readonly converged: boolean;
  /** Iterations used. At the cap without converging, this is the cap. */
  readonly iterations: number;
  readonly log: readonly Iteration[];
  readonly costUSD: number;
  readonly durationMs: number;
  /** Non-empty means the arm reached for a test-only surface; the run is void. */
  readonly tampering: readonly string[];
}

/** What one run is given. */
export interface IterateOptions {
  readonly session: Session;
  readonly judge: Judge;
  /** The verbatim task text (EVAL-TASKS §3). */
  readonly prompt: string;
  readonly cap?: number;
  /** Asked after every iteration, so a run that cheated is caught as it happens. */
  tampering?(): readonly string[];
}

const DONE = 'Tell me when it is done.';

function namesOf(failing: readonly string[]): string {
  return failing.map((name) => `- ${name}`).join('\n');
}

/**
 * What the agent is told after a failed iteration. The asymmetry is the
 * point: the checker speaks in full, because a machine-readable remedy is
 * what SPEC A3 claims; the suite gives names only, because an agent that
 * could read the assertions would be writing to the test.
 */
export function feedbackFor(clean: CleanRun, suite: SuiteRun): string {
  const parts: string[] = ['Not done yet.'];

  if (!clean.ok) parts.push(`The project is not clean:\n\n${clean.output.trim()}`);

  if (!suite.ok) {
    parts.push(
      suite.failing.length === 0
        ? 'The behaviour tests failed, and none of them reported a name.'
        : `These behaviour tests are failing:\n\n${namesOf(suite.failing)}`,
    );
  }

  parts.push(DONE);

  return parts.join('\n\n');
}

async function judge(options: IterateOptions, n: number, reply: Reply): Promise<Iteration> {
  const clean = await options.judge.clean();
  const suite = await options.judge.suite();

  return { n, clean, suite, pass: clean.ok && suite.ok, reply };
}

/**
 * Runs one task to convergence or to the cap, and returns what happened
 * either way.
 *
 * @example
 * const run = await iterate({ session, judge, prompt: task.prompt });
 * if (!run.converged) console.log(`gave up after ${run.iterations}`);
 */
export async function iterate(options: IterateOptions): Promise<TaskRun> {
  const cap = options.cap ?? ITERATION_CAP;
  const started = Date.now();
  const log: Iteration[] = [];

  let reply = await options.session.say(options.prompt);

  for (let n = 1; n <= cap; n++) {
    // eslint-disable-next-line no-await-in-loop -- an iteration is defined by the one before it
    const iteration = await judge(options, n, reply);

    log.push(iteration);

    if (iteration.pass || n === cap) break;

    // eslint-disable-next-line no-await-in-loop -- the agent is resumed, not restarted
    reply = await options.session.say(feedbackFor(iteration.clean, iteration.suite));
  }

  const last = log.at(-1);

  return {
    converged: last?.pass ?? false,
    iterations: log.length,
    log,
    costUSD: options.session.spent(),
    durationMs: Date.now() - started,
    tampering: options.tampering?.() ?? [],
  };
}
