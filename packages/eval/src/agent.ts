// One turn. The agent is given the file tree and the checker's JSON, and
// nothing else: no task prompt, no tests, and no way to run the checker and
// try again (EVAL-TASKS §5). That is the whole experiment — if a structured
// `fix` field does not produce a repair first time, the premise is wrong.

import { spawn } from 'node:child_process';

import type { Finding } from './rules.ts';
import type { SourceFile } from './source.ts';

/** Tools the agent may use. No shell, so the checker cannot be run in a loop. */
const RESTRICTED = ['--restricted', '--strict-mcp-config'];

/** How long one turn may take before it counts as a non-answer. */
const TURN_TIMEOUT_MS = 300_000;

const INDENT = 2;

/** What one turn cost and what it said. */
export interface Turn {
  readonly ok: boolean;
  readonly text: string;
  readonly turns: number;
  readonly costUSD: number;
  readonly durationMs: number;
  /** Everything the CLI reported, kept for the raw log (EVAL §2.5). */
  readonly raw: string;
}

interface Result {
  readonly is_error?: boolean;
  readonly result?: string;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
}

/**
 * The prompt, identical for every case but for the tree and the findings. It
 * is deliberately plain: the checker output is supposed to do the work, and
 * anything else here would be measuring the prompt instead.
 */
export function promptFor(files: readonly SourceFile[], findings: readonly Finding[]): string {
  const tree = files.map((file) => `hosts/${file.path}`).join('\n');

  return `This project has a checker that enforces its architecture. It reports these errors:

${JSON.stringify(findings, null, INDENT)}

The file tree is:

${tree}

Make the checker pass. Do not change what the application does.`;
}

function parse(out: string): Result {
  const start = out.indexOf('{');

  if (start === -1) return {};

  try {
    return JSON.parse(out.slice(start)) as Result;
  } catch {
    return {};
  }
}

/** Runs one turn in `root`. The agent may read and edit only what is there. */
export async function takeTurn(root: string, prompt: string, model: string): Promise<Turn> {
  const started = Date.now();

  return new Promise<Turn>((settle) => {
    const child = spawn(
      'claude',
      [
        '-p',
        prompt,
        ...RESTRICTED,
        '--permission-mode',
        'acceptEdits',
        '--output-format',
        'json',
        '--model',
        model,
      ],
      // stdin is closed, or the CLI waits three seconds for piped input and
      // prints a warning ahead of the JSON.
      { cwd: root, timeout: TURN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });

    child.on('close', (code) => {
      const raw = err === '' ? out : `${out}\n--- stderr ---\n${err}`;
      const result = parse(out);

      settle({
        ok: code === 0 && result.is_error !== true,
        text: result.result ?? '',
        turns: result.num_turns ?? 0,
        costUSD: result.total_cost_usd ?? 0,
        durationMs: result.duration_ms ?? Date.now() - started,
        raw,
      });
    });
  });
}
