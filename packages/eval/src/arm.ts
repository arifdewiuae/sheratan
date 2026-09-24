// What the harness needs to know about one stack to run a task against it
// (EVAL-TASKS §1.2). An arm is a record, not a branch: nothing downstream of
// here asks which arm it is holding, which is what keeps the neutrality rule
// in §1.1 true in the harness as well as in the suites.
//
// The ids below are the agent-authoring arms EVAL §2.1 settles on. They are
// not a closed world — `id` is a string, and adding an arm is a directory and
// a row here. Vue is deliberately not one of them: it sits between React and
// Svelte on every dimension, so it stays in the size and performance
// comparisons, where it costs nothing, and out of this one, where an arm has
// to earn its place by what it can falsify.

/**
 * One command. Every command runs with the sandbox as its working directory
 * and `node_modules/.bin` on PATH, so an arm names its tools the way its own
 * package scripts do — `sheratan check .`, `eslint .` — and no arm needs to
 * know where the harness put it.
 */
export interface Command {
  readonly run: string;
  readonly args: readonly string[];
}

/** A stack the eval can put an agent in front of. */
export interface Arm {
  /** `sheratan`, `react`, … — the name in every log row and results path. */
  readonly id: string;
  /** How it reads in a report. */
  readonly label: string;
  /** Whether a result from this arm moves a gate (EVAL §2.1). */
  readonly gates: boolean;
  /** The documentation the agent is given, within the §1.5 token budget. */
  readonly docs: string;
  /** Writes a fresh, empty-of-task app into `root`. */
  scaffold(root: string): Promise<void>;
  /** Serves the app on `port`. The harness owns the process, not the agent. */
  serving(port: number): Command;
  /** Every command that must exit 0 before the arm counts as clean. */
  readonly clean: readonly Command[];
}

/** The arms this build knows, by id. */
export type Arms = ReadonlyMap<string, Arm>;

/**
 * Looks an arm up, and says what there was if it is not there. A typo in
 * `--arm` must not silently run the wrong stack and report a number for it.
 */
export function armNamed(arms: Arms, id: string): Arm {
  const found = arms.get(id);

  if (found === undefined) {
    throw new Error(`No arm \`${id}\`; this build has ${[...arms.keys()].join(', ')}.`);
  }

  return found;
}
