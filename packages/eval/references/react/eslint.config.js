// The same configuration `controls/react` is held to, because this tree is
// checked with the arm's own `clean` commands — `eslint .` then `tsc --noEmit`.
// A reference that passed a laxer bar than the arm would be proving the suites
// against an app the arm could not have written.

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
);
