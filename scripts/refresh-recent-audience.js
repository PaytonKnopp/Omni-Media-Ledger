#!/usr/bin/env node
/*
 * Refreshes IMDb audience scores on film/TV records and lists recent additions whose critic
 * score deserves a second look. Built for the quarterly routine, so scores added by manual
 * sweeps get corrected later instead of staying frozen at their first snapshot.
 *
 * Only records that ALREADY carry audienceSrc {src:"IMDb", id, checked} are touched; the value is
 * replaced outright (never averaged) and `checked` is restamped. Dry run unless --write.
 *
 * USAGE
 *   curl -sL -o r.gz https://datasets.imdbws.com/title.ratings.tsv.gz && gunzip r.gz
 *   node scripts/refresh-recent-audience.js --ratings r [--since 2026-08-21] [--min-change 1] [--write]
 *
 *   --since   only records whose current `checked` date is on/after this day (default: all).
 *             Records first added by a sweep carry that sweep's date, so this selects "added
 *             since the last quarterly refresh".
 *   --min-change  only report/apply changes of at least this many points (default 1).
 *
 * Output also lists "RECHECK CRITIC": works (all four media) whose `prov` is not "sourced" and whose
 * audience check date (film/TV) is in the --since window. Critic scores have no automated source;
 * the routine re-verifies those by search and edits by hand.
 *
 * Information courtesy of IMDb (https://www.imdb.com). Personal and non-commercial use.
 */
'use strict';
const fs=require('fs');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:(process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[i+1]:true);};
const ratingsFile=arg('ratings'),since=arg('since','0000-00-00'),minChange=+arg('min-change',1),write=process.argv.includes('--write');
if(!ratingsFile||ratingsFile===true){console.error('need --ratings <title.ratings.tsv>');process.exit(2);}
const today=new Date().toISOString().slice(0,10);
const rating=new Map();
for(const l of fs.readFileSync(ratingsFile,'utf8').split('\n')){const[c,r]=l.split('\t');if(/^tt\d+$/.test(c))rating.set(c,+r);}
const re=/"audienceScore":(\d+),"audienceSrc":\{"src":"IMDb","id":"(tt\d+)","checked":"(\d{4}-\d{2}-\d{2})"\}/;
let changed=0,seen=0,missing=0;const recheck=[];
for(const f of ['movies','tv']){
  const path='data/'+f+'.js';
  const lines=fs.readFileSync(path,'utf8').split('\n');
  for(let i=0;i<lines.length;i++){
    const m=re.exec(lines[i]);if(!m||m[3]<since)continue;seen++;
    const title=(/"title":"((?:[^"\\]|\\.)*)"/.exec(lines[i])||[])[1];
    if(!/"facts":"sourced"/.test(lines[i]))recheck.push(title);
    const r=rating.get(m[2]);if(r==null){missing++;console.log('  no IMDb rating:',title,m[2]);continue;}
    const nv=Math.round(r*10),old=+m[1];
    if(Math.abs(nv-old)>=minChange){changed++;console.log(`  ${title}: ${old} -> ${nv}`);
      lines[i]=lines[i].replace(re,`"audienceScore":${nv},"audienceSrc":{"src":"IMDb","id":"${m[2]}","checked":"${today}"}`);}
  }
  if(write)fs.writeFileSync(path,lines.join('\n'));
}
console.log(`${seen} IMDb-sourced records in window, ${changed} changed by >=${minChange}, ${missing} without a rating. ${write?'WRITTEN':'dry run (add --write)'}`);
console.log('RECHECK CRITIC (no prov stamp, in window):',recheck.length?recheck.join('; '):'none');
