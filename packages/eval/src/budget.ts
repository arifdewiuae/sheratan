// The documentation budget (EVAL-TASKS §1.5), counted rather than estimated.
//
// §1.5 says "counted with the evaluated model's own token counter". There is
// no API key here, so the count goes through the CLI the harness already
// spawns: one call with the document appended to the system prompt, one
// without, identical in every other argument. The difference is the document.
//
// **It is not `usage.input_tokens`.** That field reads 2 on a cached prompt,
// because the CLI caches its system prompt and the real size lands in
// `cache_creation_input_tokens` and `cache_read_input_tokens`. Differencing
// `input_tokens` would have reported every document as 0 tokens and passed.
// The count is the sum of all three, which is stable to a couple of tokens
// across runs whatever the cache did.
//
// Both raw totals are returned, never just the subtraction, so a reader can
// check the arithmetic instead of trusting it.

import { spawn } from 'node:child_process';

import type { Arm } from './arm.ts';
import { TOOLS } from './session.ts';

/**
 * Tokens of documentation each arm may be given (EVAL-TASKS §1.5). Raised
 * from 8,000 on 2026-09-25, for every arm, before any comparative run — the
 * reasoning is in §1.5 itself, and `readBudget()` proves this constant and
 * that document still agree.
 */
export const DOC_BUDGET = 10_000;

/** Something short enough that the answer is not what is being measured. */
const PROBE = 'Reply with exactly: ok';

/** A probe is one turn and no work, so it does not need the run timeout. */
const PROBE_TIMEOUT_MS = 120_000;

/** What one count is made of, so the subtraction can be checked. */
export interface Count {
  /** Whole-prompt tokens with the document appended. */
  readonly withDoc: number;
  /** Whole-prompt tokens without it, every other argument identical. */
  readonly without: number;
  /** The document: `withDoc - without`. */
  readonly tokens: number;
}

/** The three places the CLI reports prompt tokens, depending on the cache. */
export interface Usage {
  readonly input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

/**
 * The whole prompt, however the cache split it. Uncached, cache-write and
 * cache-read tokens are all tokens the model was sent.
 *
 * @example
 * promptTokens({ input_tokens: 2, cache_creation_input_tokens: 22688, cache_read_input_tokens: 18639 });
 * // 41329 — not 2
 */
export function promptTokens(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function argsFor(system: string, model: string): string[] {
  return [
    '-p',
    PROBE,
    // Always passed, empty for the baseline: a flag that is present in one
    // call and absent in the other is a difference the count would attribute
    // to the document.
    '--append-system-prompt',
    system,
    '--strict-mcp-config',
    '--allowedTools',
    TOOLS.join(','),
    '--output-format',
    'json',
    '--model',
    model,
  ];
}

/** One probe, and what the model was sent for it. */
async function probe(system: string, model: string): Promise<number> {
  const out = await new Promise<string>((settle, fail) => {
    const child = spawn('claude', argsFor(system, model), {
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let text = '';

    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });

    child.on('error', fail);
    child.on('close', () => settle(text));
  });

  const at = out.indexOf('{');

  if (at === -1) throw new Error(`the token probe printed no JSON: ${out.slice(0, PROBE.length)}`);

  const result = JSON.parse(out.slice(at)) as { usage?: Usage };

  if (result.usage === undefined) throw new Error('the token probe reported no usage block.');

  return promptTokens(result.usage);
}

/**
 * What one document costs, measured the way §1.5 asks.
 *
 * @example
 * const count = await countTokens(await readFile('llms.txt', 'utf8'), 'claude-sonnet-5');
 * console.log(count.tokens, 'from', count.withDoc, '-', count.without);
 */
export async function countTokens(doc: string, model: string): Promise<Count> {
  // In sequence, not in parallel: two CLIs racing to write the same prompt
  // cache is how the two totals stop being comparable.
  const without = await probe('', model);
  const withDoc = await probe(doc, model);

  return { withDoc, without, tokens: withDoc - without };
}

/** What `--budget` and a failed assertion print. */
export function describeCount(arm: Arm, count: Count): string {
  return (
    `${arm.label}: ${String(count.tokens)} tokens ` +
    `(${String(count.withDoc)} with the document, ${String(count.without)} without), ` +
    `budget ${String(DOC_BUDGET)}`
  );
}

/**
 * Refuses to let a run start over budget. A warning here would be a number
 * published against a controlled variable that was not controlled.
 */
export function assertWithinBudget(arm: Arm, count: Count): void {
  if (count.tokens <= DOC_BUDGET) return;

  throw new Error(
    `${describeCount(arm, count)}. EVAL-TASKS §1.5 fixes the budget per arm, ` +
      `so this run would not be comparable. Cut ${String(count.tokens - DOC_BUDGET)} ` +
      `tokens from ${arm.docs}, or change the budget in §1.5 and in DOC_BUDGET together.`,
  );
}
