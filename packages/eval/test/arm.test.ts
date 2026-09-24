// An arm is data, and these are the two things that must stay true of it: the
// registry says what this build can run, and a name it does not know is named
// back rather than silently substituted. A typo in `--arm` that quietly ran
// the wrong stack would put a number against the wrong framework.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { armNamed } from '../src/arm.ts';
import { ARMS } from '../src/arms/index.ts';
import { sheratanArm } from '../src/arms/sheratan.ts';

test('the registry holds the arms this build can run', () => {
  assert.equal(armNamed(ARMS, 'sheratan'), sheratanArm);
  assert.equal(sheratanArm.gates, true);

  // EVAL-TASKS §1.2: this arm is clean when `sheratan check` says so, and the
  // protocol names nothing else for it.
  assert.deepEqual(
    sheratanArm.clean.map((command) => [command.run, ...command.args]),
    [['sheratan', 'check', '.']],
  );
});

test('an arm this build does not have is named, not guessed at', () => {
  assert.throws(() => armNamed(ARMS, 'vue'), /No arm `vue`; this build has sheratan\./u);
});

test('the dev server is asked for a port and told not to reload', () => {
  const serving = sheratanArm.serving(4321);

  assert.deepEqual(
    [serving.run, ...serving.args],
    ['sheratan', 'dev', '.', '--port', '4321', '--no-reload'],
  );
});
