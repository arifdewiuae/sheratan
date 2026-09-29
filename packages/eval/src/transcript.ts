// What one turn left in Claude Code's own transcript of the session.
//
// The CLI's JSON reply is the record of a turn that ended. A turn stopped at
// the time limit has no reply, and the first matrix lost a turn's cost that
// way — it was only recovered by hand, from here. And the reply never says
// what the agent tried to reach, which is how a sandbox leak went unseen for
// eighteen runs. So after every turn the harness reads what that turn
// appended to the transcript: its cost, and any tool call that named a path
// outside the sandbox.
//
// A turn's lines are the ones after the count taken before it began. The
// transcript's `cost-state` line carries one process's cost, and its
// `startTime` is the session's, the same on every turn — the position is the
// only thing that tells turns apart.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { REPOSITORY, TRANSCRIPTS, transcriptDirOf } from './confine.ts';

/** How much of a tool call's input a log line keeps. */
const EXCERPT = 200;

/** One line of the transcript, as far as this file reads it. */
interface Line {
  readonly type?: string;
  readonly totalCostUSD?: number;
  readonly message?: {
    readonly role?: string;
    readonly content?: readonly {
      readonly type?: string;
      readonly name?: string;
      readonly input?: unknown;
    }[];
  };
}

/** What one turn left behind. */
export interface TurnRecord {
  /** The turn's own cost, when its process lived long enough to write it. */
  readonly costUSD: number | undefined;
  /** Tool calls that named a path outside the sandbox, as `Tool: input…`. */
  readonly outside: readonly string[];
}

/**
 * Where a session's transcript is.
 *
 * @example
 * const path = transcriptOf(realRoot, sessionId);
 */
export function transcriptOf(realRoot: string, sessionId: string): string {
  return join(transcriptDirOf(realRoot), `${sessionId}.jsonl`);
}

async function linesOf(path: string): Promise<string[]> {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

/**
 * How many lines the transcript has now, so a turn can be read as what came
 * after. Zero before the first turn, when there is no file yet.
 *
 * @example
 * const before = await lengthOf(path);
 */
export async function lengthOf(path: string): Promise<number> {
  return (await linesOf(path)).length;
}

function parsed(text: string): Line {
  try {
    return JSON.parse(text) as Line;
  } catch {
    return {};
  }
}

/** Whether a tool call's input names somewhere the agent was never given. */
function reachesOutside(input: string, ownTranscripts: string): boolean {
  if (input.includes(REPOSITORY)) return true;

  return input.includes(TRANSCRIPTS) && !input.includes(ownTranscripts);
}

function outsideCalls(lines: readonly Line[], ownTranscripts: string): string[] {
  const found: string[] = [];

  for (const line of lines) {
    if (line.message?.role !== 'assistant') continue;

    for (const part of line.message.content ?? []) {
      if (part.type !== 'tool_use') continue;

      const input = JSON.stringify(part.input);

      if (reachesOutside(input, ownTranscripts)) {
        found.push(`${part.name ?? 'tool'}: ${input.slice(0, EXCERPT)}`);
      }
    }
  }

  return found;
}

/**
 * Reads the lines one turn appended: the cost its process wrote on the way
 * out, and every tool call that named a path outside the sandbox. The calls
 * are recorded, not voided — the profile in `confine.ts` already refused
 * them, and a denied `find /` is not a leak — but a reader of the log can
 * see what an arm tried.
 *
 * @example
 * const turn = await turnOf(path, before, realRoot);
 */
export async function turnOf(path: string, from: number, realRoot: string): Promise<TurnRecord> {
  const lines = (await linesOf(path)).slice(from).map(parsed);
  const costs = lines.filter((line) => line.type === 'cost-state').map((line) => line.totalCostUSD);
  const cost = costs.at(-1);

  return {
    costUSD: typeof cost === 'number' ? cost : undefined,
    outside: outsideCalls(lines, transcriptDirOf(realRoot)),
  };
}
