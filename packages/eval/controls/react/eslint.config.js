// What EVAL-TASKS §1.2 calls clean for this arm, first half: "eslint
// (recommended + react-hooks)". Nothing beyond what the table names — an arm
// judged on more rules than the protocol says is an arm judged unfairly.
//
// "Recommended" for a TypeScript project means `js.configs.recommended` plus
// `tseslint.configs.recommended`, which is what typescript-eslint's own
// getting-started page hands you. The second is not an extra: without it the
// core `no-unused-vars` fires on every parameter of every interface method,
// because it is reading a type declaration as code. The *type-checked* sets
// are deliberately not enabled — `tsc --noEmit` is the other half of clean,
// and it is the one the table names for types.

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
