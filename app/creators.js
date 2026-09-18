// VIEW 5 · PAN-CREATOR ARCHIVES, extracted out of initApp() in ledger-app.js.
//
// directorsPantheon/authorsPantheon/gamingAuteurs are already globals (data/creators.js, loaded
// before this file), and esc/KM/themeColor are already globals (app/cards.js). The corpus (ALL)
// and the DOM helpers ($/$$) are declared inside initApp(), so worksFor/creatorCard/renderCreators
// take them as explicit parameters instead of closing over them. state is only read by
// renderCreators (for the active tab/search/sort), so it is the one that takes it.
'use strict';

function worksFor(name,ALL){return ALL.filter(x=>x.creator.includes(name)).sort((a,b)=>b.crit-a.crit);}
function creatorCard(c,tab,ALL){const isDir=tab===true||tab==='directors';const isAuthor=tab==='authors';const isAuteur=tab==='auteurs'||tab===false;const works=worksFor(c.name,ALL);const accent=isDir?'#a78bfa':(isAuthor?'#4ade80':'#fbbf24');
 const frontLabel=isDir?'Director · Pantheon':(isAuthor?'Author · Pantheon':'Gaming Auteur');
 const sigField=isAuteur?c.designPhilosophy:c.visualSignature;
 const backSigLabel=isDir?'Visual Signature':(isAuthor?'Prose & Vision':'Design Philosophy');
 const ownedN=works.filter(function(w){return w.owned;}).length;
 const ownedPct=works.length?Math.round(ownedN/works.length*100):0;
 const front='<div class="flip-face absolute inset-0 panel p-4 flex flex-col">'
  +'<div class="flex items-start justify-between gap-2"><div class="min-w-0"><div class="lbl">'+frontLabel+'</div><div class="text-[15px] font-bold text-slate-50 mt-1 leading-tight">'+esc(c.name)+'</div></div>'
  +'<div class="text-right shrink-0"><div class="text-2xl font-extrabold leading-none goatJump cursor-pointer" data-q="'+esc(c.name)+'" title="View all of '+esc(c.name)+'’s works in the Global Controller" style="color:'+accent+'">'+works.length+'</div><div class="lbl mt-1">on ledger</div></div></div>'
  +'<div class="flex flex-wrap gap-1.5 mt-3">'+c.activeEras.map(e=>'<span class="chip">'+esc(e)+'</span>').join('')+'</div>'
  +(works.length?'<div class="flex items-center gap-1.5 mt-2 text-[10.5px]" title="'+ownedN+' of '+works.length+' ledger works owned"><div class="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden"><div style="width:'+ownedPct+'%;height:100%;background:'+accent+'"></div></div><span class="text-slate-400 tabular-nums shrink-0">'+ownedPct+'% owned</span></div>':'')
  +'<p class="text-[11px] text-slate-400 mt-3 leading-relaxed clamp4">'+esc(sigField)+'</p>'
  +'<div class="mt-auto pt-2 flex items-center justify-between text-[9px] tracking-[.22em] uppercase text-slate-600"><span>Click to flip &#10227;</span>'+(works.length?'<span class="goatJump cursor-pointer hover:text-teal-400 normal-case tracking-normal" data-q="'+esc(c.name)+'" title="View all of '+esc(c.name)+'’s works in the Global Controller">View in Controller →</span>':'')+'</div></div>';
 const back='<div class="flip-face flip-back absolute inset-0 panel p-4 flex flex-col" style="border-color:'+accent+'40">'
  +'<div class="lbl">'+backSigLabel+'</div>'
  +'<p class="text-[10.5px] text-slate-300 mt-1 leading-relaxed">'+esc(sigField)+'</p>'
  +'<div class="lbl mt-2">Core Themes</div><div class="flex flex-wrap gap-1 mt-1">'+c.primaryThemes.slice().sort((a,b)=>a.localeCompare(b)).map(t=>{const tc=themeColor(t);return '<span class="chip" style="color:'+tc+';background:'+tc+'1f;border-color:'+tc+'66;font-weight:600">'+esc(t)+'</span>';}).join('')+'</div>'
  +'<div class="lbl mt-2">Ledger Entries ('+works.length+')</div>'
  +'<div class="mt-1 flex-1 overflow-y-auto pr-1 space-y-1">'+(works.length?works.map(w=>{const k=KM[w.kind];
    return '<div class="flex items-center gap-2 text-[11px] goatJump cursor-pointer hover:bg-slate-800/30 rounded px-1 -mx-1" data-q="'+esc(w.title)+'" title="Open '+esc(w.title)+' in the Global Controller"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span><span class="flex-1 truncate text-slate-200 hover:text-teal-300">'+esc(w.title)+'</span><span class="text-slate-500 tabular-nums">'+w.year+'</span><span class="tabular-nums font-semibold" style="color:'+k.c+'">'+w.crit+'</span></div>';}).join(''):'<div class="text-[11px] text-slate-500">No direct credits indexed.</div>')+'</div></div>';
 return '<div class="flip h-[300px] select-none cursor-pointer" role="button" tabindex="0" aria-label="Flip card for '+esc(c.name)+'"><div class="flip-inner">'+front+back+'</div></div>';
}
const CREATOR_TOTAL=directorsPantheon.length+authorsPantheon.length+gamingAuteurs.length;
function sortCreatorPairs(pairs,sortMode,ALL){
 if(sortMode==='az')return pairs.slice().sort(function(a,b){return a[0].name.localeCompare(b[0].name);});
 if(sortMode==='works')return pairs.slice().sort(function(a,b){return (worksFor(b[0].name,ALL).length)-(worksFor(a[0].name,ALL).length);});
 return pairs;
}
function renderCreators(state,ALL,$,$$){const tab=state.creatorTab;
 const q=(state.creatorSearch||'').trim().toLowerCase();
 const scope=state.creatorSearchScope||'all';
 const sortMode=state.creatorSort||'default';
 var grid=$('#creatorGrid');
 if(q){
  // search across ALL pantheons by default, tagging each with its tab type -- optionally scoped
  // to just one pantheon via the search-scope segmented control.
  var all=directorsPantheon.map(c=>[c,'directors']).concat(authorsPantheon.map(c=>[c,'authors'])).concat(gamingAuteurs.map(c=>[c,'auteurs']));
  if(scope!=='all')all=all.filter(function(pair){return pair[1]===scope;});
  var hits=sortCreatorPairs(all.filter(function(pair){return pair[0].name.toLowerCase().indexOf(q)>=0;}),sortMode,ALL);
  grid.innerHTML=hits.length?hits.map(function(pair){return creatorCard(pair[0],pair[1],ALL);}).join(''):'<div class="col-span-full text-center text-slate-500 text-sm py-10">No creator matches “'+esc(q)+'”.</div>';
  var cc=$('#creatorSearchCount');if(cc)cc.textContent=hits.length+' of '+(scope==='all'?CREATOR_TOTAL:all.length)+' creators';
  return;
 }
 var cc=$('#creatorSearchCount');if(cc)cc.textContent='';
 const data=tab==='directors'?directorsPantheon:(tab==='authors'?authorsPantheon:gamingAuteurs);
 const pairs=sortCreatorPairs(data.map(function(c){return [c,tab];}),sortMode,ALL);
 grid.innerHTML=pairs.map(function(pair){return creatorCard(pair[0],pair[1],ALL);}).join('');
 $$('#creatorSeg button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
}
