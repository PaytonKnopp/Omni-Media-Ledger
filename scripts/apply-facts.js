#!/usr/bin/env node
/*
 * Applies an evidence file from scripts/fetch-facts.js to the corpus.
 *
 * This is the only script in the repo allowed to change a factual value in data/, and it is
 * deliberately narrow:
 *
 *   - it applies grade A `proposed-change` proposals and nothing else. Grade B goes to the review
 *     queue for a human; grade C is never produced in the first place.
 *   - it edits by exact-match replacement scoped to the record's OWN line, and refuses if the old
 *     value does not appear there exactly once. A rewrite that cannot find what it is replacing is
 *     a bug, not an edge case.
 *   - it stamps prov on every record it touches AND on every record whose facts came back fully
 *     confirmed, because a confirmed record is exactly the thing the stamp exists to record.
 *   - it is a dry run unless you pass --write.
 *
 * The stamp it writes is the one validate-corpus.js enforces:
 *   prov:{facts:"sourced",checked:"YYYY-MM-DD",src:"OMDb+TMDB",indices:"unscored"}
 * `indices` stays "unscored" here on purpose. Sourcing a runtime says nothing about whether the
 * work's atmosphericDreadIndex was scored against RUBRIC.md; conflating the two would let a
 * fact-check quietly certify a judgement nobody made.
 *
 * USAGE
 *   node scripts/apply-facts.js evidence/movie-2026-09-05.json            # dry run
 *   node scripts/apply-facts.js evidence/movie-2026-09-05.json --write
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { FACT_FIELDS } = require('./fetch-facts.js');

const FILES = {
  movie: 'data/movies.js', tv: 'data/tv.js', game: 'data/games.js', book: 'data/books.js',
};

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--'));
  const WRITE = argv.includes('--write');
  if (!file) { console.error('usage: apply-facts.js <evidence.json> [--write]'); process.exit(2); }

  const ev = JSON.parse(fs.readFileSync(file, 'utf8'));
  const medium = ev.medium;
  if (!FILES[medium]) { console.error('evidence file names an unknown medium: ' + medium); process.exit(2); }
  const dataPath = path.join(ROOT, FILES[medium]);
  let text = fs.readFileSync(dataPath, 'utf8');
  const pathOf = Object.fromEntries(FACT_FIELDS[medium].map(f => [f.key, f.corpusPath]));

  const applied = [], refused = [], stamped = [];
  const checked = new Date().toISOString().slice(0, 10);

  for (const w of ev.works) {
    const lineRe = new RegExp('^.*"id"\\s*:\\s*"' + w.id + '".*$', 'm');
    const m = text.match(lineRe);
    if (!m) { refused.push(w.id + ': no record line found'); continue; }
    let line = m[0];
    const before = line;

    const changes = w.proposals.filter(p => p.grade === 'A' && p.status === 'proposed-change' && !p._held);
    let ok = true;
    for (const p of changes) {
      const cp = pathOf[p.field];
      if (!cp || cp.includes('.')) { refused.push(w.id + '.' + p.field + ': not a top-level field'); ok = false; continue; }
      const needle = '"' + cp + '":' + JSON.stringify(p.current);
      const hits = line.split(needle).length - 1;
      if (hits !== 1) {
        refused.push(w.id + '.' + p.field + ': expected `' + needle + '` exactly once on the record line, found ' + hits);
        ok = false; continue;
      }
      line = line.replace(needle, '"' + cp + '":' + JSON.stringify(p.proposed));
      applied.push(w.id + '.' + p.field + ': ' + JSON.stringify(p.current) + ' -> ' + JSON.stringify(p.proposed) +
        '  [' + p.sources.map(s => s.src).join('+') + ']');
    }
    if (!ok) continue;

    // A record earns a "sourced" stamp when every HARD fact a catalogue can settle came back
    // either confirmed or corroborated-and-corrected AT GRADE A. Soft fields are excluded
    // deliberately: studio, publisher, network and platform lists are naming conventions, and they
    // can never reach grade A by construction, so counting them would mean no record is ever
    // stampable.
    //
    // Two statuses resolve a field WITHOUT a human but do not, on their own, mean two sources
    // corroborated it:
    //   corroborated-by-one   sources disagreed with each other, but the corpus already matches
    //                         one of them exactly -- the other source is simply wrong. Not an open
    //                         question, but also not two-source proof; it does not upgrade a
    //                         record to "sourced" by itself, it just stops blocking one.
    //   edition-dependent     the field has no single true value to begin with (a runtime that
    //                         genuinely differs by cut), the evidence says so, and reconcile()
    //                         recorded which cut the corpus's own number does and does not match.
    //                         That is a complete, honest answer -- "we checked, and it depends on
    //                         the copy" -- not a gap, so a record where every OTHER field is fully
    //                         sourced and the only open item is a field like this earns
    //                         "edition-dependent" rather than sitting unstamped forever.
    // `_held` is not something reconcile() ever produces -- it is how an operator manually defers
    // a proposal that is honestly grade-A on its own but must not be applied yet for a reason
    // reconcile() cannot see (a corroborated creator-order rewrite that would conflict with a
    // sibling film not yet reprocessed, say). Downgrading only the grade used to be enough to block
    // a stamp, back when "sourced" was the only kind there was; it is not enough now that
    // "edition-dependent" only checks STATUS, not grade -- a held field whose status is still
    // "confirmed" or "proposed-change" would still count as resolved and let a stamp through
    // anyway. A held field has to make the WHOLE record fail "everything is resolved," not just
    // fail to contribute a correction of its own -- so it stays in `settled` (it is still an open
    // question) but can never itself satisfy either resolved check.
    const settled = w.proposals.filter(p => p.status !== 'no-source' && !p.soft);
    const allSourced = settled.length > 0 &&
      settled.every(p => !p._held && (p.status === 'confirmed' || p.status === 'proposed-change') && p.grade === 'A');
    const RESOLVED_NO_HUMAN = new Set(['confirmed', 'proposed-change', 'corroborated-by-one', 'edition-dependent']);
    const allResolved = settled.length > 0 && settled.every(p => !p._held && RESOLVED_NO_HUMAN.has(p.status));
    const hasEditionDependent = settled.some(p => !p._held && p.status === 'edition-dependent');
    const facts = allSourced ? 'sourced' : (allResolved && hasEditionDependent ? 'edition-dependent' : null);

    if (facts) {
      const stamp = '"prov":{"facts":"' + facts + '","checked":"' + checked + '","src":"' +
        (w.sourcesReached || []).join('+') + '","indices":"unscored"}';
      if (/"prov"\s*:/.test(line)) {
        line = line.replace(/"prov"\s*:\s*\{[^}]*\}/, stamp);
      } else {
        const at = line.lastIndexOf('}');
        if (at < 0) { refused.push(w.id + ': cannot find the record\'s closing brace to stamp'); continue; }
        line = line.slice(0, at) + ',' + stamp + line.slice(at);
      }
      stamped.push(w.id + (facts === 'edition-dependent' ? ' (edition-dependent)' : ''));
    }

    if (line !== before) text = text.replace(before, line);
  }

  console.log('\n' + ev.medium + ' evidence from ' + ev.generated + (ev.offline ? ' (offline replay)' : ''));
  console.log('  ' + applied.length + ' grade-A corrections' + (applied.length ? ':' : ''));
  applied.slice(0, 40).forEach(l => console.log('    ' + l));
  if (applied.length > 40) console.log('    ...and ' + (applied.length - 40) + ' more');
  console.log('  ' + stamped.length + ' records stamped' + (stamped.length ? ':' : ''));
  stamped.slice(0, 40).forEach(l => console.log('    ' + l));
  if (stamped.length > 40) console.log('    ...and ' + (stamped.length - 40) + ' more');
  if (refused.length) {
    console.log('  ' + refused.length + ' REFUSED (nothing was written for these):');
    refused.slice(0, 20).forEach(l => console.log('    ' + l));
  }

  if (!WRITE) { console.log('\n  dry run -- pass --write to apply, then run `npm test`.\n'); return; }
  fs.writeFileSync(dataPath, text);
  console.log('\n  wrote ' + FILES[medium] + '. Run `npm run validate-corpus` and `npm test` now.\n');
}

if (require.main === module) main();
