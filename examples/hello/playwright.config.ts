// E2E lives at the app level, never inside a module (SPEC §4 Tests). The same
// specs run against both builds, so the production bundle is proven to behave
// like the development one.

import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const SERVER_TIMEOUT_MS = 30_000;
const isCI = process.env['CI'] !== undefined;

/** The spec that has to hold on every engine, and nowhere else (SPEC §9a). */
const MATRIX_SPEC = /styling\.e2e\.ts$/;

/** Playwright's names for the three engines, as `devices` spells them. */
const MATRIX_ENGINES = ['Chrome', 'Firefox', 'Safari'] as const;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  // The command a user runs, from source so the workspace needs no build first.
  // `--no-reload` is not a convenience: a reload landing mid-assertion is how a
  // dev server turns a suite flaky.
  webServer: {
    command: `node ../../packages/cli/bin/sheratan.ts dev . --port ${String(PORT)} --no-reload`,
    url: `http://localhost:${String(PORT)}/`,
    reuseExistingServer: !isCI,
    timeout: SERVER_TIMEOUT_MS,
  },
  projects: [
    { name: 'dev build', testIgnore: MATRIX_SPEC, use: devices['Desktop Chrome'] },
    { name: 'prod build', testIgnore: MATRIX_SPEC, use: devices['Desktop Chrome'] },

    // SPEC §9a is the one mechanism with no fallback path, and the engines do
    // not agree about it — so it is the one spec that runs on all three, while
    // the rest of the suite stays on Chromium. Running everything everywhere
    // would mostly measure the Navigation API's uneven support, which is a
    // different question with its own answer in §9b.
    ...MATRIX_ENGINES.map((engine) => ({
      name: `styling ${engine.toLowerCase()}`,
      testMatch: MATRIX_SPEC,
      use: devices[`Desktop ${engine}`],
    })),
  ],
});
