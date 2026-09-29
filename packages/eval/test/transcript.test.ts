// Reading one turn out of a transcript, against transcripts shaped like the
// ones Claude Code writes. The two things it recovers are the two the first
// matrix lost: the cost of a turn stopped at the limit, and what an agent
// reached for outside its sandbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPOSITORY, TRANSCRIPTS, transcriptDirOf } from '../src/confine.ts';
import { lengthOf, turnOf } from '../src/transcript.ts';

const ROOT = '/private/var/T/sheratan-eval-sheratan-abc';

function costState(cost: number): string {
  return JSON.stringify({ type: 'cost-state', totalCostUSD: cost, startTime: 1 });
}

function toolCall(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
  });
}

async function transcript(
  lines: readonly string[],
): Promise<{ path: string; done: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'transcript-'));
  const path = join(dir, 'session.jsonl');

  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');

  return { path, done: async () => rm(dir, { recursive: true, force: true }) };
}

test('a transcript that does not exist yet has no lines, and no turn in it', async () => {
  assert.equal(await lengthOf('/nowhere/session.jsonl'), 0);

  assert.deepEqual(await turnOf('/nowhere/session.jsonl', 0, ROOT), {
    costUSD: undefined,
    outside: [],
  });
});

test('a turn is only what came after the count taken before it', async () => {
  // The earlier turn's cost must not be read as this one's: `cost-state` is per
  // process, and a turn killed before writing one has no cost of its own.
  const file = await transcript([costState(0.95), toolCall('Bash', { command: 'ls' })]);

  try {
    assert.deepEqual(await turnOf(file.path, 2, ROOT), { costUSD: undefined, outside: [] });
  } finally {
    await file.done();
  }
});

test("a stopped turn's cost is the last one its process wrote", async () => {
  const file = await transcript([
    costState(0.95),
    toolCall('Bash', { command: 'ls' }),
    costState(2.59),
  ]);

  try {
    const before = 1;

    assert.equal((await turnOf(file.path, before, ROOT)).costUSD, 2.59);
  } finally {
    await file.done();
  }
});

test("a call naming the repository or another run's transcript is recorded; its own is not", async () => {
  const file = await transcript([
    toolCall('Read', { file_path: join(REPOSITORY, 'packages/eval/suites/T01.spec.ts') }),
    toolCall('Bash', { command: `ls ${TRANSCRIPTS}/-private-var-T-sheratan-eval-react-xyz` }),
    toolCall('Bash', { command: `ls ${transcriptDirOf(ROOT)}` }),
    toolCall('Bash', { command: 'pnpm test' }),
  ]);

  try {
    const { outside } = await turnOf(file.path, 0, ROOT);

    assert.equal(outside.length, 2);
    assert.match(outside[0] ?? '', /^Read: .*T01\.spec\.ts/u);
    assert.match(outside[1] ?? '', /^Bash: .*sheratan-eval-react-xyz/u);
  } finally {
    await file.done();
  }
});
