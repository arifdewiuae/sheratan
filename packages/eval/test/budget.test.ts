// The budget, proved without spending anything. What costs money is the
// count itself; what has to be right is the arithmetic around it and the
// refusal, and neither needs a model.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertWithinBudget,
  describeCount,
  DOC_BUDGET,
  promptTokens,
  type Count,
} from '../src/budget.ts';
import { readBudget } from '../src/frozen.ts';
import { sheratanArm } from '../src/arms/sheratan.ts';

/** A count that came out at `tokens`, with plausible raw totals behind it. */
function counted(tokens: number): Count {
  const without = 50_000;

  return { withDoc: without + tokens, without, tokens };
}

test('the budget in the code is the budget in EVAL-TASKS §1.5', async () => {
  assert.equal(
    await readBudget(),
    DOC_BUDGET,
    'EVAL-TASKS §1.5 and DOC_BUDGET disagree; a run would measure against the wrong cap',
  );
});

test('a document inside the budget starts a run', () => {
  assert.doesNotThrow(() => assertWithinBudget(sheratanArm, counted(DOC_BUDGET)));
  assert.doesNotThrow(() => assertWithinBudget(sheratanArm, counted(1)));
});

test('a document over the budget refuses the run, and says by how much', () => {
  const over = 1_234;

  assert.throws(
    () => assertWithinBudget(sheratanArm, counted(DOC_BUDGET + over)),
    (error: Error) => {
      // The failure has to name the overage and the file, or the next person
      // has to re-derive both before they can act on it (A2, A3).
      assert.match(error.message, new RegExp(`Cut ${String(over)} tokens`, 'u'));
      assert.match(error.message, /llms\.txt/u);

      return true;
    },
  );
});

test('a count shows both raw totals, so the subtraction can be checked', () => {
  const said = describeCount(sheratanArm, counted(9_593));

  assert.match(said, /9593 tokens/u);
  assert.match(said, /59593 with the document, 50000 without/u);
  assert.match(said, new RegExp(`budget ${String(DOC_BUDGET)}`, 'u'));
});

test('a cached prompt is counted whole, not by `input_tokens`', () => {
  // Verbatim from a real `claude -p --output-format json` run, 2026-09-25.
  // `input_tokens` is 2: the CLI caches its own system prompt, so the prompt
  // lands in the two cache fields. EVAL-TASKS §1.5's budget differenced on
  // `input_tokens` alone would read 0 for every document and pass silently,
  // which is what this build was one line away from shipping.
  const cached = {
    input_tokens: 2,
    cache_creation_input_tokens: 22_688,
    cache_read_input_tokens: 18_639,
  };

  assert.equal(promptTokens(cached), 41_329);

  // Same prompt, different cache split: the total is what must stay stable.
  const split = {
    input_tokens: 2,
    cache_creation_input_tokens: 41_327,
    cache_read_input_tokens: 0,
  };

  assert.equal(promptTokens(split), promptTokens(cached));

  // A response that reports no cache fields at all is still counted.
  assert.equal(promptTokens({ input_tokens: 500 }), 500);
});
