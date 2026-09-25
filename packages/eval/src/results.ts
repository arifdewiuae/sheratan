// Where a run's logs go, and what its directory is called.
//
// One function, in one place, because two scripts name directories and a
// results tree where half the names sort by date and half do not is a tree
// nobody can find the newest run in.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { PACKAGE } from './sandbox.ts';

/** Where the results tree is, so a caller can name a directory inside it. */
export const RESULTS: string = join(PACKAGE, 'results');

/** How long an ISO timestamp is once the seconds are in and the zone is out. */
const TO_SECONDS = 19;

/** A run's directory: when it started, and what it was. */
export interface Into {
  /** The timestamp the directory is named for, as it goes in `summary.json`. */
  readonly stamp: string;
  /** The directory itself, created and ready to be written into. */
  readonly into: string;
}

/**
 * Makes a results directory named for now and, if it is given one, for what
 * the run was; returns both halves. Colons are stripped because a path
 * carrying them is not portable.
 *
 * @example
 * const { stamp, into } = await stampedInto('T01-sheratan');
 */
export async function stampedInto(what: string): Promise<Into> {
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, TO_SECONDS);
  const into = join(RESULTS, what === '' ? stamp : `${stamp}-${what}`);

  await mkdir(into, { recursive: true });

  return { stamp, into };
}
