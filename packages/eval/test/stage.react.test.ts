// The control arm, stood up for real: the committed React app scaffolded into
// a sandbox, Vite serving it, `evalkit` behind it and one origin in front.
// The same four things `stage.test.ts` proves for the Sheratan arm, because an
// arm that has never been stood up is an arm whose first run is the test.
//
// Skipped when `controls/react/node_modules` is absent. CI has no React in it
// and must not grow one — the control is installed once, by hand, the way
// `Docs/comparison/` is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { CONTROL_APP, reactArm } from '../src/arms/react.ts';
import { setUpStage } from '../src/stage.ts';

const OK = 200;
const NOT_FOUND = 404;

/** How many customers `evalkit`'s fixture holds, which is how a run knows it answered. */
const CUSTOMERS = 25;

async function installed(): Promise<boolean> {
  try {
    await stat(join(CONTROL_APP, 'node_modules'));

    return true;
  } catch {
    return false;
  }
}

const skip = (await installed())
  ? false
  : `the control arm is not installed — run \`pnpm install --ignore-workspace\` in ${CONTROL_APP}`;

test('the control arm serves its app and the backend at one origin', { skip }, async () => {
  const stage = await setUpStage({ arm: reactArm });

  try {
    const page = await fetch(`${stage.origin}/`);
    const body = await page.text();

    assert.equal(page.status, OK);
    assert.match(body, /<script type="module"/u, 'the app was served, not the backend');
    assert.match(body, /id="app"/u);

    // Both arms are told the base URL is the origin the page came from. This
    // is that promise being true for the control as well as for Sheratan.
    const api = await fetch(`${stage.origin}/api/customers`);
    const customers = (await api.json()) as readonly unknown[];

    assert.equal(api.status, OK);
    assert.equal(customers.length, CUSTOMERS);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('a fresh control scaffold is already clean', { skip }, async () => {
  const stage = await setUpStage({ arm: reactArm });

  try {
    const clean = await stage.clean();

    // Both commands, in order. `cleanOf` stops at the first failure, so a
    // green here is the only evidence that the second one ran at all.
    assert.equal(clean.ok, true, clean.output);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('the control sandbox holds the app and nothing else', { skip }, async () => {
  const stage = await setUpStage({ arm: reactArm });

  try {
    const entries = await readdir(stage.root);

    assert.ok(entries.includes('main.tsx'), 'the composition root is there');
    assert.ok(entries.includes('modules'), 'the modules are there');
    assert.ok(entries.includes('node_modules'), 'the installed tree is linked in');

    // The documentation reaches the agent inside the §1.5 budget, through the
    // system prompt. A copy of it in the working directory would be a second
    // one, outside the budget and uncounted.
    assert.ok(!entries.includes('DOCS.md'), 'the arm document is not in the sandbox');

    // The hidden suites live in this package and must never be copied in.
    assert.ok(!entries.includes('suites'), 'the suites are not in the sandbox');
    assert.ok(!entries.includes('test'), 'the harness tests are not in the sandbox');
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('the test-only surfaces are unreachable from the control app', { skip }, async () => {
  const stage = await setUpStage({ arm: reactArm });

  try {
    const reached = await fetch(`${stage.origin}/__inspect/requests`);

    assert.equal(reached.status, NOT_FOUND);
    assert.deepEqual(stage.tampering(), ['/__inspect/requests']);

    const direct = await fetch(`${stage.backend}/__inspect/requests`);

    assert.equal(direct.status, OK);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});
