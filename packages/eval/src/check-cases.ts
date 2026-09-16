// Proves the instrument before it measures anything: every injection has to
// leave the app working. A case that also broke behaviour would score an
// agent on a repair it was never shown and never asked for.
//
// Run with `pnpm --filter @sheratan/eval check:cases`.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { CASES } from './cases.ts';
import { detect } from './detect.ts';
import { addSuite, HOSTS, prepare, runTests } from './sandbox.ts';
import { inject, readTree } from './tree.ts';

const FAILED = 1;

async function check(id: string, files: ReturnType<typeof inject>): Promise<boolean> {
  const root = join(tmpdir(), `sheratan-eval-check-${id}`);

  try {
    await prepare(root, files);
    await addSuite(root);

    const run = await runTests(root);

    if (!run.ok) console.error(run.output);

    return run.ok;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const tree = await readTree(HOSTS);
const broken: string[] = [];

console.log(`Checking ${String(CASES.length)} cases against the behaviour suite.\n`);

for (const violation of CASES) {
  const files = inject(tree, violation);
  const findings = detect(files);
  // eslint-disable-next-line no-await-in-loop -- one sandbox at a time, on purpose
  const passes = await check(violation.id, files);
  const reported = findings.length > 0 && findings.every((one) => one.code === violation.code);

  console.log(
    `${passes && reported ? 'ok  ' : 'FAIL'} ${violation.id.padEnd(20)} ` +
      `${String(findings.length)} finding(s), behaviour ${passes ? 'preserved' : 'BROKEN'}`,
  );

  if (!passes || !reported) broken.push(violation.id);
}

if (broken.length > 0) {
  console.error(`\n${String(broken.length)} case(s) unusable: ${broken.join(', ')}`);
  process.exitCode = FAILED;
} else {
  console.log(`\nAll ${String(CASES.length)} cases inject one class and leave the app working.`);
}
