import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'results/**', 'supabase/functions/**/_shared/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The core is pure: no DOM, no storage, no network. Workbook bytes never leave the browser.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/core is pure: no network.' },
        { name: 'XMLHttpRequest', message: 'src/core is pure: no network.' },
        { name: 'WebSocket', message: 'src/core is pure: no network.' },
        { name: 'window', message: 'src/core has no DOM.' },
        { name: 'document', message: 'src/core has no DOM.' },
        { name: 'localStorage', message: 'src/core has no storage.' },
        { name: 'indexedDB', message: 'src/core has no storage.' },
      ],
    },
  },
);
