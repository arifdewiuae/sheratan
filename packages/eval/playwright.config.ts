// The hidden suites (EVAL-TASKS §1.4). They never enter the sandbox: they run
// from this package, against the origin the harness serves the arm's app on,
// so ten iterations of an agent with a shell cannot read them.
//
// No `webServer` here on purpose — `stage.ts` owns both servers, and a config
// that started its own would be serving a different app from the one being scored.

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/** Long enough for the slowest injected latency plus a retry schedule. */
const EXPECT_TIMEOUT_MS = 10_000;

/** One assertion file's whole budget. */
const TEST_TIMEOUT_MS = 60_000;

const config: PlaywrightTestConfig = defineConfig({
  testDir: 'suites',
  testMatch: /.*\.spec\.ts$/,

  // `evalkit` is one mutable server: latency, queued refusals and counters are
  // server-wide, so two tests in flight would be steering each other.
  fullyParallel: false,
  workers: 1,

  // Always, not only in CI. A `.only` left in a hidden suite would score a run
  // on one assertion and report it as a pass.
  forbidOnly: true,

  // A retry would turn a real flake into a green run, and a flaky suite scoring
  // a $30 matrix is the failure mode this whole instrument exists to avoid.
  retries: 0,

  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  reporter: [['json']],
  use: { ...devices['Desktop Chrome'] },
});

export default config;
