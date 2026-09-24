// The stage, stood up for real: a scaffolded Sheratan app, its own dev server,
// `evalkit` behind it and one origin in front. No model is involved — this is
// the half of a task run that can be proved for nothing, and if it is wrong
// every number the paid half produces is wrong with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { sheratanArm } from '../src/arms/sheratan.ts';
import { setUpStage } from '../src/stage.ts';

const OK = 200;
const NOT_FOUND = 404;

test('a scaffolded arm serves its app and the backend at one origin', async () => {
  const stage = await setUpStage({ arm: sheratanArm });

  try {
    const page = await fetch(`${stage.origin}/`);
    const body = await page.text();

    assert.equal(page.status, OK);
    assert.match(body, /<script type="module"/u, 'the app was served, not the backend');

    // The agent is told the base URL is the origin the page came from, and
    // this is that promise being true rather than documented.
    const api = await fetch(`${stage.origin}/api/customers`);
    const customers = (await api.json()) as readonly unknown[];

    assert.equal(api.status, OK);
    assert.equal(customers.length, 25);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('a fresh scaffold is already clean, so iteration one starts from zero', async () => {
  const stage = await setUpStage({ arm: sheratanArm });

  try {
    const clean = await stage.clean();

    assert.equal(clean.ok, true, clean.output);
    assert.match(clean.output, /No violations\./u);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('the sandbox holds the app and no trace of the harness', async () => {
  const stage = await setUpStage({ arm: sheratanArm });

  try {
    const entries = await readdir(stage.root);

    assert.ok(entries.includes('app.ts'), 'the app is there');
    assert.ok(entries.includes('modules'), 'the canonical module is there');

    // The hidden suites live in this package and must never be copied in.
    // Nothing here may name them, at any depth the agent could reach.
    assert.ok(!entries.includes('suites'), 'the suites are not in the sandbox');
    assert.ok(!entries.includes('test'), 'the harness tests are not in the sandbox');

    const manifest = JSON.parse(await readFile(join(stage.root, 'package.json'), 'utf8')) as {
      name: string;
    };

    assert.equal(manifest.name, 'eval-app');
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});

test('the test-only surfaces are unreachable from the app the agent is given', async () => {
  const stage = await setUpStage({ arm: sheratanArm });

  try {
    const reached = await fetch(`${stage.origin}/__inspect/requests`);

    assert.equal(reached.status, NOT_FOUND);
    assert.deepEqual(stage.tampering(), ['/__inspect/requests']);

    // A hidden test still has them, because it holds evalkit's own URL.
    const direct = await fetch(`${stage.backend}/__inspect/requests`);

    assert.equal(direct.status, OK);
  } finally {
    await stage[Symbol.asyncDispose]();
  }
});
