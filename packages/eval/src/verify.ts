// The verdict on one run. Both halves have to hold: the structure is legal
// again, and the app still does what its task said (EVAL-TASKS §5).

import { runtimeCycles } from './cycles.ts';
import { detect } from './detect.ts';
import type { Finding } from './rules.ts';
import { addSuite, runTests } from './sandbox.ts';
import { readTree } from './tree.ts';
import { join } from 'node:path';

/** What a run is scored on. */
export interface Verdict {
  readonly repaired: boolean;
  readonly behaviourKept: boolean;
  readonly pass: boolean;
  readonly remaining: readonly Finding[];
  /** Not scored: see cycles.ts. Reported so the hole is visible, not hidden. */
  readonly cycles: readonly string[];
  readonly testOutput: string;
}

/**
 * Reads back whatever the agent left in the sandbox and judges it. The hidden
 * suite is copied in only now, so the turn could not have been run against it.
 */
export async function verify(root: string): Promise<Verdict> {
  const files = await readTree(join(root, 'hosts'));
  const remaining = detect(files);

  await addSuite(root);

  const run = await runTests(root);
  const repaired = remaining.length === 0;

  return {
    repaired,
    behaviourKept: run.ok,
    pass: repaired && run.ok,
    remaining,
    cycles: runtimeCycles(files),
    testOutput: run.output,
  };
}
