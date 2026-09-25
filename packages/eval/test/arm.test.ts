// An arm is data, and these are the two things that must stay true of it: the
// registry says what this build can run, and a name it does not know is named
// back rather than silently substituted. A typo in `--arm` that quietly ran
// the wrong stack would put a number against the wrong framework.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { armNamed } from '../src/arm.ts';
import { ARMS } from '../src/arms/index.ts';
import { reactArm } from '../src/arms/react.ts';
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

test('the control arm gates, and is clean when both of its commands are', () => {
  assert.equal(armNamed(ARMS, 'react'), reactArm);
  assert.equal(reactArm.gates, true);

  // EVAL-TASKS §1.2: "eslint (recommended + react-hooks) and tsc --noEmit →
  // 0 errors". Two commands, in that order, and nothing else — the app ships
  // a test script too, and the protocol does not name it.
  assert.deepEqual(
    reactArm.clean.map((command) => [command.run, ...command.args]),
    [
      ['eslint', '.'],
      ['tsc', '--noEmit'],
    ],
  );
});

test('an arm this build does not have is named, not guessed at', () => {
  // Vue is deliberately not an arm (EVAL §2.1), so it is the honest example
  // of a name that looks plausible and is not there.
  assert.throws(() => armNamed(ARMS, 'vue'), /No arm `vue`; this build has sheratan, react\./u);
});

test('the dev server is asked for a port and told not to reload', () => {
  const serving = sheratanArm.serving(4321);

  assert.deepEqual(
    [serving.run, ...serving.args],
    ['sheratan', 'dev', '.', '--port', '4321', '--no-reload'],
  );
});

test('the control arm is pinned to the port it is given', () => {
  const serving = reactArm.serving(4321);

  // `--strictPort`, so a busy port fails the run rather than moving the app
  // somewhere the proxy is not pointed. Reloading is off in `vite.config.ts`
  // rather than on the command line, which is the only place Vite takes it.
  assert.deepEqual(
    [serving.run, ...serving.args],
    ['vite', '--host', '127.0.0.1', '--port', '4321', '--strictPort'],
  );
});
