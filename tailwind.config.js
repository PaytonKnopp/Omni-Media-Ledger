// Tailwind config for the stylesheet compiled into index.html (the <style id="tailwind-css"> block).
// Dev-only: the app never loads Tailwind at runtime, so nothing here runs in a browser. Rebuild with
// `npm run build-css`; `npm run test-fast` fails if the committed block no longer matches what this
// produces (scripts/build-css.js --check), so a utility class added to the markup can't silently do
// nothing again.
//
// Content is every file that writes class names -- index.html and the app scripts. The compiled
// block itself is stripped from index.html before scanning: its own selectors would otherwise read
// as "used" and keep every class that ever made it in, however long ago the markup stopped using it.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace(/<style id="tailwind-css">[\s\S]*?<\/style>/, '');

module.exports = {
  content: [
    { raw: html, extension: 'html' },
    path.join(__dirname, 'app/**/*.js'),
  ],
  theme: {
    extend: {
      colors: { obsidian: '#0B0F19', panel: '#0F1626', ink: '#1E293B' },
    },
  },
};
