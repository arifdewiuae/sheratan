// The task set, read from the frozen document rather than copied out of it.
//
// EVAL-TASKS says the file changes only by a new version, never in place, and
// every published result names the version it ran against. Copying the twelve
// prompts into TypeScript would make that promise unkeepable by hand: the copy
// and the document would drift, and the run would quote the copy. So the
// prompts are parsed out of the document, and the document is checked first.
//
// What is pinned is §2 onward — the subsets, the task text, the hidden-test
// lists, the brownfield base app, the self-repair sub-eval and the API
// contract. That is the measured surface, and a change to any of it
// invalidates a comparison. §1 is the protocol and the arms, which is harness
// configuration and has legitimately changed once already: the Svelte arm was
// added on 2026-09-17 by a decision logged in TASKS. Pinning the whole file
// would have failed on a change that was right, and that is how a freeze check
// gets switched off.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the frozen document lives. */
export const TASK_SET_FILE: string = resolve(HERE, '../../../Docs/EVAL-TASKS.md');

/** The API contract, given to every arm outside the doc budget (§6). */
export const CONTRACT_FILE: string = join(HERE, '../evalkit/CONTRACT.md');

/** The version every result must name (EVAL-TASKS header). */
export const TASK_SET_VERSION = 'eval-tasks-v1';

/**
 * SHA-256 of §2 onward at the `eval-tasks-v1` tag. Verified byte-identical to
 * the working copy on 2026-09-24, after the whole-file digest recorded in
 * TASKS was found not to match: two post-freeze commits had touched the title
 * and the §1.2 arms table, and nothing else.
 */
export const MEASURED_DIGEST = '9302b88a03689a51c32fe8b94767127495a16234479a0a70d73cd0cb23f37376';

/** Where the measured surface starts. Everything above it is configuration. */
const MEASURED_FROM = '## 2.';

/** The three tasks the Week 0 kill-gate is ruled on (§2). */
export const WEEK_ZERO: readonly string[] = ['T01', 'T03', 'T04'];

/** One task, as the document defines it. */
export interface Task {
  /** `T01`, `T03`, … */
  readonly id: string;
  readonly title: string;
  /** `parity`, `differentiator`, `greenfield`, `brownfield`, … (§1.6). */
  readonly tags: readonly string[];
  /** The verbatim text the agent receives (§3). */
  readonly prompt: string;
  /** What the hidden suite must assert. Never shown to an agent. */
  readonly hidden: readonly string[];
}

const HEADING = /^### (T\d+) — (.+)$/u;
const TAGS = /`([^`]+)`/gu;
const QUOTED = /^> ?/u;
const BULLET = /^- /u;

/** Everything from §2 on: the part a result depends on. */
function measured(document: string): string {
  const at = document.indexOf(`\n${MEASURED_FROM}`);

  if (at === -1) throw new Error(`${TASK_SET_FILE} has no "${MEASURED_FROM}" section.`);

  return document.slice(at + 1);
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface Block {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

/** Splits the document into one block per task heading. */
function blocks(document: string): Block[] {
  const found: Block[] = [];

  let open: { id: string; title: string; lines: string[] } | undefined = undefined;

  for (const line of document.split('\n')) {
    const heading = HEADING.exec(line);

    if (heading === null) {
      open?.lines.push(line);
      continue;
    }

    if (open !== undefined) found.push(open);

    open = { id: heading[1] as string, title: heading[2] as string, lines: [] };
  }

  if (open !== undefined) found.push(open);

  return found;
}

function taskOf(block: Block): Task {
  const prompt: string[] = [];
  const hidden: string[] = [];

  let inHidden = false;

  for (const line of block.lines) {
    if (line.startsWith('Hidden tests:')) inHidden = true;
    else if (line.startsWith('>')) prompt.push(line.replace(QUOTED, ''));
    else if (inHidden && line.startsWith('- ')) hidden.push(line.replace(BULLET, ''));
  }

  const tagLine = block.lines.find((line) => line.startsWith('`')) ?? '';

  return {
    id: block.id,
    title: block.title,
    tags: [...tagLine.matchAll(TAGS)].map((match) => match[1] as string),
    prompt: prompt.join('\n').trim(),
    hidden,
  };
}

/** The twelve tasks, by id, and the version they came from. */
export interface TaskSet {
  readonly version: string;
  readonly digest: string;
  readonly tasks: ReadonlyMap<string, Task>;
}

/**
 * Reads the frozen task set, and refuses if the measured surface has moved.
 * A run against a changed task set is not comparable with one against the
 * original, and the failure names the digest it wanted (A2, A3).
 *
 * @example
 * const set = await readTaskSet();
 * const t01 = set.tasks.get('T01');
 */
export async function readTaskSet(): Promise<TaskSet> {
  const document = await readFile(TASK_SET_FILE, 'utf8');
  const digest = digestOf(measured(document));

  if (digest !== MEASURED_DIGEST) {
    throw new Error(
      `${TASK_SET_FILE} has changed below "${MEASURED_FROM}": it hashes to ${digest}, ` +
        `not the ${TASK_SET_VERSION} digest ${MEASURED_DIGEST}. A task set changes by a new ` +
        `version, never in place — publish it as v2 and record the new digest, or restore the file.`,
    );
  }

  const tasks = blocks(document).map(taskOf);

  return {
    version: TASK_SET_VERSION,
    digest,
    tasks: new Map(tasks.map((task) => [task.id, task])),
  };
}

/** Looks one task up, and says which there were if it is not there. */
export function taskNamed(set: TaskSet, id: string): Task {
  const found = set.tasks.get(id);

  if (found === undefined) {
    throw new Error(`No task \`${id}\`; ${set.version} has ${[...set.tasks.keys()].join(', ')}.`);
  }

  return found;
}
