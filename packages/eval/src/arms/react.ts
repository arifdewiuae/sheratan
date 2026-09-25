// The control arm: Vite + React 19 + TanStack Query v5 + Zustand, which is
// what EVAL-TASKS §1.2 names. It is the arm with the training-data advantage
// the claim is made against, so it is the one that has to be built well — a
// control poorer than the thing it controls for is the strawman objection,
// pre-made.
//
// The app it scaffolds is a like-for-like port of the `sheratan create`
// template: same two modules, same fixture, same contract seam, same device
// telemetry domain. That last one is not decoration. The template was moved
// off customers and orders so the Sheratan arm would not be handed a worked
// answer to T01/T03/T04, and the control inherits that protection only by
// being the same app — `contamination.ts` checks both.
//
// Nothing here installs anything. `controls/react` is installed once by hand
// (`pnpm install --ignore-workspace`), and a sandbox borrows that tree through
// a symlink, so thirty runs cannot drift from one another or from the
// committed lockfile.

import { cp, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Arm, Command } from '../arm.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed control app, and its own pnpm root. */
export const CONTROL_APP: string = resolve(HERE, '../../controls/react');

/** The agent's whole documentation budget for this arm (EVAL-TASKS §1.5). */
export const REACT_DOCS: string = join(CONTROL_APP, 'DOCS.md');

/**
 * What a sandbox does not get. `node_modules` is symlinked rather than copied,
 * and the documentation reaches the agent through the system prompt within the
 * §1.5 budget — a copy of it in the working directory would be a second one.
 */
const NOT_COPIED: ReadonlySet<string> = new Set(['node_modules', 'DOCS.md', 'dist']);

/** Whether `cp` should carry this path into the sandbox. */
function copied(from: string): boolean {
  // Empty for the root itself, which `cp` asks about first and must get.
  const [first = ''] = relative(CONTROL_APP, from).split(sep);

  return first === '' || !NOT_COPIED.has(first);
}

/**
 * The control arm. `clean` is exactly the two commands §1.2's table names and
 * nothing more: the app ships a `test` script too, but the table does not name
 * it, and an arm judged on more than the protocol says is an arm judged
 * unfairly.
 */
export const reactArm: Arm = {
  id: 'react',
  label: 'React 19 + TanStack Query + Zustand',
  gates: true,
  docs: REACT_DOCS,

  async scaffold(root: string): Promise<void> {
    await cp(CONTROL_APP, root, { recursive: true, filter: copied });

    // The installed tree, borrowed. A dangling link when the control has not
    // been installed is deliberate: `pnpm check` scaffolds every arm for the
    // contamination gate, and CI has no React in it.
    await symlink(join(CONTROL_APP, 'node_modules'), join(root, 'node_modules'), 'dir');
  },

  serving(port: number): Command {
    // `--strictPort` so the harness's port is the one it gets, and HMR is off
    // in `vite.config.ts` — the parity match for the Sheratan arm's
    // `--no-reload`.
    return { run: 'vite', args: ['--host', '127.0.0.1', '--port', String(port), '--strictPort'] };
  },

  clean: [
    { run: 'eslint', args: ['.'] },
    { run: 'tsc', args: ['--noEmit'] },
  ],
};
