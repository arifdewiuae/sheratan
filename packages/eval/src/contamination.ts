// The one thing an arm may not be handed: the answer.
//
// EVAL-TASKS §1.1 keeps the hidden suites framework-neutral and §1.5 caps what
// each arm is told, but neither says the documentation must not contain a
// worked solution to a task. It did not need saying, until it turned out to:
// `llms.txt` §7 was a complete T01 down to all four of its `data-testid`
// hooks, and its orders example carried three of T04's. The `create` template
// had been moved to a neutral domain for exactly this reason (TASKS, Week 3);
// the document the arm is actually handed was never checked the same way.
//
// What this catches is the mechanical form. A task names its DOM hooks in the
// prompt, so a document that spells one was written from the task. That is
// necessary and not sufficient — the same example with the hooks renamed is
// still the answer — which is why the fix is a neutral domain, and this is
// only what stops it coming back.
//
// `hosts/` is deliberately not checked. The self-repair host app implements
// T01, T03 and T04 on purpose, and no agent is ever shown it.

import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import type { Arm } from './arm.ts';
import type { Task } from './frozen.ts';

/** How §3 names a task's DOM hooks, and how a view spells one. */
const HOOK = /data-testid="([^"]+)"/gu;

/** Nothing under these is handed to anyone: a link tree, or a previous build. */
const NOT_GIVEN: ReadonlySet<string> = new Set(['node_modules', 'dist', '.git']);

/** One thing an arm is handed, and what to call it in a failure. */
export interface Given {
  readonly what: string;
  readonly text: string;
}

/** A task's hook, found somewhere the arm can read it. */
export interface Leak {
  readonly task: string;
  readonly hook: string;
  readonly what: string;
}

/**
 * The DOM hooks one task names in its prompt (EVAL-TASKS §3).
 *
 * @example
 * hooksOf(taskNamed(set, 'T01')); // ['customer-row', 'loading', 'error', 'retry']
 */
export function hooksOf(task: Task): readonly string[] {
  return [...task.prompt.matchAll(HOOK)].map((match) => match[1] as string);
}

/** Every place one task's hooks turn up in what an arm is handed. */
function leaksFor(task: Task, given: readonly Given[]): Leak[] {
  const found: Leak[] = [];

  for (const hook of hooksOf(task)) {
    const carrying = given.filter((one) => one.text.includes(`data-testid="${hook}"`));

    found.push(...carrying.map((one) => ({ task: task.id, hook, what: one.what })));
  }

  return found;
}

/**
 * Every task hook that appears in anything an arm is handed. Empty is the
 * only acceptable result: a hook in an arm's own documentation means that
 * arm's run of that task measures recall of the document, not authoring.
 *
 * @example
 * const leaks = leaksIn(await givenTo(arm, dir), set.tasks.values());
 */
export function leaksIn(given: readonly Given[], tasks: Iterable<Task>): readonly Leak[] {
  return [...tasks].flatMap((task) => leaksFor(task, given));
}

/** Every file under `root`, skipping what no scaffold hands anyone. */
async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });

  const found = await Promise.all(
    entries.map(async (entry) => {
      if (NOT_GIVEN.has(entry.name)) return [];

      const path = join(root, entry.name);

      if (entry.isDirectory()) return filesUnder(path);

      return entry.isFile() ? [path] : [];
    }),
  );

  return found.flat();
}

/**
 * Everything an arm hands an agent: the budgeted documentation, and every
 * file of the scaffold the agent starts in. `into` is the caller's to remove.
 *
 * @example
 * await using dir = await scratch();
 * const given = await givenTo(sheratanArm, dir.path);
 */
export async function givenTo(arm: Arm, into: string): Promise<readonly Given[]> {
  await arm.scaffold(into);

  const paths = await filesUnder(into);

  const scaffold = await Promise.all(
    paths.map(async (path) => ({
      what: `${arm.id} scaffold — ${relative(into, path)}`,
      text: await readFile(path, 'utf8'),
    })),
  );

  const docs = await readFile(arm.docs, 'utf8');

  return [{ what: `${arm.id} docs — ${basename(arm.docs)}`, text: docs }, ...scaffold];
}

/** How a leak reads in a failure: what it was, and where it was found. */
export function describe(leaks: readonly Leak[]): string {
  return leaks
    .map((leak) => `  ${leak.task} names data-testid="${leak.hook}" — found in ${leak.what}`)
    .join('\n');
}
