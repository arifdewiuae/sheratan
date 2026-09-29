// A conversation with the agent, rather than one turn of one.
//
// `agent.ts` is the self-repair eval: one restricted turn, no shell, because
// "could it repair this first time" is the question there. This is the other
// half of EVAL-TASKS §1.4 — the agent gets a shell, runs the dev server and
// the checker as often as it likes, and comes back across iterations with the
// context it built. Resuming is not a convenience: a loop that restarted the
// conversation each time would measure ten first attempts, not iterations.
//
// Tools are named, not merely approved. Web search and fetch would let an arm
// read documentation the other arm's budget does not include, and the whole
// comparison rests on §1.5's budget being all either one gets. The number
// itself lives in `budget.ts`, so it is not restated here to go stale.
// `--allowedTools` only pre-approves; the first matrix's agents could still
// reach skills, a subagent and tool search, which is why `--tools` now sets
// what exists at all.
//
// The session id is chosen here, before the first turn, not read back from
// the reply. A turn stopped at the time limit has no reply, and without the
// id the next iteration would have started a new conversation from nothing.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { confine } from './confine.ts';
import { lengthOf, transcriptOf, turnOf, type TurnRecord } from './transcript.ts';

/** Everything the agent may use. No web access: see the note above. */
export const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'] as const;

/** How long one working turn may take. It builds and runs things, so it is not short. */
const TURN_TIMEOUT_MS = 900_000;

/** What a turn at the limit is stopped with: one the CLI can still write its cost on. */
const STOP_SIGNAL = 'SIGTERM';

/** What one message to the agent produced. */
export interface Reply {
  readonly ok: boolean;
  readonly text: string;
  readonly turns: number;
  readonly costUSD: number;
  readonly durationMs: number;
  /** Stopped at the time limit. Its cost, if known, came from the transcript. */
  readonly timedOut: boolean;
  /** Tool calls that named a path outside the sandbox; refused, and recorded. */
  readonly outside: readonly string[];
  /** Everything the CLI reported, kept for the raw log (EVAL §2.5). */
  readonly raw: string;
}

/** A running conversation, rooted in one sandbox. */
export interface Session {
  /** Sends one message and waits for the agent to stop working. */
  say(message: string): Promise<Reply>;
  /** What the conversation has cost so far. */
  spent(): number;
  /** The conversation's id, fixed before the first turn. */
  id(): string;
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
  /** The sandbox's real path, which its transcript is named after. */
  readonly realRoot: string;
  /** What the agent's process may not touch (`confine.ts`). */
  readonly profile: string;
}

function argsFor(options: SessionOptions, message: string, id: string, first: boolean): string[] {
  const resuming = first ? ['--session-id', id] : ['--resume', id];

  return [
    '-p',
    message,
    '--append-system-prompt',
    options.system,
    '--strict-mcp-config',
    '--tools',
    TOOLS.join(','),
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

/** What one CLI process left behind. */
interface Exit {
  readonly out: string;
  readonly err: string;
  readonly code: number | null;
  readonly timedOut: boolean;
}

async function ask(options: SessionOptions, args: readonly string[]): Promise<Exit> {
  const wrapped = confine('claude', args, options.profile);

  return new Promise((settle) => {
    // stdin is closed, or the CLI waits three seconds for piped input and
    // prints a warning ahead of the JSON. `sandbox-exec` execs the CLI in
    // its own place, so the signal at the limit reaches the CLI itself, and
    // SIGTERM gives it the chance to write the turn's cost to the transcript.
    const child = spawn(wrapped.command, [...wrapped.args], {
      cwd: options.root,
      timeout: TURN_TIMEOUT_MS,
      killSignal: STOP_SIGNAL,
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

    child.on('close', (code, signal) =>
      settle({ out, err, code, timedOut: signal === STOP_SIGNAL }),
    );
  });
}

/** The reply, with the transcript filling in what a stopped turn could not say. */
function replyOf(exit: Exit, turn: TurnRecord, started: number): Reply {
  const result = parse(exit.out);

  return {
    ok: exit.code === 0 && result.is_error !== true,
    text: result.result ?? '',
    turns: result.num_turns ?? 0,
    costUSD: result.total_cost_usd ?? turn.costUSD ?? 0,
    durationMs: result.duration_ms ?? Date.now() - started,
    timedOut: exit.timedOut,
    outside: turn.outside,
    raw: exit.err === '' ? exit.out : `${exit.out}\n--- stderr ---\n${exit.err}`,
  };
}

/**
 * Opens a conversation in `root`, confined by `profile`. The agent's working
 * directory is the sandbox and the profile denies it everything that matters
 * outside it, so the hidden suite is out of reach by the operating system's
 * say, not by the agent's not looking.
 *
 * @example
 * const session = openSession({ root, realRoot, profile, model: 'claude-sonnet-5', system });
 * const first = await session.say(task.prompt);
 */
export function openSession(options: SessionOptions): Session {
  const id = randomUUID();
  const transcript = transcriptOf(options.realRoot, id);

  let first = true;
  let total = 0;

  return {
    id: () => id,
    spent: () => total,

    async say(message: string): Promise<Reply> {
      const started = Date.now();
      const before = await lengthOf(transcript);
      const exit = await ask(options, argsFor(options, message, id, first));

      first = false;

      const reply = replyOf(exit, await turnOf(transcript, before, options.realRoot), started);

      total += reply.costUSD;

      return reply;
    },
  };
}
