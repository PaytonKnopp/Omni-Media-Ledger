// Pure HTML-string / small-widget builders, extracted out of initApp() in ledger-app.js.
//
// Everything here takes its inputs as plain parameters (an item, a value, a color) and touches
// no state/PERSONAL_PROFILE/DOM-event-binding closure variable, so it is safe to load as an
// ordinary top-level script before app/ledger-app.js -- see ARCHITECTURE.md "Known limits".
// initApp() still calls these by name; being declared at top level just makes them ordinary
// global functions its own closure can see, same as the data/*.js globals.
'use strict';

// Kind metadata (label + accent color), a static lookup with no dependency on the corpus.
const KM={movie:{label:'FILM',c:'#a78bfa'},tv:{label:'TV',c:'#22d3ee'},game:{label:'GAME',c:'#fbbf24'},book:{label:'BOOK',c:'#4ade80'}};

const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// Deterministic color per tag string (a creator's Core Themes, etc.) so a set of tags reads as
// visually distinct from each other at a glance instead of a wall of same-colored chips -- same
// string always lands on the same color, so it's still stable across renders/sessions. Each entry
// is a full hue apart from its neighbors (not just a lightness/saturation tweak on the same violet)
// so a row of themes reads as genuinely different colors, not one tint repeated.
const THEME_PALETTE=['#a78bfa','#38bdf8','#fb7185','#4ade80','#fbbf24','#e879f9','#2dd4bf','#f97316','#818cf8','#facc15','#f472b6','#84cc16','#22d3ee','#ef4444'];
function themeColor(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return THEME_PALETTE[Math.abs(h)%THEME_PALETTE.length];}

// target: a faint inner ring, so the personal match reads as a target (the 🎯 of "GOAT Match").
function ring(v,color,size,target){size=size||42;const r=size/2-4,c=2*Math.PI*r,off=c*(1-Math.max(0,Math.min(100,v))/100);
 return '<svg width="'+size+'" height="'+size+'" class="shrink-0" aria-hidden="true"><circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="#1b2740" stroke-width="3.5"/>'+(target?'<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+(r-5).toFixed(1)+'" fill="none" stroke="'+color+'" stroke-opacity=".35" stroke-width="1"/>':'')+'<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 '+(size/2)+' '+(size/2)+')"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#e2e8f0" font-size="'+Math.round(size*0.3)+'" font-weight="700">'+Math.round(v)+'</text></svg>';}
function microBar(lbl,v,color){return '<div class="flex items-center gap-2"><span class="lbl w-14 shrink-0">'+lbl+'</span><div class="bar flex-1"><i style="width:'+v+'%;background:'+color+'"></i></div><span class="text-[10px] text-slate-400 w-6 text-right tabular-nums">'+v+'</span></div>';}
// The three at-a-glance bars: whichever 3 indices score HIGHEST for THIS SPECIFIC work, out of a
// medium-appropriate candidate pool -- not a fixed set of 3 that's identical across every movie,
// every book, etc. A quiet horror film that's mostly about dread leads with Dread; a soundtrack-
// driven epic leads with Soundtrack; a cosmic-horror game leads with Cosmic. Click the card to see
// the rest (all ~19 indices are still in the expanded detail panel, unchanged).
function frontBars(it){
 var f=it.fid||[];
 var pick=function(name,fb){for(var i=0;i<f.length;i++){if(f[i][0]===name)return f[i][1];}return fb;};
 var shared=[['Awe',it.awe,'#fbbf24'],['Comfort',it.cozy,'#34d399'],['Iconic',it.icon,'#fcd34d'],['Scary',it.scary,'#f87171'],['Real',it.real,'#86efac'],['Reality',it.reality,'#c4b5fd'],['Shock',it.shock,'#fb923c'],['Sci-Fi',it.sci,'#67e8f9'],['Funny',it.funny,'#fde047'],['History',it.hist,'#a3e635'],['Vibe',it.vibe2,'#e879f9'],['Cosmic',it.ch,'#c084fc']];
 var candidates;
 if(it.kind==='game'){
  candidates=[['Art',pick('Art Direction',it.tech),'#818cf8'],['Tension',it.dread,'#fb7185'],['Systems',it.myst,'#34d399']].concat(shared);
 }else if(it.kind==='book'){
  candidates=[['Prose',pick('Prose Craft',it.tech),'#818cf8'],['Ideas',pick('Idea Density',it.tech),'#22d3ee'],['Depth',it.myst,'#34d399'],['Emote',it.emo,'#f0abfc']].concat(shared);
 }else{
  candidates=[['Image',pick('Cinematography',it.tech),'#818cf8'],['Dread',it.dread,'#fb7185'],['Mind',it.myst,'#34d399'],['Sound',it.snd,'#7dd3fc'],['4K Ref',it.ref,'#818cf8'],['Emote',it.emo,'#f0abfc'],['Perf',it.perf,'#fda4af']].concat(shared);
 }
 var top3=candidates.slice().sort(function(a,b){return b[1]-a[1];}).slice(0,3);
 return top3.map(function(c){return microBar(c[0],c[1],c[2]);}).join('');
}
function microBar2(lbl,v){return '<div class="flex items-center gap-2"><span class="lbl w-32 shrink-0">'+lbl+'</span><div class="bar flex-1"><i style="width:'+v+'%;background:#64748b"></i></div><span class="text-[10px] text-slate-300 w-6 text-right tabular-nums">'+v+'</span></div>';}

function slugify(s){return s.replace(/&[a-z]+;/gi,' ').replace(/[^\w\s-]/g,'').trim().toLowerCase().replace(/\s+/g,'-');}

// A single Reference Matrices row -- takes the item, its rank and the [value,color] columns to
// draw, and reads nothing else.
function matrixRow(it,i,cols){const k=KM[it.kind];
 return '<div class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 goatJump cursor-pointer" data-q="'+esc(it.title)+'" title="Open in Global Controller">'
 +'<span class="text-[10px] text-slate-500 w-6 tabular-nums">'+String(i+1).padStart(2,'0')+'</span>'
 +'<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
 +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200" title="'+esc(it.title)+' · '+esc(it.creator)+'">'+esc(it.title)+' <span class="text-slate-500 text-[10px]">'+it.year+'</span>'+(it.owned?' <span style="color:#4ade80;font-size:9px;font-weight:700" title="Owned">✓</span>':'')+'</span>'
 +cols.map(c=>'<span class="flex items-center gap-1 sm:gap-1.5 w-14 sm:w-24 shrink-0"><span class="bar flex-1"><i style="width:'+c[0]+'%;background:'+c[1]+'"></i></span><span class="text-[9.5px] sm:text-[10px] tabular-nums text-slate-400 w-5 text-right">'+c[0]+'</span></span>').join('')
 +'</div>';}
