// A correct implementation of the Week 0 tasks, per arm, so the hidden suites
// can be proved before they are allowed to score anything.
//
// A reference is an `Arm` whose `scaffold` writes a finished app instead of an
// empty one. Everything else — the proxy, `evalkit`, the one origin, the clean
// commands — is the arm's own, so a suite proved this way is proved against
// the stage a real run uses rather than against a fixture of it.
//
// **None of these belong in `ARMS`.** A reference contains the `data-testid`
// hooks the tasks name, and the contamination gate runs over every registered
// arm: registering one would hand an agent the answer, and the gate would say
// so. They are looked up here, by the proof script and by nothing else.

import { cp, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { Arm } from './arm.ts';
import { sheratanArm } from './arms/sheratan.ts';
import type { Mutation } from './mutations.ts';
import { HOSTS, PACKAGE } from './sandbox.ts';
import { applyPatches, writeTree } from './tree.ts';

/** What `hosts/` lacks to be a page: an entry, a shell and a real adapter. */
const SHERATAN_SHELL = join(PACKAGE, 'references', 'sheratan');

/** How a reference arm's id reads in a sandbox path and a failure. */
const SUFFIX = '-reference';

/**
 * The arm, with a finished app in place of the scaffold. `app` is copied
 * first and `shell` over it, so the shell owns any file it names and the app
 * is otherwise untouched — which is what keeps `hosts/` byte-identical to the
 * tree the self-repair eval measured.
 */
export function referenceOf(base: Arm, app: string, shell: string): Arm {
  return {
    ...base,
    id: `${base.id}${SUFFIX}`,
    label: `${base.label} (reference)`,
    // It gates nothing: it is the instrument being calibrated, not a result.
    gates: false,

    async scaffold(root: string): Promise<void> {
      await cp(app, root, { recursive: true });
      await cp(shell, root, { recursive: true });
      await symlink(join(PACKAGE, 'node_modules'), join(root, 'node_modules'), 'dir');
    },
  };
}

/** The reference app for each arm that has one, by the id of the arm itself. */
export const REFERENCES: ReadonlyMap<string, Arm> = new Map([
  [sheratanArm.id, referenceOf(sheratanArm, HOSTS, SHERATAN_SHELL)],
]);

/** Reads, patches and writes back only the files a mutation names. */
async function breakIt(root: string, mutation: Mutation): Promise<void> {
  const paths = [...new Set(mutation.patches.map((one) => one.file))];

  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      text: await readFile(join(root, ...path.split('/')), 'utf8'),
    })),
  );

  await writeTree(root, applyPatches(files, mutation.id, mutation.patches));
}

/**
 * The same reference with one thing deliberately wrong with it, for proving
 * that a suite would notice (see `mutations.ts`).
 *
 * @example
 * const arm = mutatedOf(armNamed(REFERENCES, 'sheratan'), mutation);
 */
export function mutatedOf(reference: Arm, mutation: Mutation): Arm {
  return {
    ...reference,
    id: `${reference.id}-${mutation.id}`,
    label: `${reference.label} — ${mutation.summary}`,

    async scaffold(root: string): Promise<void> {
      await reference.scaffold(root);
      await breakIt(root, mutation);
    },
  };
}
