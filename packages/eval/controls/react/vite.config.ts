import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Hot module replacement is off, and not as a preference. It is the parity
    // match for the Sheratan arm's `--no-reload`: a reload landing mid-
    // assertion is how a dev server turns a hidden suite flaky. The harness
    // proxy routes a non-backend upgrade here rather than to `evalkit`, so
    // leaving HMR on would not break the run — it would just make the two arms
    // differently live, which EVAL-TASKS §1.1 is there to prevent.
    hmr: false,
  },
  plugins: [react()],
});
