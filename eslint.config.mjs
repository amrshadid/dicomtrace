// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Imports no layer below the composition root may use. */
const noHostOrUi = [
  {
    group: ['../adapters', '../adapters/*', '../extension'],
    message: 'Only extension.ts wires adapters.',
  },
  {
    group: ['../webview', '../webview/*'],
    message: 'The webview is a separate bundle.',
  },
];

export default defineConfig(
  {
    // Hidden folders hold tool or local state; .github and .vscode contain no JS/TS.
    ignores: ['dist/', 'out/', 'coverage/', 'node_modules/', 'test/fixtures/', '.*/'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', '.vscode-test.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // The functional core and the protocol are pure: no VS Code, no Node I/O, no
    // DOM. Their tsconfig drops Node and DOM types; this rule blocks the imports.
    files: ['src/core/**/*.ts', 'src/protocol/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'core/protocol must stay free of VS Code APIs.' }],
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'os'],
              message: 'core/protocol must not do I/O.',
            },
            ...noHostOrUi,
          ],
        },
      ],
    },
  },
  {
    // The webview is a browser sandbox. It talks to the host only through
    // messages and never reaches into host-side code.
    files: ['src/webview/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'The webview cannot use the VS Code API module.' }],
          patterns: [
            { group: ['node:*'], message: 'The webview runs in a browser.' },
            {
              group: ['../adapters', '../adapters/*', '../extension'],
              message: 'Host code is a separate bundle.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['../webview', '../webview/*'], message: 'The webview is a separate bundle.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
    // Spread the preset's rules: a bare `rules` key would replace them, not merge.
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
