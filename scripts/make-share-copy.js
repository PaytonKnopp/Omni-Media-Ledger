#!/usr/bin/env node
/*
 * Generates share.html from index.html: the identical engine, corpus, and UI,
 * with every personal default emptied out so nothing of Payton's is baked into
 * the file people receive it from actually sees.
 *
 * index.html is the one file to develop against -- add works, tune the scoring
 * engine, add features, whatever. Run this script afterward to regenerate
 * share.html so both copies stay on the same engine and corpus:
 *
 *   node scripts/make-share-copy.js
 *
 * What gets blanked:
 *   - Every `if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.<field>=<value>;` default
 *     (owned collection, taste weights, watchlist order, etc.) -> empty {}/[]/0.
 *   - goatProfile.declared (the declared-canon chips shown on GOAT Profile) -> [].
 *   - The onboarding gate's "Use the built-in sample profile" option, since
 *     there is no sample profile in this copy -- just Start Blank and Import.
 *
 * What's intentionally NOT touched: goatProfile.recs (the six hand-written
 * "sample data, not personalized" categories -- Directors/Actors/Composers/
 * Cinematographers/Music Artists/YouTube). That's flagged sample content in
 * the UI already; leaving it gives a new person something to look at before
 * they've declared anything of their own. See NOTES.md Phase 4 for why those
 * categories don't (yet) generalize.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, '..', 'share.html');

let html = fs.readFileSync(SRC, 'utf8');
const before = html;

// 1. Blank every default PERSONAL_PROFILE.<field> = <value>; assignment.
let profileFieldsBlanked = 0;
html = html.replace(
  /if\(!PROFILE_FROM_STORAGE\)PERSONAL_PROFILE\.(\w+)=(\{[^;]*\}|\[[^;]*\]|-?\d+(?:\.\d+)?);/g,
  (match, field, value) => {
    profileFieldsBlanked++;
    let empty;
    if (value.startsWith('{')) empty = '{}';
    else if (value.startsWith('[')) empty = '[]';
    else empty = '0';
    return `if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.${field}=${empty};`;
  }
);

// 2. Blank the declared canon shown on GOAT Profile.
const declaredRe = /(const goatProfile=\{\n declared:\[)[\s\S]*?(\n \],\n recs:\[)/;
if (!declaredRe.test(html)) {
  throw new Error('Could not find goatProfile.declared block to blank -- index.html structure changed, update this script.');
}
html = html.replace(declaredRe, '$1$2');

// 3. Remove the "sample profile" option from the onboarding gate (HTML).
const sampleButtonRe = /\s*<button type="button" id="onboardSample"[\s\S]*?<\/button>\n/;
if (!sampleButtonRe.test(html)) {
  throw new Error('Could not find onboardSample button to remove -- index.html structure changed, update this script.');
}
html = html.replace(sampleButtonRe, '\n');
html = html.replace(
  'Nothing is saved here yet. Pick one to get started — you can Export, Import, or Reset later from the Profile controls in the header.',
  'This is a blank copy — nothing is declared or owned yet. Pick one to get started; you can Export, Import, or Reset later from the Profile controls in the header.'
);

// 4. Remove the onboardSample click handler (JS) -- the button no longer exists.
const sampleHandlerRe = /\s*on\('#onboardSample','click',\(\)=>\{[\s\S]*?gate\.classList\.add\('hidden'\);\}\);\n/;
if (!sampleHandlerRe.test(html)) {
  throw new Error('Could not find onboardSample click handler to remove -- index.html structure changed, update this script.');
}
html = html.replace(sampleHandlerRe, '\n');

// 5. Distinguish the browser tab title so the two files are easy to tell apart.
html = html.replace(
  '<title>The Ultimate Omni-Media &amp; Entertainment Ledger</title>',
  '<title>The Ultimate Omni-Media &amp; Entertainment Ledger — Blank Copy</title>'
);

if (html === before) {
  throw new Error('No changes were made -- something is wrong with the replacements above.');
}

fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  PERSONAL_PROFILE fields blanked: ${profileFieldsBlanked}`);
console.log(`  Size: ${(html.length / 1024).toFixed(1)} KB (source: ${(before.length / 1024).toFixed(1)} KB)`);
