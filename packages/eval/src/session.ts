// A conversation with the agent, rather than one turn of one.
//
// `agent.ts` is the self-repair eval: one restricted turn, no shell, because
// "could it repair this first time" is the question there. This is the other
// half of EVAL-TASKS §1.4 — the agent gets a shell, runs the dev server and
// the checker as often as it likes, and comes back across iterations with the
// context it built. Resuming is not a convenience: a loop that restarted the
// conversation each time would measure ten first attempts, not iterations.
//
// Two tools are withheld on purpose. Web search and fetch would let an arm
// read documentation the other arm's budget does not include, and the whole
// comparison rests on §1.5's budget being all either one gets. The number
// itself lives in `budget.ts`, so it is not restated here to go stale.

import { spawn } from 'node:child_process';

/** Everything the agent may use. No web access: see the note above. */
export const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'] as const;

/** How long one working turn may take. It builds and runs things, so it is not short. */
const TURN_TIMEOUT_MS = 900_000;

/** What one message to the agent produced. */
export interface Reply {
  readonly ok: boolean;
  readonly text: string;
  readonly turns: number;
  readonly costUSD: number;
  readonly durationMs: number;
  /** Everything the CLI reported, kept for the raw log (EVAL §2.5). */
  readonly raw: string;
}

/** A running conversation, rooted in one sandbox. */
export interface Session {
  /** Sends one message and waits for the agent to stop working. */
  say(message: string): Promise<Reply>;
  /** What the conversation has cost so far. */
  spent(): number;
  /** The CLI's own id for it, once the first reply has come back. */
  id(): string | undefined;
}

interface Result {
  readonly is_error?: boolean;
  readonly result?: string;
  readonly session_id?: string;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
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

/** How a conversation is opened. */
export interface SessionOptions {
  /** The sandbox, and the agent's whole world. */
  readonly root: string;
  readonly model: string;
  /**
   * The documentation and the API contract, appended to the agent's own
   * system prompt. EVAL-TASKS §1.5 budgets the documentation half per arm and
   * `budget.ts` counts it; §6 puts the contract outside that budget,
   * identically for every arm.
   */
  readonly system: string;
}

function argsFor(options: SessionOptions, message: string, resume: string | undefined): string[] {
  const resuming = resume === undefined ? [] : ['--resume', resume];

  return [
    '-p',
    message,
    '--append-system-prompt',
    options.system,
    '--strict-mcp-config',
    '--allowedTools',
    TOOLS.join(','),
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'json',
    '--model',
    options.model,
    ...resuming,
  ];
}

async function ask(
  root: string,
  args: readonly string[],
): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((settle) => {
    // stdin is closed, or the CLI waits three seconds for piped input and
    // prints a warning ahead of the JSON.
    const child = spawn('claude', [...args], {
      cwd: root,
      timeout: TURN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });

    child.on('close', (code) => settle({ out, err, code }));
  });
}

/**
 * Opens a conversation in `root`. The agent's working directory is the
 * sandbox and nothing else is added to it, so the hidden suite — which lives
 * in this package, not in there — is out of reach by construction.
 *
 * @example
 * const session = openSession({ root, model: 'claude-sonnet-5', system });
 * const first = await session.say(task.prompt);
 */
export function openSession(options: SessionOptions): Session {
  let resume: string | undefined = undefined;
  let total = 0;

  return {
    id: () => resume,
    spent: () => total,

    async say(message: string): Promise<Reply> {
      const started = Date.now();
      const { out, err, code } = await ask(options.root, argsFor(options, message, resume));
      const result = parse(out);

      resume = result.session_id ?? resume;
      total += result.total_cost_usd ?? 0;

      return {
        ok: code === 0 && result.is_error !== true,
        text: result.result ?? '',
        turns: result.num_turns ?? 0,
        costUSD: result.total_cost_usd ?? 0,
        durationMs: result.duration_ms ?? Date.now() - started,
        raw: err === '' ? out : `${out}\n--- stderr ---\n${err}`,
      };
    },
  };
}
