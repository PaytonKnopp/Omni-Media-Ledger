// VIEW 4 · REFERENCE MATRICES, extracted out of initApp() in ledger-app.js.
//
// matrixRow/slugify (app/cards.js) and esc/KM (also app/cards.js) are already pure and global.
// $ and $$ are declared inside initApp() (they close over `document`, nothing else), so
// renderMatrixNav/renderMatrices take them as explicit parameters rather than assuming a global
// that does not exist at this file's load time.
//
// MATRIX_TITLES/matrixOwnedOnly/matrixNavQ used to be `var`s local to initApp(); moving their
// declarations here with the functions that read/write them keeps that the same single copy:
// initApp() is only ever called once (see ARCHITECTURE.md "Boot sequence"), so a `var` at the top
// level of a classic <script> is as global as one declared inside initApp() used to be, and every
// other place in ledger-app.js that reads or sets matrixOwnedOnly/matrixNavQ (the checkbox/search
// handlers, scheduleURLSync, paramsToState, applyStateToStaticControls) keeps working unchanged.
//
// renderMatrices() also reads the corpus, so it takes `ALL` as a parameter rather than closing
// over it.
'use strict';

// MATRIX_TITLES was being collected every render and never read anywhere -- the quick-jump nav
// below is what that collection was clearly meant to drive; with 20 independently-scrolling
// panels on one page there was previously no way to reach e.g. "Scariest" without scrolling past
// 19 others first.
var MATRIX_TITLES=[];
var matrixOwnedOnly=false;
var matrixNavQ='';
function matrixBlock(title,sub,arr,colFn,heads,fullCount){
 if(MATRIX_TITLES.indexOf(title)<0)MATRIX_TITLES.push(title);
 var shown=matrixOwnedOnly?arr.filter(function(x){return x.owned;}):arr;
 var capped=!matrixOwnedOnly&&fullCount>arr.length;
 var countLabel=shown.length+(matrixOwnedOnly?' owned':capped?' of '+fullCount+' qualify':' qualify');
 return '<div class="panel overflow-hidden fade-in" id="mx-'+slugify(title)+'"><div class="px-4 pt-4 pb-3 border-b border-slate-800/70">'
 +'<div class="flex items-baseline justify-between gap-2"><h3 class="text-[12px] font-bold tracking-[.14em] text-slate-100 uppercase">'+title+'</h3><span class="chip">'+countLabel+'</span></div>'
 +'<p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">'+sub+'</p>'
 +'<div class="flex flex-wrap justify-end gap-2 sm:gap-2.5 mt-2.5">'+heads.map(h=>'<span class="lbl w-14 sm:w-24 text-right">'+h+'</span>').join('')+'</div></div>'
 +'<div class="matrixScroll max-h-[460px] overflow-y-auto">'+(shown.length?shown.map((it,i)=>matrixRow(it,i,colFn(it))).join(''):'<div class="px-4 py-6 text-center text-slate-500 text-[12px]">None of these are in your collection yet.</div>')+'</div></div>';
}
function renderMatrixNav($){
 var el=$('#matrixNav');if(!el)return;
 var q=(matrixNavQ||'').trim().toLowerCase();
 var titles=q?MATRIX_TITLES.filter(function(t){return t.toLowerCase().indexOf(q)>=0;}):MATRIX_TITLES;
 el.innerHTML=titles.length?titles.map(function(t){var label=t.replace(/&amp;/g,'&').replace(/&ge;/g,'≥').replace(/&le;/g,'≤');
  var slug=slugify(t);var panel=document.getElementById('mx-'+slug);var chip=panel?panel.querySelector('.chip'):null;var countLabel=chip?chip.textContent:'';
  return '<a href="#mx-'+slug+'" class="matrixNavLink text-[10.5px] px-2.5 py-1 rounded-lg border border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-300 transition-colors whitespace-nowrap flex items-center gap-1.5" data-anchor="mx-'+slug+'">'+label+(countLabel?'<span class="text-slate-600">·</span><span class="tabular-nums'+(matrixOwnedOnly?' text-emerald-400':'')+'">'+countLabel+'</span>':'')+'</a>';}).join('')
  :'<div class="text-[11px] text-slate-500 px-1 py-1">No brackets match “'+esc(q)+'”.</div>';
}
function renderMatrices(ALL,$,$$){
 MATRIX_TITLES=[];
 const ref=ALL.filter(x=>x.kind!=='game'&&x.fid[0][1]>=94&&x.fid[1][1]>=90).sort((a,b)=>(b.fid[0][1]+b.fid[1][1]+b.fid[2][1])-(a.fid[0][1]+a.fid[1][1]+a.fid[2][1]));
 const dread=ALL.filter(x=>x.dread>=90).sort((a,b)=>b.dread-a.dread);
 const myst=ALL.filter(x=>x.myst>=90).sort((a,b)=>b.myst-a.myst);
 const eldritch=ALL.filter(x=>x.ch>=78).sort((a,b)=>(b.ch-a.ch)||(b.dread-a.dread));
 const western=ALL.filter(x=>x.fam.indexOf('Western')>=0).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr));
 const war=ALL.filter(x=>x.fam.indexOf('War')>=0).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr));
 $('#matrixWrap').innerHTML=
  // Reference Matrices' brackets are listed alphabetically by title (icon/emoji ignored) so
  // they're easy to scan in order, both in this DOM/nav-building sequence and in the jump-to-
  // bracket pill nav that reads MATRIX_TITLES in this same push order (see matrixBlock/renderMatrixNav).
  matrixBlock('📀 4K Physical UHD Reference Tier','Disc-pushing transfers and object-audio mixes for calibrated HDR rigs. Films &amp; series with Transfer &ge; 94 and Audio &ge; 90.',ref,it=>[[it.fid[0][1],'#818cf8'],[it.fid[1][1],'#7dd3fc'],[it.fid[2][1],'#c4b5fd']],['Transfer','Audio','Cinema'])
  +matrixBlock('🎨 Aesthetic Beauty','Sheer visual/production beauty — the works most striking to simply look at. Beauty index ≥ 84.',ALL.filter(x=>x.beauty>=84).sort((a,b)=>(b.beauty-a.beauty)||(b.crit-a.crit)),it=>[[it.beauty,'#fda4af'],[it.crit,'#94a3b8']],['Beauty','Critic'])
  +matrixBlock('🕳 Atmospheric Isolation &amp; Cosmic Dread','High-tension slow-burns across every medium. Dread / Immersion Index &ge; 90.',dread,it=>[[it.dread,'#fb7185'],[it.tech,'#818cf8']],['Dread','Tech'])
  +matrixBlock('🤠 Best Western &amp; Frontier','Gunfighters, open ranges, dark Americana and the closing of the frontier — ranked by match. Western family, top of the bracket.',western.slice(0,24),it=>[[it.gm,'#d97706'],[it.ovr,'#94a3b8']],['Match','Overall'],western.length)
  +matrixBlock('🎭 Bravura Performances','Career-defining acting and voice work — the roles that carry their whole piece. Performance index ≥ 88.',ALL.filter(x=>x.perf>=88).sort((a,b)=>b.perf-a.perf),it=>[[it.perf,'#f472b6'],[it.crit,'#94a3b8']],['Perf','Critic'])
  +matrixBlock('😴 Comfort &amp; Warmth','Rainy-Sunday companions — the cozy, humane, restorative works to return to. Comfort index ≥ 74.',ALL.filter(x=>x.cozy>=74).sort((a,b)=>b.cozy-a.cozy),it=>[[it.cozy,'#fbbf24'],[it.aud,'#94a3b8']],['Comfort','Audience'])
  +matrixBlock('🌌 Cosmic Awe &amp; Sense of Wonder','Vastness, transcendence, the sublime — works that make you feel small before something immense. Awe index ≥ 88.',ALL.filter(x=>x.awe>=88).sort((a,b)=>b.awe-a.awe),it=>[[it.awe,'#38bdf8'],[it.myst,'#34d399']],['Awe','Mind'])
  +matrixBlock('◉ Eldritch Cosmic Horror Canon','The void looks back: indifferent universes, unknowable entities, sanity under siege. Cosmic Horror Index &ge; 78 — anchored to your declared canon.',eldritch,it=>[[it.ch,'#c084fc'],[it.dread,'#fb7185']],['Mind','Critic'])
  +matrixBlock('🔁 Endlessly Rewatchable','Comfort-food favorites you would happily return to any night — low-friction, high-reward. Rewatchability index ≥ 78.',ALL.filter(x=>x.rewatch>=78).sort((a,b)=>(b.rewatch-a.rewatch)||(b.aud-a.aud)),it=>[[it.rewatch,'#5eead4'],[it.aud,'#94a3b8']],['Rewatch','Audience'])
  +matrixBlock('⚡ Genuine Shock &amp; The Twist','Gut-punch reveals and moments that rewrite everything before them. Shock index ≥ 80.',ALL.filter(x=>x.shock>=80).sort((a,b)=>b.shock-a.shock),it=>[[it.shock,'#fb923c'],[it.crit,'#94a3b8']],['Shock','Critic'])
  +matrixBlock('🫂 Genuine Warmth &amp; Humanity','The tender, generous, deeply humane works — kindness rendered with real craft. Warmth index ≥ 78.',ALL.filter(x=>x.warmth>=78).sort((a,b)=>(b.warmth-a.warmth)||(b.aud-a.aud)),it=>[[it.warmth,'#fdba74'],[it.aud,'#94a3b8']],['Warmth','Audience'])
  +matrixBlock('🌍 Grounded &amp; Realistic','Life as it is, not stylized — plausible situations and real-world stakes, no genre gloss. Realism index ≥ 80.',ALL.filter(x=>x.real>=80).sort((a,b)=>(b.real-a.real)||(b.crit-a.crit)),it=>[[it.real,'#d4d4d8'],[it.crit,'#94a3b8']],['Real','Critic'])
  +matrixBlock('⚛ Hard Science &amp; Big Ideas','Rigorous, idea-dense works — physics, cosmology, deep systems, real intellectual heft. Scientific index ≥ 80.',ALL.filter(x=>x.sci>=80).sort((a,b)=>b.sci-a.sci),it=>[[it.sci,'#22d3ee'],[it.myst,'#34d399']],['Science','Mind'])
  +matrixBlock('🏛 Historical Weight &amp; True Stories','Meticulously grounded history — the real events, rendered with rigor. Historical-accuracy index ≥ 72.',ALL.filter(x=>x.hist>=72).sort((a,b)=>b.hist-a.hist),it=>[[it.hist,'#a3e635'],[it.real,'#86efac']],['History','Real'])
  +matrixBlock('🗿 Iconic &amp; Culture-Defining','The landmarks — works that shaped the medium and lodged in the collective memory. Iconic index ≥ 84.',ALL.filter(x=>x.icon>=84).sort((a,b)=>(b.icon-a.icon)||(b.crit-a.crit)),it=>[[it.icon,'#fcd34d'],[it.crit,'#94a3b8']],['Iconic','Critic'])
  +matrixBlock('🧩 Mind-Bending Puzzles &amp; Ontological Mysteries','Structural labyrinths, recursive timelines, bottomless systems. Complexity &ge; 90.',myst,it=>[[it.myst,'#34d399'],[it.crit,'#94a3b8']],['Mind','Critic'])
  +matrixBlock('🌀 Reality-Bending &amp; Surreal','Dream logic, unreliable realities, the floor dropping out — works that warp perception. Reality-warp index ≥ 82.',ALL.filter(x=>x.reality>=82).sort((a,b)=>b.reality-a.reality),it=>[[it.reality,'#a78bfa'],[it.myst,'#34d399']],['Warp','Mind'])
  +matrixBlock('💀 Scariest — Pure Horror','Dread made physical — the works that get under your skin and stay there. Scare index ≥ 82.',ALL.filter(x=>x.scary>=82).sort((a,b)=>b.scary-a.scary),it=>[[it.scary,'#f87171'],[it.dread,'#fb7185']],['Scare','Dread'])
  +matrixBlock('♫ Soundtrack &amp; Audio Hall','Reference scores and sound design — the works that justify the speakers. Soundtrack index &ge; 90.',ALL.filter(x=>x.snd>=90).sort((a,b)=>b.snd-a.snd),it=>[[it.snd,'#7dd3fc'],[it.ref,'#818cf8']],['Audio','4K'])
  +matrixBlock('💧 Tearjerker &amp; Emotional Gut-Punch','Bring tissues — the most devastating, moving works across every medium. Emotional index ≥ 86.',ALL.filter(x=>x.emo>=86).sort((a,b)=>b.emo-a.emo),it=>[[it.emo,'#f0abfc'],[it.crit,'#94a3b8']],['Emotion','Critic'])
  +matrixBlock('⚔ War &amp; Valor','The chaos, cost and brotherhood of combat — from the trenches to the beaches. War family, ranked by match.',war.slice(0,24),it=>[[it.gm,'#a3a3a3'],[it.real,'#86efac']],['Match','Real'],war.length)
  +matrixBlock('😀 Wit &amp; Comedy Peak','The sharpest, funniest works across every medium — satire, farce, and perfect timing. Comedy index ≥ 74.',ALL.filter(x=>x.funny>=74).sort((a,b)=>b.funny-a.funny),it=>[[it.funny,'#fde047'],[it.aud,'#94a3b8']],['Funny','Audience']);
 renderMatrixNav($);
 var q=(matrixNavQ||'').trim().toLowerCase();
 if(q){$$('#matrixWrap > .panel').forEach(function(p){var h3=p.querySelector('h3');var match=h3&&h3.textContent.toLowerCase().indexOf(q)>=0;p.classList.toggle('hidden',!match);});}
}
