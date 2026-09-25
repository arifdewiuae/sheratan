// The Sheratan arm: `sheratan create` output, which is what EVAL-TASKS §1.2
// names. Not an approximation of it, and not a hand-kept copy — the arm calls
// the same function the shipped command calls, so an arm that drifts from the
// product is not a thing that can happen.

import { symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldApp } from '../../../cli/src/scaffold.ts';
import type { Arm, Command } from '../arm.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** This package, whose `node_modules` a sandbox borrows. */
const PACKAGE = resolve(HERE, '../..');

/** The repository root, which is where `llms.txt` lives. */
const REPOSITORY = resolve(PACKAGE, '../..');

/** The name every scaffolded app in a run gets. It is never published. */
const APP_NAME = 'eval-app';

/**
 * The agent's whole documentation budget (EVAL-TASKS §1.5), and the one file
 * it is. SPEC §10 caps `llms.txt` at the same 10,000 tokens `DOC_BUDGET`
 * holds, which is not a coincidence — the budget is what the framework
 * promises an agent. `budget.ts` counts this file before every run.
 */
export const SHERATAN_DOCS: string = join(REPOSITORY, 'llms.txt');

/**
 * The framework's own arm. Everything it does is what a user gets: the
 * scaffold the command writes, the dev server the command serves, and the
 * checker the command runs.
 */
export const sheratanArm: Arm = {
  id: 'sheratan',
  label: 'Sheratan',
  gates: true,
  docs: SHERATAN_DOCS,

  async scaffold(root: string): Promise<void> {
    await scaffoldApp({ root, name: APP_NAME });

    // A published install would resolve `sheratan` from the registry. Here it
    // resolves to the workspace build, which is the point: the arm runs the
    // runtime in this commit, not the one that happened to be released.
    await symlink(join(PACKAGE, 'node_modules'), join(root, 'node_modules'), 'dir');
  },

  serving(port: number): Command {
    // `--no-reload` is not a convenience: a reload landing mid-assertion is
    // how a dev server turns a suite flaky.
    return { run: 'sheratan', args: ['dev', '.', '--port', String(port), '--no-reload'] };
  },

  // Exactly what §1.2 says clean means for this arm, and nothing more. The
  // template ships a lint config too, but the table does not name it, and an
  // arm judged on more than the protocol says is an arm judged unfairly.
  clean: [{ run: 'sheratan', args: ['check', '.'] }],
};
