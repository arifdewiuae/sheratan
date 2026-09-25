import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Exactly what `controls/react` serves with, because the reference exists to
  // be served the way the arm is. HMR is off for the same reason it is off
  // there: a reload landing mid-assertion is how a dev server turns a hidden
  // suite flaky, and leaving it on for one arm makes the two differently live.
  server: { hmr: false },
  plugins: [react()],
});
