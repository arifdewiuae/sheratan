// E2E lives at the app level, never inside a module (SPEC §4 Tests). The same
// specs run against both builds, so the production bundle is proven to behave
// like the development one.

import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const SERVER_TIMEOUT_MS = 30_000;
const isCI = process.env['CI'] !== undefined;

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
    { name: 'dev build', use: devices['Desktop Chrome'] },
    { name: 'prod build', use: devices['Desktop Chrome'] },
  ],
});
