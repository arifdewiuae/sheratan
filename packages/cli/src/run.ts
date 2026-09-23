// `sheratan`, the one interface (SPEC §10). The command is a thin wrapper:
// it parses arguments, calls `checkProject()` and prints. Every decision it
// makes is returned as an exit code rather than taken on the process, so a
// test runs the whole command and reads the answer.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// `finding.ts` is the shape and the severities and costs nothing to load;
// `checkProject` arrives through an `await import` below, because it brings the
// TypeScript compiler with it and that is an optional peer dependency.
import { Severity } from '../../check/src/finding.ts';
import { buildProject } from './build.ts';
import { INSTALL_TYPESCRIPT, isMissingTypescript, MISSING_TYPESCRIPT } from './peer.ts';
import { report, reportJson } from './report.ts';
import { Exit, paint, Style, type Terminal } from './terminal.ts';

/** The file that says which project this is. */
const TSCONFIG = 'tsconfig.json';

/** The directory checked when none is named. */
const HERE = '.';

/** Where a build lands when no other directory is asked for. */
const OUT = 'dist';

/** What this build of the command can actually do, named once. */
const SHIPPED = 'check and build';

/** Specified in SPEC §10, not built yet. Naming them beats "unknown command". */
const PLANNED: readonly string[] = ['create', 'generate', 'explain', 'trace', 'dev'];

const USAGE = `sheratan check [directory] [--json]
sheratan build [directory] [--out ${OUT}]

  directory   the project, the folder holding ${TSCONFIG} and index.html; defaults to ${HERE}
  --json      print one versioned JSON object, for an agent or an editor
  --out       where build writes, emptied first; defaults to ${OUT}
  --help, -h  this text

build strips types into plain ESM a static host can serve: no bundler, no
config, no plugin pipeline. It needs no TypeScript installed; check does.

Exit codes: 0 nothing to fix, 1 violations, 2 the command could not run.

Specified in SPEC §10 and not built yet: ${PLANNED.join(', ')}.`;

/** What to print for a thrown value: an Error's message, anything else as it prints. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why the command could not run. The compiler missing is not a fault in the
 * project and does not read like one: it is the optional peer dependency, and
 * the answer is an install line.
 */
export function reasonFor(error: unknown): string {
  return isMissingTypescript(error)
    ? `${MISSING_TYPESCRIPT}\n\n${INSTALL_TYPESCRIPT}`
    : messageOf(error);
}

function fail(terminal: Terminal, problem: string): Exit {
  terminal.err(`${paint(terminal, Style.Error, 'error')} ${problem}\n\n${USAGE}`);

  return Exit.Usage;
}

async function check(terminal: Terminal, directory: string, json: boolean): Promise<Exit> {
  const { checkProject } = await import('../../check/src/check.ts');
  const findings = checkProject({ tsconfig: resolve(directory, TSCONFIG) });

  terminal.out(json ? reportJson(findings) : report(terminal, findings));

  return findings.some((finding) => finding.severity === Severity.Error)
    ? Exit.Violations
    : Exit.Clean;
}

/** Strips the project into a directory, and says what it wrote. */
async function build(terminal: Terminal, directory: string, out: string): Promise<Exit> {
  const root = resolve(directory);
  const built = await buildProject({ root, out: resolve(root, out) });
  const runtime = built.runtime ? ', and the runtime beside them' : '';

  terminal.out(
    `${String(built.stripped)} files stripped, ${String(built.copied)} copied${runtime}.\n` +
      `Serve ${built.out} with any static file server.`,
  );

  return Exit.Clean;
}

async function dispatch(argv: readonly string[], terminal: Terminal): Promise<Exit> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string', default: OUT },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  const [command = '', directory = HERE] = positionals;

  if (values.help) {
    terminal.out(USAGE);

    return Exit.Clean;
  }

  if (command === 'check') return check(terminal, directory, values.json);

  if (command === 'build') return build(terminal, directory, values.out);

  const missing = `sheratan needs a command; this build ships ${SHIPPED}.`;

  if (command === '') return fail(terminal, missing);

  if (PLANNED.includes(command)) {
    return fail(
      terminal,
      `sheratan ${command} is specified but not built yet; this build ships ${SHIPPED}.`,
    );
  }

  return fail(terminal, `sheratan has no command \`${command}\`; this build ships ${SHIPPED}.`);
}

/**
 * Runs one command and returns what the process should exit with. Nothing here
 * touches `process`, so the caller owns the streams and the exit.
 *
 * @example
 * const code = await run(['check', '--json'], terminal);
 */
export async function run(argv: readonly string[], terminal: Terminal): Promise<Exit> {
  try {
    return await dispatch(argv, terminal);
  } catch (error) {
    return fail(terminal, reasonFor(error));
  }
}
