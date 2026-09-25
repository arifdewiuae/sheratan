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
import { join, sep } from 'node:path';

import type { Arm } from './arm.ts';
import { CONTROL_APP, reactArm } from './arms/react.ts';
import { sheratanArm } from './arms/sheratan.ts';
import type { Mutation } from './mutations.ts';
import { HOSTS, PACKAGE } from './sandbox.ts';
import { applyPatches, writeTree } from './tree.ts';

/** Where a reference tree lives, by arm. */
const REFERENCE = (arm: string): string => join(PACKAGE, 'references', arm);

/** What `hosts/` lacks to be a page: an entry, a shell and a real adapter. */
const SHERATAN_SHELL = REFERENCE('sheratan');

/** How a reference arm's id reads in a sandbox path and a failure. */
const SUFFIX = '-reference';

/**
 * What no reference carries into a sandbox. A reference borrows an installed
 * tree through one symlink, so a copy of one — which a developer's own link
 * in the checkout would be — arrives at the path that symlink wants.
 */
const INSTALL_DIR = 'node_modules';

/** Whether `cp` should carry this path into the sandbox. */
function copied(from: string): boolean {
  return !from.split(sep).includes(INSTALL_DIR);
}

/** What one arm's reference is made of. */
export interface Layers {
  /**
   * The trees laid down, in order, each over the last — so a later one owns
   * any file it names and the earlier ones are otherwise untouched. That is
   * what keeps `hosts/` byte-identical to the tree the self-repair eval
   * measured: the shell beside it adds a page without editing one.
   */
  readonly trees: readonly string[];
  /** The installed tree a sandbox borrows, as the arm's own scaffold borrows it. */
  readonly modules: string;
}

/** The arm, with a finished app in place of the scaffold. */
export function referenceOf(base: Arm, layers: Layers): Arm {
  return {
    ...base,
    id: `${base.id}${SUFFIX}`,
    label: `${base.label} (reference)`,
    // It gates nothing: it is the instrument being calibrated, not a result.
    gates: false,

    async scaffold(root: string): Promise<void> {
      for (const tree of layers.trees) {
        // eslint-disable-next-line no-await-in-loop -- in order: a later tree overwrites an earlier one
        await cp(tree, root, { recursive: true, filter: copied });
      }

      await symlink(layers.modules, join(root, 'node_modules'), 'dir');
    },
  };
}

/** Every reference, as the arm it is built from and the layers that build it. */
const BUILT: readonly (readonly [Arm, Layers])[] = [
  [sheratanArm, { trees: [HOSTS, SHERATAN_SHELL], modules: join(PACKAGE, 'node_modules') }],
  [reactArm, { trees: [REFERENCE('react')], modules: join(CONTROL_APP, 'node_modules') }],
];

/** The reference app for each arm that has one, by the id of the arm itself. */
export const REFERENCES: ReadonlyMap<string, Arm> = new Map(
  BUILT.map(([arm, layers]) => [arm.id, referenceOf(arm, layers)]),
);

/**
 * The installed tree each reference borrows, so a caller can say whether it is
 * there before standing a stage on it.
 *
 * React's is `controls/react`'s, not this package's: it is a React app and this
 * package has no React in it. That tree is installed once, by hand, which is
 * the same arrangement `src/arms/react.ts` uses and the reason a proof can
 * find itself with nothing to run against.
 */
export const INSTALLED: ReadonlyMap<string, string> = new Map(
  BUILT.map(([arm, layers]) => [arm.id, layers.modules]),
);

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
