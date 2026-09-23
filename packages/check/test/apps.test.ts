// The two apps in this repo are written in the canonical shape. A finding on
// either is a false positive — or a real violation, which is worse to leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { checkProject, RuleCode, Severity } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');

test('examples/hello is clean', () => {
  assert.deepEqual(checkProject({ tsconfig: resolve(REPO, 'examples/hello/tsconfig.json') }), []);
});

/** The four modules the Week 0 eval's host app is built from. */
const HOSTS = ['customers', 'new-order', 'notifications', 'orders'];

/** Every file SHR-T001 asks for a test beside, in the order a report prints. */
const UNTESTED = HOSTS.flatMap((module) =>
  ['effects', 'state'].map((layer) => `modules/${module}/${module}.${layer}.ts`),
).toSorted();

// The eval host app is a measurement artifact, not a maintained app: it is the
// material four agents were given in Week 0, and writing tests into it now
// would change what was measured. So it stands as the one place a warning is
// expected — which is also what proves a warning is not an error.
test("the Week 0 eval's host app has no errors, and no tests", () => {
  const findings = checkProject({
    tsconfig: resolve(REPO, 'packages/eval/tsconfig.json'),
    root: resolve(REPO, 'packages/eval/hosts'),
  });

  assert.deepEqual(
    findings.filter((finding) => finding.severity !== Severity.Warning),
    [],
  );

  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.file]),
    UNTESTED.map((file) => [RuleCode.Tested, file]),
  );
});

test('a project TypeScript cannot open fails loudly, not as a clean result', () => {
  assert.throws(
    () => checkProject({ tsconfig: resolve(REPO, 'no/such/tsconfig.json') }),
    /could not open/,
  );
});
