// The Week 0 gate (EVAL §2.3, EVAL-TASKS §5): twelve cases, five seeds, one
// turn each. Pass is the checker clean *and* the behaviour suite still green.
// Gate is 48 of 60.
//
//   pnpm --filter @sheratan/eval selfrepair            # the full 60
//   pnpm --filter @sheratan/eval selfrepair -- --seeds 1
//   pnpm --filter @sheratan/eval selfrepair -- --case L001-orders
//
// Every run's prompt, reply and resulting diff is written under results/, and
// those logs are committed: a number nobody can re-read is not evidence.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { promptFor, takeTurn, Told } from '../src/agent.ts';
import { CASES, type Case } from '../src/cases.ts';
import { detect } from '../src/detect.ts';
import { HOSTS, PACKAGE, prepare } from '../src/sandbox.ts';
import { inject, readTree } from '../src/tree.ts';
import type { SourceFile } from '../src/source.ts';
import { verify } from '../src/verify.ts';

const SEEDS = 5;
const MODEL = 'claude-sonnet-5';
const GATE = 0.8;
const PERCENT = 100;
const MONEY = 2;
const NAME_WIDTH = 22;

interface Options {
  readonly seeds: number;
  readonly only: string | undefined;
  readonly model: string;
  readonly told: Told;
}

function options(argv: readonly string[]): Options {
  const seeds = argv.indexOf('--seeds');
  const only = argv.indexOf('--case');
  const model = argv.indexOf('--model');
  const told = argv.indexOf('--told');

  return {
    seeds: seeds === -1 ? SEEDS : Number(argv[seeds + 1]),
    only: only === -1 ? undefined : argv[only + 1],
    model: model === -1 ? MODEL : (argv[model + 1] ?? MODEL),
    told: told === -1 ? Told.Full : ((argv[told + 1] ?? Told.Full) as Told),
  };
}

/** One row of the raw log. */
interface Run {
  readonly case: string;
  readonly host: string;
  readonly code: string;
  readonly seed: number;
  readonly model: string;
  readonly told: Told;
  readonly pass: boolean;
  readonly repaired: boolean;
  readonly behaviourKept: boolean;
  readonly remaining: readonly string[];
  /** Runtime module cycles the repair introduced. Recorded, not scored. */
  readonly cycles: readonly string[];
  readonly turns: number;
  readonly costUSD: number;
  readonly durationMs: number;
  readonly reply: string;
}

async function record(into: string, name: string, body: string): Promise<void> {
  await writeFile(join(into, name), body, 'utf8');
}

/** What the agent left behind, as a diff a reader can check (EVAL §2.5). */
function changesOf(before: readonly SourceFile[], after: readonly SourceFile[]): string {
  const was = new Map(before.map((file) => [file.path, file.text]));

  return after
    .filter((file) => was.get(file.path) !== file.text)
    .map((file) => `===== ${file.path}\n${file.text}`)
    .join('\n');
}

async function once(violation: Case, seed: number, into: string, opts: Options): Promise<Run> {
  const tree = await readTree(HOSTS);
  const injected = inject(tree, violation);
  const findings = detect(injected);
  const root = join(tmpdir(), `sheratan-eval-${violation.id}-${String(seed)}`);
  const prompt = promptFor(injected, findings, opts.told);

  await prepare(root, injected);

  const turn = await takeTurn(root, prompt, opts.model);
  const verdict = await verify(root);
  const after = await readTree(join(root, 'hosts'));
  const stem = `${violation.id}-seed${String(seed)}`;

  await record(into, `${stem}.prompt.txt`, prompt);
  await record(into, `${stem}.reply.txt`, turn.raw);
  await record(into, `${stem}.diff.txt`, changesOf(injected, after));

  if (!verdict.behaviourKept) await record(into, `${stem}.tests.txt`, verdict.testOutput);

  await rm(root, { recursive: true, force: true });

  return {
    case: violation.id,
    host: violation.host,
    code: violation.code,
    seed,
    model: opts.model,
    told: opts.told,
    pass: verdict.pass && turn.ok,
    repaired: verdict.repaired,
    behaviourKept: verdict.behaviourKept,
    remaining: verdict.remaining.map((one) => one.code),
    cycles: verdict.cycles,
    turns: turn.turns,
    costUSD: turn.costUSD,
    durationMs: turn.durationMs,
    reply: turn.text,
  };
}

const opts = options(process.argv.slice(2));
const chosen = opts.only === undefined ? CASES : CASES.filter((one) => one.id === opts.only);

if (chosen.length === 0) throw new Error(`no case named ${String(opts.only)}`);

const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
const into = join(PACKAGE, 'results', opts.told === Told.Full ? stamp : `${stamp}-${opts.told}`);

await mkdir(into, { recursive: true });

const total = chosen.length * opts.seeds;

console.log(`Week 0 self-repair: ${String(chosen.length)} cases x ${String(opts.seeds)} seeds`);

console.log(
  `model ${opts.model}, told "${opts.told}", one turn each, gate ${String(GATE * PERCENT)}%\n`,
);

const runs: Run[] = [];

for (const violation of chosen) {
  const seeds = Array.from({ length: opts.seeds }, (_unused, index) => index + 1);
  // eslint-disable-next-line no-await-in-loop -- seeds of one case run together, cases in order
  const done = await Promise.all(seeds.map(async (seed) => once(violation, seed, into, opts)));

  runs.push(...done);

  const passed = done.filter((run) => run.pass).length;

  console.log(
    `${violation.id.padEnd(NAME_WIDTH)} ${String(passed)}/${String(opts.seeds)} ` +
      done.map((run) => (run.pass ? '.' : 'X')).join(''),
  );
}

const passed = runs.filter((run) => run.pass).length;
const cost = runs.reduce((sum, run) => sum + run.costUSD, 0);
const rate = passed / total;

await record(into, 'runs.jsonl', `${runs.map((run) => JSON.stringify(run)).join('\n')}\n`);

await record(
  into,
  'summary.json',
  `${JSON.stringify(
    {
      when: stamp,
      model: opts.model,
      told: opts.told,
      cases: chosen.length,
      seeds: opts.seeds,
      total,
      passed,
      rate,
      gate: GATE,
      met: rate >= GATE,
      costUSD: cost,
      repairedButBroke: runs.filter((run) => run.repaired && !run.behaviourKept).length,
      brokeNothingFixedNothing: runs.filter((run) => !run.repaired && run.behaviourKept).length,
      introducedACycle: runs.filter((run) => run.cycles.length > 0).length,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${String(passed)}/${String(total)} (${(rate * PERCENT).toFixed(1)}%)`);
console.log(`gate ${String(GATE * PERCENT)}%: ${rate >= GATE ? 'MET' : 'NOT MET'}`);
console.log(`cost $${cost.toFixed(MONEY)} · logs in ${into}`);
