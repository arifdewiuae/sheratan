// Shared ESLint flat config. Every rule here backs a line in AGENTS.md; a rule
// that is not written down there does not belong here, and the reverse.

import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts'];
const JS_FILES = ['**/*.js'];
const TEST_FILES = ['**/test/**', '**/*.test.ts'];
const RUNTIME_FILES = ['packages/core/src/**'];

// Limits that keep functions readable (AGENTS.md "Functions").
const MAX_COMPLEXITY = 10;
const MAX_FUNCTION_LINES = 50;
const MAX_DEPTH = 3;
const MAX_PARAMS = 4;
const MAX_FILE_LINES = 400;

const MULTILINE = ['multiline-block-like', 'multiline-expression', 'multiline-const', 'multiline-let'];

/** Blank lines between logical steps, enforced rather than remembered. */
const spacing = [
  'error',
  { blankLine: 'always', prev: 'directive', next: '*' },
  { blankLine: 'always', prev: 'import', next: '*' },
  { blankLine: 'any', prev: 'import', next: 'import' },
  { blankLine: 'always', prev: ['const', 'let'], next: '*' },
  { blankLine: 'any', prev: ['singleline-const', 'singleline-let'], next: ['singleline-const', 'singleline-let'] },
  { blankLine: 'always', prev: '*', next: MULTILINE },
  { blankLine: 'always', prev: MULTILINE, next: '*' },
  { blankLine: 'always', prev: 'block-like', next: '*' },
  { blankLine: 'always', prev: '*', next: ['return', 'throw'] },
  { blankLine: 'always', prev: ['function', 'class', 'export'], next: '*' },
];

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/node_modules/**', 'site/**', 'Docs/**']),

  // Legacy JavaScript runtime and its hand-written declarations, replaced by
  // the TypeScript port. Remove this entry in the change that deletes them.
  globalIgnores(['packages/core/src/**/*.js', 'packages/core/src/index.d.ts', 'packages/core/test/**/*.js']),

  js.configs.recommended,

  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    braceStyle: '1tbs',
    arrowParens: true,
    commaDangle: 'always-multiline',
  }),

  {
    name: 'sheratan/base',
    rules: {
      '@stylistic/padding-line-between-statements': spacing,
      '@stylistic/max-statements-per-line': ['error', { max: 1 }],
      '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false }],

      'curly': ['error', 'multi-line', 'consistent'],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'no-nested-ternary': 'error',
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',

      'complexity': ['error', MAX_COMPLEXITY],
      'max-depth': ['error', MAX_DEPTH],
      'max-params': ['error', MAX_PARAMS],
      'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    name: 'sheratan/typescript',
    files: TS_FILES,
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      jsdoc.configs['flat/recommended-typescript-error'],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-magic-numbers': ['error', {
        ignore: [-1, 0, 1],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreEnums: true,
        ignoreNumericLiteralTypes: true,
        ignoreReadonlyClassProperties: true,
        ignoreTypeIndexes: true,
        enforceConst: true,
      }],

      // Every exported symbol is documented: the generated .d.ts is what
      // editors and agents read. Obvious parameters need no @param line.
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        require: { FunctionDeclaration: true, ClassDeclaration: true, ArrowFunctionExpression: true },
        contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'ExportNamedDeclaration > VariableDeclaration'],
      }],
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
    },
  },

  {
    name: 'sheratan/runtime',
    files: RUNTIME_FILES,
    rules: {
      // SPEC A4: the runtime has zero dependencies, so it imports only itself.
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^(?!\\.{1,2}/)', message: 'Runtime code imports only relative modules (SPEC A4: zero runtime dependencies).' }],
      }],
    },
  },

  {
    name: 'sheratan/tests',
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'jsdoc/require-jsdoc': 'off',
    },
  },

  {
    name: 'sheratan/config-files',
    files: JS_FILES,
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },
);
