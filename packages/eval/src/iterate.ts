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

/** Where a run is, as `onStep` reports it. */
export const Phase = { Working: 'working', Judging: 'judging', Judged: 'judged' } as const;
/** One of `Phase`'s values. */
export type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * One moment in a run, for a watcher. Nothing in it reaches the agent: it is
 * the harness talking to whoever is waiting on a cell that takes minutes.
 */
export interface Step {
  readonly phase: Phase;
  /** The iteration this step belongs to, 1-based. */
  readonly n: number;
  readonly cap: number;
  /** What the session has cost so far. */
  readonly spentUSD: number;
  /** Set once the iteration is judged. */
  readonly result?: Pick<Iteration, 'pass' | 'clean' | 'suite'>;
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
  /** Told at each turn and each verdict, so a watcher sees more than the end. */
  onStep?(step: Step): void;
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
  const cap = options.cap ?? ITERATION_CAP;

  options.onStep?.({ phase: Phase.Judging, n, cap, spentUSD: options.session.spent() });

  const clean = await options.judge.clean();
  const suite = await options.judge.suite();
  const iteration = { n, clean, suite, pass: clean.ok && suite.ok, reply };

  options.onStep?.({
    phase: Phase.Judged,
    n,
    cap,
    spentUSD: options.session.spent(),
    result: iteration,
  });

  return iteration;
}

/** Says `message` to the agent, telling the watcher that iteration `n` has begun. */
function turn(options: IterateOptions, n: number, message: string): Promise<Reply> {
  const cap = options.cap ?? ITERATION_CAP;

  options.onStep?.({ phase: Phase.Working, n, cap, spentUSD: options.session.spent() });

  return options.session.say(message);
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

  let reply = await turn(options, 1, options.prompt);

  for (let n = 1; n <= cap; n++) {
    // eslint-disable-next-line no-await-in-loop -- an iteration is defined by the one before it
    const iteration = await judge(options, n, reply);

    log.push(iteration);

    if (iteration.pass || n === cap) break;

    // eslint-disable-next-line no-await-in-loop -- the agent is resumed, not restarted
    reply = await turn(options, n + 1, feedbackFor(iteration.clean, iteration.suite));
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
