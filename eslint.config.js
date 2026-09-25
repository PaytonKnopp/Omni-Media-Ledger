// Lint config for a no-build, no-module app: everything runs as global <script> tags sharing one
// scope. It's deliberately narrow -- catch real mistakes (typos, unreachable code, duplicate keys),
// not style. Run with `npm run lint`.
//
// no-undef is an error. The names the app's scripts share with each other (esc, KM, ALL, movies...)
// are not listed by hand: they are read from the scripts index.html actually loads, in the order
// it loads them, by parsing each one and collecting its top-level declarations. So a new shared
// function needs no edit here, and a name nothing declares -- a typo -- fails the build instead of
// becoming one more warning in a pile of hundreds.
const fs = require('fs');
const path = require('path');
const espree = require('espree');
const js = require('@eslint/js');
const globals = require('globals');

const ROOT = __dirname;
const PARSE = { ecmaVersion: 2022, sourceType: 'script' };

// Names a classic script adds to the shared global scope, mapped to 'readonly' or 'writable':
// its top-level declarations, plus anything it publishes with `window.NAME = ...` at any depth
// (app/ledger-app.js declares everything inside initApp() and exports what the page and the
// browser suite need that way).
function sharedNames(source) {
  const names = new Map();
  const declared = new Set();
  const program = espree.parse(source, PARSE);
  for (const node of program.body) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.set(node.id.name, 'readonly');
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier') names.set(d.id.name, node.kind === 'const' ? 'readonly' : 'writable');
      }
    }
    names.forEach((_, n) => declared.add(n));
  }
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
        !node.left.computed && node.left.object.type === 'Identifier' && node.left.object.name === 'window' &&
        !names.has(node.left.property.name)) {
      names.set(node.left.property.name, 'writable');
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(program);
  return { names, declared };
}

// Every script index.html runs: local <script src> files plus inline <script> blocks.
function loadedScripts() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    if (src && /^https?:/.test(src)) continue; // CDN libraries: declared below by name
    if (src) out.push({ file: src, source: fs.readFileSync(path.join(ROOT, src), 'utf8') });
    else out.push({ file: null, source: m[2] });
  }
  return out;
}

const scripts = loadedScripts();
const shared = new Map();
const ownNames = {};
for (const s of scripts) {
  const { names, declared } = sharedNames(s.source);
  for (const [n, access] of names) if (shared.get(n) !== 'writable') shared.set(n, access);
  if (s.file) ownNames[s.file] = declared;
}
const asGlobals = (exclude) => Object.fromEntries(
  [...shared].filter(([n]) => !(exclude && exclude.has(n))));

const cdnGlobals = {
  supabase: 'readonly', // @supabase/supabase-js UMD
  Chart: 'readonly', // Chart.js UMD
};

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...cdnGlobals },
    },
    rules: {
      'no-unused-vars': 'off', // legacy single-scope app; too noisy to be useful yet
      'no-undef': 'error',
    },
  },
  // Each app script sees every other script's top-level names, but not its own (declaring a
  // file's own names as globals would trip no-redeclare).
  ...Object.keys(ownNames).filter(f => f.startsWith('app/')).map(file => ({
    files: [file],
    languageOptions: { globals: asGlobals(ownNames[file]) },
  })),
  {
    files: ['scripts/**/*.js', 'test/**/*.js', 'eslint.config.js', 'tailwind.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // These drive the real app in a browser, and the bodies of their page.evaluate(() => ...)
    // callbacks run in the page, where the app's shared names are in scope.
    files: ['test/regression.js', 'scripts/cold-start-test.js', 'scripts/score-snapshot.js', 'scripts/rec-quality.js', 'scripts/update-pk-sample.js'],
    languageOptions: { globals: { ...globals.browser, ...asGlobals() } },
  },
  {
    files: ['sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // A fixed sleep in the browser suite is a race against the runner's speed, and ~150 of them
    // were why the suite failed a different way on most CI runs. Wait on the app instead:
    // settle(page), waitForBoot(page) or readWhen(...) (see ARCHITECTURE.md). The rare sleep that
    // genuinely needs real time to pass carries an eslint-disable-next-line saying why.
    files: ['test/regression.js'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='waitForTimeout']",
        message: 'No fixed sleeps in the regression suite: use settle(page), waitForBoot(page) or readWhen(...).',
      }],
    },
  },
  {
    ignores: ['node_modules/**', 'data/**', 'evidence/**'],
  },
];
