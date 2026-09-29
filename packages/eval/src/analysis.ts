// The arithmetic the Week 0 gate is decided with, kept apart from the runs it
// is decided about.
//
// It lives here, and not in the script that spends the money, for one reason:
// a matrix costs tens of dollars and hours, and the sums that turn it into a
// verdict have to be provable for nothing. `test/analysis.test.ts` does that.
//
// Two decisions are made here rather than left to whoever reads the table.
//
// **A run that reached the cap counts as the cap.** EVAL-TASKS §1.4 step 4
// says not converging is a recorded outcome, and the recording has to reach
// the number. Dropping those runs and taking the median of what is left would
// reward the arm that fails more often: an arm converging twice in five seeds,
// quickly, would read better than one converging five times out of five. So
// the sample is censored at the cap — "ten or more" enters the median as ten,
// which understates the gap rather than inventing one — and the single
// criterion the gate states is then enough on its own.
//
// **A voided run is not a slow run.** Tampering means the arm reached for a
// test-only surface, and §1.3 voids it; it is excluded, counted, and named,
// because a seed missing from a median is something a reader must be told.

/** One task, one arm, one seed: everything the verdict reads. */
export interface Cell {
  readonly task: string;
  readonly arm: string;
  readonly seed: number;
  readonly converged: boolean;
  /** Iterations used. At the cap without converging, this is the cap. */
  readonly iterations: number;
  readonly costUSD: number;
  readonly durationMs: number;
  /** Non-empty voids the run (EVAL-TASKS §1.3). */
  readonly tampering: readonly string[];
}

/** What §1.4 step 5 asks a task-arm pair to be reported as. */
export interface Spread {
  readonly median: number;
  readonly q1: number;
  readonly q3: number;
  readonly iqr: number;
}

const QUARTER = 0.25;
const HALF = 0.5;
const THREE_QUARTERS = 0.75;

/**
 * The type-7 quantile: R's default, numpy's default and Excel's `PERCENTILE`.
 * Named rather than hand-rolled to taste, because "the median of five" is
 * unambiguous and the quartiles of five are not — and an IQR nobody can
 * reproduce is an IQR nobody should believe.
 *
 * @example
 * quantileOf([1, 2, 3, 4, 5], 0.25); // 2
 */
export function quantileOf(sorted: readonly number[], p: number): number {
  const last = sorted.length - 1;
  const at = p * last;
  const below = Math.floor(at);
  const low = sorted[below];
  const high = sorted[Math.ceil(at)];

  if (low === undefined || high === undefined) {
    throw new Error('quantileOf was given no values; a spread of nothing is not zero.');
  }

  return low + (high - low) * (at - below);
}

/**
 * Median and interquartile range over a sample, in the order §1.4 asks for.
 *
 * @example
 * spreadOf([2, 3, 3, 4, 10]).median; // 3
 */
export function spreadOf(values: readonly number[]): Spread {
  const sorted = [...values].toSorted((a, b) => a - b);
  const q1 = quantileOf(sorted, QUARTER);
  const q3 = quantileOf(sorted, THREE_QUARTERS);

  return { median: quantileOf(sorted, HALF), q1, q3, iqr: q3 - q1 };
}

/** What one arm did on one task, once the void runs are set aside. */
export interface ArmResult {
  readonly arm: string;
  /** Runs that count. */
  readonly scored: number;
  /** Runs that reached for a test-only surface and were excluded. */
  readonly voided: number;
  readonly converged: number;
  /** Every scored run's iterations, censored at the cap, sorted. */
  readonly iterations: readonly number[];
  readonly spread: Spread;
  readonly costUSD: number;
}

/** One arm's scored runs on one task, or nothing if it has none. */
export function resultFor(cells: readonly Cell[], arm: string): ArmResult | undefined {
  const mine = cells.filter((cell) => cell.arm === arm);
  const scored = mine.filter((cell) => cell.tampering.length === 0);

  if (scored.length === 0) return undefined;

  const iterations = scored.map((cell) => cell.iterations).toSorted((a, b) => a - b);

  return {
    arm,
    scored: scored.length,
    voided: mine.length - scored.length,
    converged: scored.filter((cell) => cell.converged).length,
    iterations,
    spread: spreadOf(iterations),
    // Every run, void included: money spent is money spent.
    costUSD: mine.reduce((sum, cell) => sum + cell.costUSD, 0),
  };
}

/** One task, both arms, and which way it fell. */
export interface TaskResult {
  readonly task: string;
  readonly subject: ArmResult | undefined;
  readonly control: ArmResult | undefined;
  /** Whether the subject's median is no worse than the control's. */
  readonly noWorse: boolean;
}

/** The two arms a comparison is between, named by the caller (see `arm.ts`). */
export interface Pair {
  /** The arm on trial. */
  readonly subject: string;
  /** The arm it has to be no worse than. */
  readonly control: string;
}

/**
 * One task's verdict. A task missing either arm's runs is not a pass: an
 * unmeasured comparison is unmeasured, and reading it as a tie is how a gate
 * gets met by a cell that never ran.
 */
export function taskResultOf(task: string, cells: readonly Cell[], pair: Pair): TaskResult {
  const mine = cells.filter((cell) => cell.task === task);
  const subject = resultFor(mine, pair.subject);
  const control = resultFor(mine, pair.control);

  const noWorse =
    subject !== undefined &&
    control !== undefined &&
    subject.spread.median <= control.spread.median;

  return { task, subject, control, noWorse };
}

/** What the Week 0 gate came to. */
export interface Verdict {
  readonly tasks: readonly TaskResult[];
  /** How many tasks the subject was no worse on. */
  readonly noWorse: number;
  /** How many it had to be (EVAL §2.3). */
  readonly needed: number;
  readonly met: boolean;
}

/**
 * The gate: median iterations no worse than the control on at least `needed`
 * tasks (EVAL §2.3, TASKS Week 0). Every task the matrix covers is judged,
 * including the ones with a missing arm, so the count it reports is out of
 * what was asked for rather than out of what came back.
 *
 * @example
 * verdictOf(['T01', 'T03', 'T04'], cells, { subject: 'sheratan', control: 'react' }, 3);
 */
export function verdictOf(
  tasks: readonly string[],
  cells: readonly Cell[],
  pair: Pair,
  needed: number,
): Verdict {
  const results = tasks.map((task) => taskResultOf(task, cells, pair));
  const noWorse = results.filter((result) => result.noWorse).length;

  return { tasks: results, noWorse, needed, met: noWorse >= needed };
}
