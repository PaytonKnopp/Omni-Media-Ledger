// Lint config for a no-build, no-module app: everything runs as global <script> tags sharing one
// scope, so this can't use the usual per-module unused-import/undef checks without drowning in
// false positives. It's deliberately narrow -- catch real mistakes (typos, unreachable code,
// duplicate keys), not style. Run with `npx eslint .`.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Loaded as separate <script> tags in index.html; each file references globals the
        // others define, so every top-level name across the app-facing scripts is declared here
        // rather than per-file.
        supabase: 'readonly',
        Chart: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off', // legacy single-scope app; too noisy to be useful yet
      'no-undef': 'warn',
    },
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['node_modules/**', 'data/**', 'evidence/**'],
  },
];
