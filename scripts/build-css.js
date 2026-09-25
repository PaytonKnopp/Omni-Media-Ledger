#!/usr/bin/env node
/*
 * Rebuilds the Tailwind stylesheet compiled into index.html (the <style id="tailwind-css"> block).
 *
 *   npm run build-css            rewrite the block from the current markup and app scripts
 *   npm run check-css            fail if the committed block is not what a rebuild would produce
 *                                (part of `npm run test-fast`, so CI runs it on every pull request)
 *
 * Why this exists: the app has no build step -- the compiled CSS is committed so the page opens
 * from a double-click and offline -- but the stylesheet was generated once and then hand-patched,
 * so utility classes added to the markup afterwards simply did not exist. Nothing errors when that
 * happens; the class just does nothing. The GOAT Profile's stat tiles (grid-cols-3 sm:grid-cols-6)
 * stacked as full-width rows even on desktop, and ~38 other classes were silently inert, until this
 * check made a missing class a failing test instead of something to spot by eye.
 *
 * Dev-only: tailwindcss is a devDependency and is never loaded by the app itself.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const CONFIG = path.join(ROOT, 'tailwind.config.js');
const BLOCK_RE = /(<style id="tailwind-css">)([\s\S]*?)(<\/style>)/;

function compile() {
  let cli;
  try { cli = require.resolve('tailwindcss/lib/cli.js'); }
  catch (e) {
    console.error('tailwindcss is not installed. Run `npm ci` (it is a devDependency) and try again.');
    process.exit(2);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-css-'));
  try {
    const input = path.join(tmp, 'input.css');
    const output = path.join(tmp, 'output.css');
    fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
    execFileSync(process.execPath, [cli, '-c', CONFIG, '-i', input, '-o', output, '--minify'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
      // Browserslist's "caniuse-lite is outdated" notice is noise here: the output is pinned by the
      // exact tailwindcss version in package.json, not by how fresh the local browser data is.
      env: Object.assign({}, process.env, { BROWSERSLIST_IGNORE_OLD_DATA: '1' }),
    });
    return fs.readFileSync(output, 'utf8').trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Every class a stylesheet defines, unescaped (".sm\:grid-cols-6" -> "sm:grid-cols-6"), so a
// mismatch can be reported as the classes involved rather than as two walls of minified CSS.
function classesIn(css) {
  // Declarations first: ".15" in `opacity:.15` is a value, not a class.
  const selectors = css.replace(/\{[^{}]*\}/g, ' ');
  const out = new Set();
  for (const m of selectors.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) out.add(m[1].replace(/\\(.)/g, '$1'));
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(BLOCK_RE);
  if (!m) {
    console.error('index.html has no <style id="tailwind-css"> block to ' + (check ? 'check' : 'rebuild') + '.');
    process.exit(1);
  }
  const committed = m[2].trim();
  const fresh = compile();

  if (check) {
    if (committed === fresh) {
      console.log('Compiled stylesheet is current: every utility class the markup uses is defined (' + classesIn(fresh).size + ' classes).');
      return;
    }
    const have = classesIn(committed), want = classesIn(fresh);
    const missing = [...want].filter(c => !have.has(c)).sort();
    const stale = [...have].filter(c => !want.has(c)).sort();
    console.error('FAIL - the Tailwind stylesheet compiled into index.html is out of date.');
    if (missing.length) console.error('  Used in the markup but missing from the stylesheet (' + missing.length + '): ' + missing.join(', '));
    if (stale.length) console.error('  In the stylesheet but no longer used (' + stale.length + '): ' + stale.join(', '));
    if (!missing.length && !stale.length) console.error('  (Same classes, different rules -- the Tailwind version or config changed.)');
    console.error('  Fix: npm run build-css, then commit index.html.');
    process.exit(1);
  }

  if (committed === fresh) {
    console.log('index.html stylesheet already current (' + classesIn(fresh).size + ' classes); nothing to write.');
    return;
  }
  const before = classesIn(committed), after = classesIn(fresh);
  const added = [...after].filter(c => !before.has(c)).sort();
  const removed = [...before].filter(c => !after.has(c)).sort();
  fs.writeFileSync(INDEX, html.replace(BLOCK_RE, (all, open, body, close) => open + fresh + close));
  console.log('Rebuilt the stylesheet in index.html: ' + after.size + ' classes.');
  if (added.length) console.log('  added (' + added.length + '): ' + added.join(', '));
  if (removed.length) console.log('  removed (' + removed.length + '): ' + removed.join(', '));
}

main();
