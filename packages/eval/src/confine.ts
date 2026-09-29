// What the agent's process may not touch, enforced by the operating system.
//
// A sandbox directory is where the agent is put, not where it is kept. The
// first full matrix proved the difference: the sandbox's `node_modules` was a
// link into this repository, its target gave the repository's path away, and
// agents followed it — one read the hidden suite for the task it was on. So
// the agent now runs under `sandbox-exec` with a profile that denies, to the
// agent and to every process it starts:
//
//   - reading or writing anything in this repository, which holds the hidden
//     suites, the references, `evalkit` and every earlier run's results;
//   - reading another eval run's Claude Code transcript, which would hand one
//     seed the finished answer of the one before it;
//   - `/tmp`, where the first matrix's agents left their own verification
//     scripts for the next seed to find, and any other sandbox, which a run
//     that crashed can leave behind.
//
// Its own sandbox and its own transcript directory stay open, or it could not
// work and the conversation could not be resumed. In a profile the later of two matching rules wins, which is what
// lets that one exception sit after the rule it cuts through.
//
// `sandbox-exec` is macOS only. Elsewhere the harness refuses to run, rather
// than run unconfined: an unconfined run is the one that produced a void
// result, and a flag to allow it would be a flag somebody sets.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { PACKAGE } from './sandbox.ts';

/** The repository, which the agent may neither read nor write. */
export const REPOSITORY: string = resolve(PACKAGE, '../..');

/** Where Claude Code keeps a transcript per working directory. */
export const TRANSCRIPTS: string = join(homedir(), '.claude', 'projects');

/** What every eval sandbox's directory name contains, and so its transcript's. */
const SANDBOX_MARK = 'sheratan-eval-';

/** Scratch space every process on the machine shares, and so every run. */
const SHARED_TMP = '/private/tmp';

/**
 * The CLI's own scratch space inside the shared one: a directory per project,
 * and a git store of files its Bash tool edited, which can hold another
 * session's copies of this repository's files.
 */
function cliScratch(): string {
  return join(SHARED_TMP, `claude-${String(process.getuid?.() ?? '')}`);
}

/** The one program that applies a profile. */
const CONFINER = '/usr/bin/sandbox-exec';

/** What a file the agent must not read is probed with. */
const PROBE = '/bin/cat';

/** The only platform the confiner exists on. */
const MACOS = 'darwin';

/** A command, already wrapped: what `spawn` is handed. */
export interface Confined {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * How Claude Code names the transcript directory for a working directory:
 * the real path with every character that is not a letter or a digit turned
 * into `-`.
 *
 * @example
 * transcriptDirOf('/private/var/T/sheratan-eval-react-a1'); // '<home>/.claude/projects/-private-var-T-sheratan-eval-react-a1'
 */
export function transcriptDirOf(realRoot: string): string {
  return join(TRANSCRIPTS, encoded(realRoot));
}

/** A path as the CLI turns it into one directory name. */
function encoded(path: string): string {
  return path.replaceAll(/[^a-zA-Z0-9]/gu, '-');
}

/** Escapes a path for a profile's string and regex literals. */
function quoted(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/** Escapes a path for use inside a profile regex. */
function literal(path: string): string {
  return quoted(path.replaceAll(/[.*+?^${}()|[\]]/gu, '\\$&'));
}

/**
 * The profile for one sandbox. `realRoot` must be the sandbox's real path,
 * because that is the path its own transcript directory is named after; its
 * parent is the temporary directory every other sandbox is made in.
 *
 * @example
 * const profile = profileFor(await realpath(stage.root));
 */
export function profileFor(realRoot: string): string {
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* (subpath "${quoted(REPOSITORY)}"))`,
    `(deny file-read* (regex #"^${literal(TRANSCRIPTS)}/[^/]*${SANDBOX_MARK}"))`,
    `(deny file-read* file-write* (subpath "${SHARED_TMP}"))`,
    `(deny file-read* file-write* (regex #"^${literal(dirname(realRoot))}/${SANDBOX_MARK}"))`,
    // The exceptions, after the rules they cut through: the later wins. The
    // CLI has to open its scratch directory, or it tries to make it again and
    // stops — which shows the names in it, never what is inside them. It may
    // use its own project's corner, and nothing else there.
    `(allow file-read* (literal "${SHARED_TMP}") (literal "${quoted(cliScratch())}"))`,
    // After every command the Bash tool writes the shell's working directory
    // to a file of its own here, and treats a refusal as the command failing.
    `(allow file-read* file-write* (regex #"^${SHARED_TMP}/claude-[0-9a-f]+-cwd$"))`,
    `(allow file-read* file-write* (subpath "${quoted(join(cliScratch(), encoded(realRoot)))}"))`,
    `(allow file-read* file-write* (subpath "${quoted(transcriptDirOf(realRoot))}"))`,
    `(allow file-read* file-write* (subpath "${quoted(realRoot)}"))`,
  ].join('');
}

/**
 * Wraps a command in the profile.
 *
 * @example
 * const { command, args } = confine('claude', ['-p', prompt], profile);
 */
export function confine(command: string, args: readonly string[], profile: string): Confined {
  return { command: CONFINER, args: ['-p', profile, command, ...args] };
}

/** Whether `path` can be read by a process under `profile`. */
async function readable(path: string, profile: string): Promise<boolean> {
  const wrapped = confine(PROBE, [path], profile);

  return new Promise<boolean>((settle) => {
    const child = spawn(wrapped.command, [...wrapped.args], { stdio: 'ignore' });

    child.on('error', () => settle(false));
    child.on('close', (code) => settle(code === 0));
  });
}

/**
 * Proves the profile holds before any money is spent under it: a file in the
 * repository must be unreadable, and a file in the sandbox readable. Either
 * failure stops the run, with the reason.
 *
 * @example
 * await assertConfined(profile, join(stage.root, 'package.json'));
 */
export async function assertConfined(profile: string, inside: string): Promise<void> {
  if (process.platform !== MACOS) {
    throw new Error(
      `The agent is confined with sandbox-exec, which exists only on macOS; this is ${process.platform}. ` +
        'Run the eval on a Mac. There is deliberately no way to run it unconfined.',
    );
  }

  const [leak, own] = await Promise.all([
    readable(join(REPOSITORY, 'package.json'), profile),
    readable(inside, profile),
  ]);

  if (leak) {
    throw new Error(`The profile does not hold: ${REPOSITORY} is readable from inside it.`);
  }

  if (!own) {
    throw new Error(`The profile is too tight: ${inside} is not readable from inside it.`);
  }
}
