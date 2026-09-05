// The Omni-Media Ledger application.
//
// Everything here used to live inside index.html as a <script type="text/plain"> block that was
// read out and injected at runtime. That trick existed for one reason: the app reads the signed-in
// person's profile from localStorage as it initialises, so it must not run until the account has
// been resolved. The cost was steep -- no syntax highlighting, no breakpoints, no usable stack
// traces, and 3,000+ lines wedged into the middle of an HTML file.
//
// Wrapping the same code in initApp() removes the need for that entirely. This loads as an
// ordinary script (so editors and devtools treat it as real JavaScript), defines initApp, and does
// nothing else until account-sync calls it at exactly the moment the injection used to happen.
// Same code, same order, same timing -- just somewhere you can actually work on it.
'use strict';
function initApp(){

/* ===================== PERSONAL PROFILE (swap this to onboard a new person) =====================
   Everything above (movies/tvShows/videoGames/books/contenders) is shared reference data — the same
   for everyone who opens this file. Everything gathered onto PERSONAL_PROFILE below is the one
   person's layer: their owned collection, declared favorites, watchlist order, and the taste-engine
   weightings the scoring code reads. It's populated incrementally at each point downstream code
   needs it (so declaration order elsewhere in the file doesn't have to change), but every key here
   is independently safe to clear back to {} / [] / an empty Set to start a blank profile for someone
   new — the engine below runs fine against an empty profile, it just stops personalizing.
   NOT included yet: goatProfile.recs (the hand-written recommendation blurbs a few hundred lines
   down). Those are prose authored against Payton's specific declared canon, not a mechanical lookup,
   so making them regenerate per person is recommendation-engine work (see NOTES.md Phase 4), not a
   data move — folding them in here would just be moving text, not making it swappable. */
/* Loaded profile (from Export/Import below) takes over completely -- once someone has saved a
   profile to this browser, the hardcoded defaults below never re-apply, even for fields the saved
   profile leaves out. That's what makes "Reset to Blank" actually blank rather than falling back
   to Payton's canon. A fresh browser with nothing saved yet still boots from the defaults below,
   which today are Payton's own profile -- that's the "sample profile" until Phase 3 ships a real
   blank-first-run flow for new copies. */
// Which specialized index sliders show pinned to the main filter row (alongside the one genuinely
// fixed slider, ★ GOAT Match -- a personal-taste score with no equivalent elsewhere) for a profile
// that's never touched pinning itself. Technical Craft and Cosmic Horror are pinned by default here
// so a fresh profile's main row looks exactly like it always has -- but both are genuine members of
// the same pinnable pool as the other specialized indices, not permanently-fixed sliders, so either
// can be unpinned/re-pinned the same way any of them can. Declared this early since
// PERSONAL_PROFILE's own default-fallback construction below needs it.
const DEFAULT_PINNED_IDX=['tech','ref','snd','ch'];
let PROFILE_FROM_STORAGE=false;
const PERSONAL_PROFILE=(function(){
 try{const raw=localStorage.getItem('omniLedgerProfile');if(raw!==null){PROFILE_FROM_STORAGE=true;return JSON.parse(raw)||{};}}catch(e){}
 return {};
})();
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.watchlist={c02:1,c78:2,c79:3,c80:4,c81:5,c82:6,c83:7};
contenders.forEach(c=>{const wl=PERSONAL_PROFILE.watchlist||{};if(wl[c.id])c.watchRank=wl[c.id];});

/* ===================== UNIFIED ADAPTER LAYER ===================== */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.ownedBooksExtra={'b01':'Paperback','b02':'Hardcover','b03':'Hardcover','b04':'Hardcover','b05':'Deluxe','b06':'Paperback','b07':'Paperback','b08':'Hardcover','b09':'Hardcover','b10':'Hardcover','b11':'Hardcover','b12':'Hardcover','b13':'Hardcover','b14':'Hardcover','b15':'Hardcover','b16':'Hardcover','b17':'Paperback','b18':'Deluxe','b19':'Deluxe','b20':'Deluxe','b21':'Deluxe','b22':'Deluxe','b23':'Hardcover','b24':'Hardcover','b25':'Hardcover','b26':'Hardcover','b27':'Hardcover','b28':'Hardcover','b29':'Paperback','b30':'Hardcover','b31':'Hardcover','b32':'Hardcover','b33':'Deluxe','b34':'Paperback','b35':'Hardcover','b36':'Hardcover','b37':'Hardcover','b38':'Deluxe','b39':'Deluxe','b40':'Hardcover','b41':'Hardcover','b42':'Hardcover','b43':'Hardcover','b44':'Hardcover','b45':'Paperback','b46':'Hardcover','b47':'Hardcover','b48':'Paperback','b49':'Hardcover','b50':'Paperback','b51':'Hardcover','b508':'Hardcover','b59':'Paperback','b60':'Paperback','b58':'Paperback','b71':'Paperback','b53':'Paperback','b96':'Hardcover','b100':'Hardcover','b88':'Hardcover','b56':'Paperback','b148':'Paperback','b74':'Paperback','b79':'Deluxe','b151':'Paperback','b152':'Paperback','b153':'Boxed Set','b154':'Boxed Set','b155':'Paperback','b156':'Paperback','b157':'Paperback','b158':'Deluxe','b159':'Paperback','b160':'Paperback','b168':'Hardcover','b161':'Hardcover','b162':'Hardcover','b163':'Hardcover','b164':'Hardcover','b165':'Hardcover','b166':'Hardcover','b167':'Hardcover','b169':'Deluxe','b170':'Hardcover','b171':'Hardcover'};
const OWNED_BOOKS_EXTRA=PERSONAL_PROFILE.ownedBooksExtra||{};
const OB=id=>OWNED_BOOKS_EXTRA[id]!==undefined;
/* Ownership is now stated per book, in ownedBooksExtra above -- the old "id<=51 is owned by
   convention" rule made a personal shelf fact a property of the corpus's numbering. The ceiling
   is kept at 0 so a profile saved before that change still loads with its books owned. */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.ownedBookIdCeiling=0;
const OWNED_BOOK_ID_CEILING=PERSONAL_PROFILE.ownedBookIdCeiling||0;
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.ownedGameIds=['g45'];
const KM={movie:{label:'FILM',c:'#a78bfa'},tv:{label:'TV',c:'#22d3ee'},game:{label:'GAME',c:'#fbbf24'},book:{label:'BOOK',c:'#4ade80'}};
const ALL=[
 ...movies.map(m=>({kind:'movie',id:m.id,title:m.title,year:m.year,creator:m.creator,org:m.studio,span:m.runtime+' min',mins:m.runtime,genres:m.genres,crit:m.metrics.criticalScore,aud:m.metrics.audienceScore,
  tech:Math.round((m.physicalMediaFidelity.transferFidelity+m.physicalMediaFidelity.audioSoundscape+m.physicalMediaFidelity.cinematographyScore)/3),
  dread:m.atmosphericDreadIndex,myst:m.ontologicalComplexity,format:m.contextTags.formatType,vibe:m.contextTags.vibeTime,just:m.contextTags.justification,
  fid:[['4K Transfer',m.physicalMediaFidelity.transferFidelity],['Audio Soundscape',m.physicalMediaFidelity.audioSoundscape],['Cinematography',m.physicalMediaFidelity.cinematographyScore]],
  plats:[m.studio],provRaw:m.prov,owned:!!m.owned,physFormat:m.physFormat||(m.owned?'4K':null)})),
 ...tvShows.map(t=>({kind:'tv',id:t.id,title:t.title,year:t.year,creator:t.creator,org:t.networkStreamer,span:t.totalSeasons+(t.totalSeasons===1?' season':' seasons'),genres:t.genres,crit:t.metrics.criticalScore,aud:t.metrics.audienceScore,
  tech:Math.round((t.physicalMediaFidelity.transferFidelity+t.physicalMediaFidelity.audioSoundscape+t.physicalMediaFidelity.cinematographyScore)/3),
  dread:t.atmosphericDreadIndex,myst:t.ontologicalComplexity,format:t.formats.structuralType,vibe:t.contextTags.vibeTime,just:t.contextTags.justification,
  fid:[['Master Transfer',t.physicalMediaFidelity.transferFidelity],['Audio Soundscape',t.physicalMediaFidelity.audioSoundscape],['Cinematography',t.physicalMediaFidelity.cinematographyScore]],
  plats:[t.networkStreamer],provRaw:t.prov,owned:!!t.owned,physFormat:t.physFormat||(t.owned?'Box Set':null)})),
 ...videoGames.map(g=>({kind:'game',id:g.id,title:g.title,year:g.year,creator:g.creator,org:g.platformAvailability.join(' · '),span:'~'+g.averagePlaytime+' hrs',genres:g.genres,crit:g.metrics.criticalScore,aud:g.metrics.audienceScore,
  tech:Math.round((g.engineeringFidelity.engineGraphicsPerformance+g.engineeringFidelity.artDirection)/2),
  dread:g.immersionTensionIndex,myst:g.systemsComplexity,format:'Interactive',vibe:g.contextTags.vibeTime,just:g.contextTags.justification,
  fid:[['Engine & Performance',g.engineeringFidelity.engineGraphicsPerformance],['Art Direction',g.engineeringFidelity.artDirection]],
  plats:g.platformAvailability.slice(),provRaw:g.prov,owned:PERSONAL_PROFILE.ownedGameIds&&PERSONAL_PROFILE.ownedGameIds.includes(g.id),physFormat:null})),
 ...books.map(bk=>({kind:'book',id:bk.id,title:bk.title,year:bk.year,creator:bk.creator,org:bk.publisher,span:bk.pages+' pages',genres:bk.genres,crit:bk.metrics.criticalScore,aud:bk.metrics.audienceScore,
  tech:Math.round((bk.craft.proseCraft+bk.craft.ideaDensity)/2),
  dread:bk.atmosphericDreadIndex,myst:bk.ontologicalComplexity,format:bk.contextTags.formatType,vibe:bk.contextTags.vibeTime,just:bk.contextTags.justification,
  fid:[['Prose Craft',bk.craft.proseCraft],['Idea Density',bk.craft.ideaDensity],['Edition Quality',bk.format==='Deluxe'?95:bk.format==='Hardcover'?85:75]],
  plats:[bk.publisher],provRaw:bk.prov,owned:(parseInt(bk.id.slice(1))<=OWNED_BOOK_ID_CEILING||OB(bk.id)),physFormat:(parseInt(bk.id.slice(1))<=OWNED_BOOK_ID_CEILING?bk.format:(OB(bk.id)?OWNED_BOOKS_EXTRA[bk.id]:null))}))
];
const byId=new Map(ALL.map(x=>[x.id,x]));
ALL.forEach(x=>{x.ovr=Math.round(((x.crit+x.aud+x.tech)/3)*10)/10;});
/* Provenance is a per-record stamp, never inferred from a record's ID or from whether the shelf
   holds a copy. Owning a disc verifies that it is owned; it verifies nothing about the runtime
   printed on the back. A record whose facts have been checked against sources carries
   prov:{facts,checked,src,indices}; everything else is an unverified estimate and says so.
   See QUALITY_PASS.md decision 13. */
const PROV_FACTS=['sourced','estimated','edition-dependent'];
const PROV_INDICES=['rubric-v1','unscored'];
function provStampOf(raw){
 const s=(raw&&typeof raw==='object')?raw:{};
 return {facts:PROV_FACTS.indexOf(s.facts)>=0?s.facts:'estimated',
         indices:PROV_INDICES.indexOf(s.indices)>=0?s.indices:'unscored',
         checked:s.checked||null,src:s.src||null};
}
ALL.forEach(x=>{const s=provStampOf(x.provRaw);delete x.provRaw;x.provStamp=s;x.prov=s.facts==='sourced'?'verified':'estimated';});
/* Owned physical collection, reconciled against the master shelf ledger (film/TV + books). */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.ownedMedia={"m120":"4K","m106":"4K","m444":"4K","m384":"4K","t144":"BD/DVD","m116":"BD/DVD","m89":"BD/DVD","m66":"4K","m117":"4K","m65":"4K","m118":"4K","m119":"4K","m01":"4K","m121":"4K","m103":"4K","m122":"4K","m39":"BD/DVD","m158":"BD/DVD","m37":"4K","m40":"4K","m63":"4K","m20":"4K","m81":"BD/DVD","m02":"4K","m84":"4K","m114":"4K","m64":"4K","m14":"4K","m108":"4K","m159":"4K","m06":"4K","m105":"BD/DVD","m07":"4K","m88":"4K","m56":"4K","m12":"4K","m123":"BD/DVD","m54":"4K","m10":"BD/DVD","m124":"4K","m125":"4K","m107":"BD/DVD","m104":"4K","m126":"BD/DVD","m127":"4K","m128":"BD/DVD","m101":"BD/DVD","m110":"BD/DVD","m129":"BD/DVD","m130":"4K","m131":"BD/DVD","m132":"BD/DVD","m133":"BD/DVD","m134":"4K","m135":"BD/DVD","m09":"4K","m109":"4K","m102":"BD/DVD","m136":"4K","m113":"BD/DVD","m137":"BD/DVD","m138":"BD/DVD","m139":"BD/DVD","m140":"BD/DVD","m141":"BD/DVD","m142":"BD/DVD","m143":"BD/DVD","m144":"4K","m115":"BD/DVD","m145":"BD/DVD","m146":"BD/DVD","m147":"4K","m148":"BD/DVD","m149":"4K","m150":"4K","m151":"BD/DVD","m152":"4K","m160":"4K","m111":"BD/DVD","m154":"BD/DVD","m155":"BD/DVD","m156":"4K","m157":"4K","m86":"4K","m112":"BD/DVD","t17":"Box Set","t97":"Box Set","t03":"Box Set","t10":"Box Set","t47":"Box Set","t13":"Box Set","t28":"Box Set","t101":"Box Set"};
const OWNED_MEDIA=PERSONAL_PROFILE.ownedMedia||{};
ALL.forEach(x=>{if(OWNED_MEDIA[x.id]){x.owned=true;x.physFormat=OWNED_MEDIA[x.id];}if(x.kind==='book'&&(parseInt(x.id.slice(1))<=OWNED_BOOK_ID_CEILING||OB(x.id))){x.owned=true;if(OWNED_BOOKS_EXTRA[x.id])x.physFormat=OWNED_BOOKS_EXTRA[x.id];}});
let WL={};
try{const raw=localStorage.getItem('omniLedgerWatchlist');if(raw)WL=JSON.parse(raw)||{};}catch(e){WL={};}
function wlSave(){try{localStorage.setItem('omniLedgerWatchlist',JSON.stringify(WL));}catch(e){}}
function wlHas(id){return !!WL[id];}
function wlToggle(id){if(WL[id])delete WL[id];else WL[id]={watched:false,added:Date.now()};wlSave();}
function wlSetWatched(id,v){if(WL[id]){WL[id].watched=v;wlSave();}}
function wlCount(){return Object.keys(WL).length;}

/* ===================== STATE & HELPERS ===================== */
const state={view:'controller',q:'',type:'all',struct:'all',plats:[],minGoat:0,genres:[],genresExclude:[],ownedOnly:false,notOwnedOnly:false,limit:100,idx:{snd:0,ref:0,ch:0,emo:0,awe:0,cozy:0,perf:0,icon:0,scary:0,real:0,reality:0,shock:0,sci:0,funny:0,hist:0,vibe2:0,crit:0,aud:0,tech:0,dread:0,myst:0,runtime:0},ratings:[],tierFilter:[],yearMin:null,yearMax:null,combine:false,sort:'overall',w:{tech:0.85,dread:0.95,myst:0.90},creatorTab:'directors',creatorSearch:'',goatType:'all',goatTierFilter:'all',goatSort:'match',goatDeclaredQ:'',portraitScope:'all',collSearchQ:'',wlType:'all',wlSort:'added',wlSearchQ:'',creatorSearchScope:'all',creatorSort:'default'};
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const on=(sel,ev,fn)=>{const el=$(sel);if(el)el.addEventListener(ev,fn);else console.warn('missing element:',sel);};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Deterministic color per tag string (a creator's Core Themes, etc.) so a set of tags reads as
// visually distinct from each other at a glance instead of a wall of same-colored chips -- same
// string always lands on the same color, so it's still stable across renders/sessions. Each entry
// is a full hue apart from its neighbors (not just a lightness/saturation tweak on the same violet)
// so a row of themes reads as genuinely different colors, not one tint repeated.
const THEME_PALETTE=['#a78bfa','#38bdf8','#fb7185','#4ade80','#fbbf24','#e879f9','#2dd4bf','#f97316','#818cf8','#facc15','#f472b6','#84cc16','#22d3ee','#ef4444'];
function themeColor(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return THEME_PALETTE[Math.abs(h)%THEME_PALETTE.length];}
const SORTS={overall:(a,b)=>(b.ovr-a.ovr)||(b.crit-a.crit),cosmic:(a,b)=>(b.ch-a.ch)||(b.dread-a.dread),sound:(a,b)=>(b.snd-a.snd)||(b.crit-a.crit),ref4k:(a,b)=>(b.ref-a.ref)||(b.crit-a.crit),emotion:(a,b)=>(b.emo-a.emo)||(b.crit-a.crit),awe:(a,b)=>(b.awe-a.awe)||(b.crit-a.crit),comfort:(a,b)=>(b.cozy-a.cozy)||(b.aud-a.aud),perf:(a,b)=>(b.perf-a.perf)||(b.crit-a.crit),icon:(a,b)=>(b.icon-a.icon)||(b.crit-a.crit),scary:(a,b)=>(b.scary-a.scary)||(b.dread-a.dread),real:(a,b)=>(b.real-a.real)||(b.crit-a.crit),reality:(a,b)=>(b.reality-a.reality)||(b.myst-a.myst),shock:(a,b)=>(b.shock-a.shock)||(b.dread-a.dread),sci:(a,b)=>(b.sci-a.sci)||(b.myst-a.myst),funny:(a,b)=>(b.funny-a.funny)||(b.aud-a.aud),hist:(a,b)=>(b.hist-a.hist)||(b.crit-a.crit),vibe2:(a,b)=>(b.vibe2-a.vibe2)||(b.tech-a.tech),blend:(a,b)=>(bespokeScore(b)-bespokeScore(a))||(b.crit-a.crit),crit:(a,b)=>b.crit-a.crit,aud:(a,b)=>b.aud-a.aud,tech:(a,b)=>b.tech-a.tech,dread:(a,b)=>b.dread-a.dread,myst:(a,b)=>b.myst-a.myst,yearNew:(a,b)=>b.year-a.year,yearOld:(a,b)=>a.year-b.year,title:(a,b)=>a.title.localeCompare(b.title),tier:(a,b)=>(tierRank(b)-tierRank(a))||(b.gm-a.gm)};

const IDX_KEYS=['snd','ref','ch','emo','awe','cozy','perf','icon','scary','real','reality','shock','sci','funny','hist','vibe2','crit','aud','tech','dread','myst'];
function filtered(){const q=state.q.trim().toLowerCase();
 return ALL.filter(it=>{
  if(state.type!=='all'&&it.kind!==state.type)return false;
  if(it.kind==='tv'){
   if(state.struct==='limited'&&it.format!=='Limited/Mini-Series')return false;
   if(state.struct==='multi'&&it.format!=='Multi-Season Epic')return false;
  }
  if(state.plats.length&&!state.plats.some(p=>it.plats.includes(p)))return false;
  if(state.idx.runtime>0&&it.kind==='movie'&&it.mins&&it.mins>state.idx.runtime)return false;
  if(it.tech<state.idx.tech||it.gm<state.minGoat)return false;
  if(state.genres.length&&!state.genres.some(g=>it.fam.includes(g)))return false;
  if(state.genresExclude.length&&state.genresExclude.some(g=>it.fam.includes(g)))return false;
  if(state.ratings.length&&!state.ratings.includes(it.rating))return false;
  if(state.ownedOnly&&!it.owned)return false;
  if(state.notOwnedOnly&&it.owned)return false;
  if(state.tierFilter.length&&!state.tierFilter.some(t=>(t==='gold'&&it.goat)||(t==='silver'&&it.silver)||(t==='bronze'&&it.bronze)))return false;
  for(const k of IDX_KEYS){if(state.idx[k]>0&&it[k]<state.idx[k])return false;}
  if(state.yearMin!=null&&it.year<state.yearMin)return false;
  if(state.yearMax!=null&&it.year>state.yearMax)return false;
  if(q){const hay=(it.title+' '+it.creator+' '+it.org+' '+(it.plats||[]).join(' ')+' '+it.genres.join(' ')+' '+(it.fam||[]).join(' ')+' '+it.vibe+' '+(it.rating||'')+' '+it.year).toLowerCase();if(!hay.includes(q))return false;}
  return true;
 });
}
function activeDims(){
 const d=[];
 if(state.minGoat>0)d.push(['gm','★ GOAT',state.minGoat]);
 if(state.idx.ch>0)d.push(['ch','◉ Cosmic',state.idx.ch]);
 if(state.idx.emo>0)d.push(['emo','Emotional',state.idx.emo]);
 if(state.idx.snd>0)d.push(['snd','Soundtrack',state.idx.snd]);
 if(state.idx.ref>0)d.push(['ref','4K Reference',state.idx.ref]);
 if(state.idx.awe>0)d.push(['awe','Awe',state.idx.awe]);
 if(state.idx.cozy>0)d.push(['cozy','Comfort',state.idx.cozy]);
 if(state.idx.perf>0)d.push(['perf','Performances',state.idx.perf]);
 if(state.idx.icon>0)d.push(['icon','Iconic',state.idx.icon]);
 if(state.idx.scary>0)d.push(['scary','Scariest',state.idx.scary]);
 if(state.idx.real>0)d.push(['real','Realistic',state.idx.real]);
 if(state.idx.reality>0)d.push(['reality','Reality-Altering',state.idx.reality]);
 if(state.idx.shock>0)d.push(['shock','Shocking',state.idx.shock]);
 if(state.idx.sci>0)d.push(['sci','Scientific',state.idx.sci]);
 if(state.idx.funny>0)d.push(['funny','Funniest',state.idx.funny]);
 if(state.idx.hist>0)d.push(['hist','Historical',state.idx.hist]);
 if(state.idx.vibe2>0)d.push(['vibe2','Vibe',state.idx.vibe2]);
 if(state.idx.crit>0)d.push(['crit','Critical Score',state.idx.crit]);
 if(state.idx.aud>0)d.push(['aud','Audience Score',state.idx.aud]);
 if(state.idx.tech>0)d.push(['tech','Technical Craft',state.idx.tech]);
 if(state.idx.dread>0)d.push(['dread','Dread',state.idx.dread]);
 if(state.idx.myst>0)d.push(['myst','Complexity',state.idx.myst]);
 return d;
}
/* The "Match" number on a card while filters are active: how well a work answers the specific
   question the sliders are asking, blended with its overall standing.

   Each active dimension is weighted by how high its slider is set. That is the only signal of
   intent available -- someone who asks for Scariest >= 80 and Funniest >= 20 is telling you which
   of the two they came for -- and it is the same for everyone, which matters because this number
   has to serve any taste, not one shape of taste.

   It used to weight by `dims.length - i`, the dimension's position in activeDims(), which is a
   hardcoded list of if-statements in app source order. So ★ GOAT outranked every other filter for
   no reason except being written first, Cosmic Horror outranked Scariest, and Complexity came last
   however hard you pulled it. Nothing about that ordering was a claim about taste; it was an
   artifact of the order someone typed the conditions, and it silently ranked every filtered
   result. */
function computeMatch(list){
 const dims=activeDims();
 const wsum=dims.reduce((s,d)=>s+d[2],0);
 list.forEach(it=>{
  if(!dims.length||wsum<=0){it._m=it.ovr;return;}
  let sum=0;dims.forEach(d=>{sum+=it[d[0]]*d[2];});
  it._m=Math.round((sum/wsum)*0.8+it.ovr*0.2);
 });
}
function bespokeScore(it){const w=state.w,s=w.tech+w.dread+w.myst;if(s<=0)return 0;return (it.tech*w.tech+it.dread*w.dread+it.myst*w.myst)/s;}

function ring(v,color,size){size=size||42;const r=size/2-4,c=2*Math.PI*r,off=c*(1-Math.max(0,Math.min(100,v))/100);
 return '<svg width="'+size+'" height="'+size+'" class="shrink-0" aria-hidden="true"><circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="#1b2740" stroke-width="3.5"/><circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 '+(size/2)+' '+(size/2)+')"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#e2e8f0" font-size="'+Math.round(size*0.3)+'" font-weight="700">'+Math.round(v)+'</text></svg>';}
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

/* ===================== VIEW 1 · GLOBAL CONTROLLER ===================== */
function summaryTraits(it){
 let dims=[['emotional depth',it.emo],['awe & spectacle',it.awe],['comfort',it.cozy],['iconic status',it.icon],['scares',it.scary],['reality-bending',it.reality],['shock',it.shock],['scientific rigor',it.sci],['humor',it.funny],['historical weight',it.hist],['atmosphere',it.vibe2],['cosmic dread',it.ch]];
 if(it.kind!=='book'){dims.push(['soundtrack',it.snd]);dims.push(['performances',it.perf]);}
 if(it.kind==='book'){dims.push(['prose & ideas',it.tech]);}
 dims.push(['realism',it.real]);
 return dims.filter(d=>d[1]>=80).sort((a,b)=>b[1]-a[1]).slice(0,3).map(d=>d[0]);
}
// Picks the best "anchor" work to cite as the reason for a recommendation, out of a candidate
// pool -- ranked Gold > Silver > Bronze > merely-owned first, then by match score within that tier,
// so the reasoning cites your strongest taste signal, not just whatever's owned.
function bestAnchor(candidates){
 if(!candidates.length)return null;
 return candidates.slice().sort((a,b)=>(tierRank(b)-tierRank(a))||(b.gm-a.gm))[0];
}
function anchorPhrase(ex){
 return ex.goat?('one of your Gold favorites, '+esc(ex.title)):ex.silver?('your Silver favorite '+esc(ex.title)):ex.bronze?('your Bronze pick '+esc(ex.title)):('you own '+esc(ex.title));
}
function whyRecommended(it){
 // Only meaningful for unowned discoveries.
 if(it.owned) return '';
 // (a) Same creator as a taste signal (strongest): Gold/Silver/Bronze favorites first, owned items
 // as a fallback signal, all considered together and ranked by tier.
 if(it.creator){
  const sameCreator=ALL.filter(x=>(x.owned||x.goat||x.silver||x.bronze)&&x.creator&&x.creator===it.creator&&x.id!==it.id);
  const ex=bestAnchor(sameCreator);
  if(ex){
   const noun=it.kind==='book'?'author':(it.kind==='game'?'studio':'director');
   return 'Because '+anchorPhrase(ex)+' \u2014 same '+noun+'.';
  }
 }
 // (b) Shared genre-family with a taste signal (tiered favorites ranked above merely-owned).
 const fams=(it.fam||[]);
 if(fams.length){
  const sameKind=ALL.filter(x=>(x.owned||x.goat||x.silver||x.bronze)&&x.kind===it.kind&&(x.fam||[]).some(f=>fams.includes(f)));
  const exSame=bestAnchor(sameKind);
  if(exSame){
   const sharedFam=fams.find(f=>(exSame.fam||[]).includes(f))||fams[0];
   return 'Because '+anchorPhrase(exSame)+' \u2014 shares your taste for '+esc(sharedFam)+'.';
  }
  // cross-medium fallback: same family, any medium
  const anyKind=ALL.filter(x=>(x.owned||x.goat||x.silver||x.bronze)&&(x.fam||[]).some(f=>fams.includes(f)));
  const exAny=bestAnchor(anyKind);
  if(exAny){
   const sharedFam=fams.find(f=>(exAny.fam||[]).includes(f))||fams[0];
   return 'Matches your '+esc(sharedFam)+' taste ('+anchorPhrase(exAny)+').';
  }
 }
 // (c) Shared vibe with a taste signal.
 if(it.vibe){
  const sameVibe=ALL.filter(x=>(x.owned||x.goat||x.silver||x.bronze)&&x.vibe===it.vibe);
  const ex=bestAnchor(sameVibe);
  if(ex){
   return 'Same mood as '+esc(ex.title)+' ('+esc(it.vibe)+').';
  }
 }
 return '';
}
function suggestedFormat(it){
 // Recommends the ideal edition to buy for THIS specific work, from its own quality profile.
 if(it.kind==='movie'||it.kind==='tv'){
  const cine=(it.fid&&it.fid[2])?it.fid[2][1]:it.tech;      // cinematography
  const trans=(it.fid&&it.fid[0])?it.fid[0][1]:it.tech;     // transfer
  const spectacle=Math.max(cine,trans,it.awe||0);
  if(spectacle>=88) return {fmt:'4K UHD',why:'reference-grade visuals \u2014 the premium disc is worth it'};
  if(spectacle>=80) return {fmt:'4K UHD',why:'strong visual craft rewards the upgrade'};
  return {fmt:'Blu-ray / DVD',why:'a standard disc captures it fully \u2014 4K adds little'};
 }
 if(it.kind==='book'){
  const prose=(it.fid&&it.fid[0])?it.fid[0][1]:it.tech;
  const idea=(it.fid&&it.fid[1])?it.fid[1][1]:it.tech;
  const stature=Math.max(it.crit||0,it.aud||0);
  const illustr=(it.fam||[]).some(f=>/Myth|Fantasy|Poetry|Cosmic|Literary/.test(f));
  if(stature>=92&&illustr) return {fmt:'Deluxe / Illustrated',why:'a canonical work where a fine illustrated edition transforms it'};
  if(prose>=86||stature>=90) return {fmt:'Hardcover',why:'prose and stature justify a durable hardcover'};
  return {fmt:'Softcover',why:'a reading copy serves it well'};
 }
 if(it.kind==='game'){
  const plat=(it.plats&&it.plats.length)?it.plats[0]:'current-gen';
  return {fmt:plat,why:'best experienced on '+esc(plat)};
 }
 return null;
}
function crossThread(it){
 // Finds the strongest companion in a DIFFERENT medium: shared creator > shared family+high match > shared vibe.
 var others=ALL.filter(x=>x.kind!==it.kind&&x.id!==it.id);
 var kindWord={movie:'film',tv:'series',game:'game',book:'book'};
 // (a) same creator across media (rare but powerful, e.g. author who also directs)
 if(it.creator){
  var sameC=others.filter(x=>x.creator&&x.creator===it.creator).sort((a,b)=>b.gm-a.gm);
  if(sameC.length){var e=sameC[0];return {it:e,reason:'also by '+esc(it.creator)};}
 }
 // (b) shared genre-family, strongest taste match
 var fams=(it.fam||[]);
 if(fams.length){
  var shared=others.filter(x=>(x.fam||[]).some(f=>fams.includes(f)));
  if(shared.length){
   // prefer a canonical/high-match companion
   shared.sort((a,b)=>(b.gm+b.ovr)-(a.gm+a.ovr));
   var e=shared[0];var fam=fams.find(f=>(e.fam||[]).includes(f))||fams[0];
   return {it:e,reason:'shares your '+esc(fam)+' thread'};
  }
 }
 // (c) shared vibe
 if(it.vibe){
  var sv=others.filter(x=>x.vibe===it.vibe).sort((a,b)=>b.gm-a.gm);
  if(sv.length)return {it:sv[0],reason:'same mood ('+esc(it.vibe)+')'};
 }
 return null;
}
function buildRabbitHole(startId,steps,opts){
 // Chains cross-medium threads into a themed journey, rotating media and avoiding repeats.
 steps=steps||5;opts=opts||{};
 var start=byId.get(startId);if(!start)return [];
 var chain=[{it:start,reason:'your starting point'}];
 var used={};used[start.id]=1;
 var cur=start;
 function passes(x){
  if(opts.mood&&x.vibe!==opts.mood)return false;
  if(opts.era){var d=Math.floor((x.year||0)/10)*10;if(d!==opts.era)return false;}
  return true;
 }
 for(var i=1;i<steps;i++){
  var last=(i===steps-1);
  // Gather candidate companions across media, prefer a medium not used recently.
  var recentKinds=chain.slice(-2).map(c=>c.it.kind);
  var cands=[];
  // shared creator
  if(cur.creator)ALL.forEach(x=>{if(!used[x.id]&&x.creator===cur.creator&&x.id!==cur.id)cands.push({it:x,reason:'also by '+esc(cur.creator),score:x.gm+30+(x.kind!==cur.kind?15:0)});});
  // shared family
  var fams=(cur.fam||[]);
  ALL.forEach(x=>{if(used[x.id]||x.id===cur.id)return;var shared=(x.fam||[]).filter(f=>fams.includes(f));if(shared.length){var bonus=(x.kind!==cur.kind?22:-14)+(recentKinds.indexOf(x.kind)<0?10:0);cands.push({it:x,reason:'shares the '+esc(shared[0])+' thread',score:x.gm+x.ovr*0.3+bonus+shared.length*4});}});
  // shared vibe
  if(cur.vibe)ALL.forEach(x=>{if(!used[x.id]&&x.vibe===cur.vibe&&x.id!==cur.id){var bonus=recentKinds.indexOf(x.kind)<0?12:0;cands.push({it:x,reason:'same mood \u00b7 '+esc(cur.vibe),score:x.gm+bonus});}});
  cands=cands.filter(function(c){return passes(c.it);});
  if(opts.endOwned&&last){cands.forEach(function(c){if(c.it.owned)c.score+=60;});}
  if(!cands.length)break;
  // pick highest-scoring, with slight preference for switching medium
  cands.sort((a,b)=>b.score-a.score);
  var pick=cands[0];
  chain.push({it:pick.it,reason:pick.reason});
  used[pick.it.id]=1;cur=pick.it;
 }
 return chain;
}
var rabbitSteer={mood:'',era:0,endOwned:false};
function renderRabbitHole(startId){
 var opts={mood:rabbitSteer.mood,era:rabbitSteer.era,endOwned:rabbitSteer.endOwned};
 var chain=buildRabbitHole(startId,5,opts);
 var panel=$('#surprisePanel');panel.classList.remove('hidden');panel.dataset.mode='rabbit';
 if(chain.length<2){panel.innerHTML='<div class="panel p-4 text-center text-slate-400 text-sm">Not enough connections to build a journey from here.</div>';return;}
 var html='<div class="panel p-5" style="border-color:#c084fc55;box-shadow:0 0 40px rgba(192,132,252,.13)">'
  +'<div class="flex items-center justify-between mb-3"><span class="lbl" style="color:#c084fc">\uD83D\uDD73 Rabbit hole \u00b7 a journey through your taste</span>'
  +'<button type="button" id="rabbitAgain" class="text-[10px] px-2.5 py-1 rounded border border-purple-500/50 text-purple-300 hover:bg-purple-500/10">\u21bb New journey</button></div>';
 // steering controls
 var moods=['Late-Night Cosmic Dread','Puzzle-Box Replay','Rainy Sunday Comfort','Neon-Lit Rain','Midnight Ritual','Notebook-and-Theories Night','Midnight Immersive Session'];
 var eras=[0,1970,1980,1990,2000,2010,2020];
 html+='<div class="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-slate-800/70">'
  +'<span class="text-[9px] uppercase tracking-[.14em] text-slate-500">Steer</span>'
  +'<select id="rabMood" class="inp" style="width:auto;font-size:11px;padding:2px 6px"><option value="">Any mood</option>'+moods.map(function(m){return '<option value="'+m+'"'+(rabbitSteer.mood===m?' selected':'')+'>'+m+'</option>';}).join('')+'</select>'
  +'<select id="rabEra" class="inp" style="width:auto;font-size:11px;padding:2px 6px">'+eras.map(function(e){return '<option value="'+e+'"'+(rabbitSteer.era===e?' selected':'')+'>'+(e?e+'s':'Any era')+'</option>';}).join('')+'</select>'
  +'<label class="flex items-center gap-1 text-[10.5px] text-slate-400 cursor-pointer"><input type="checkbox" id="rabEndOwned"'+(rabbitSteer.endOwned?' checked':'')+'> end on something I own</label>'
  +'</div>';
 html+='<div class="space-y-0">';
 chain.forEach(function(node,idx){
  var it=node.it;var k=KM[it.kind];var verb={movie:'Watch',tv:'Watch',game:'Play',book:'Read'}[it.kind];
  html+='<div class="flex items-start gap-3">'
   +'<div class="flex flex-col items-center shrink-0"><div class="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold shrink-0" style="background:'+k.c+'22;color:'+k.c+';border:1.5px solid '+k.c+'">'+(idx+1)+'</div>'
   +(idx<chain.length-1?'<div style="width:2px;height:26px;background:linear-gradient(180deg,'+k.c+'88,'+KM[chain[idx+1].it.kind].c+'88)"></div>':'')+'</div>'
   +'<div class="pb-3 min-w-0 flex-1">'
   +'<div class="flex items-center gap-2 flex-wrap"><span class="text-[9px] px-1.5 py-0.5 rounded shrink-0" style="background:'+k.c+'22;color:'+k.c+'">'+k.label+'</span>'
   +(it.owned?'<span class="text-[8px] px-1 py-0.5 rounded" style="background:#14532d;color:#4ade80">OWNED</span>':'')
   +'<span class="text-[13px] font-bold text-slate-100">'+esc(it.title)+'</span><span class="text-[10px] text-slate-500">'+it.year+'</span></div>'
   +'<div class="text-[10.5px] text-slate-500 mt-0.5">'+(idx===0?'\u25c8 '+node.reason:'\u2937 '+node.reason)+'</div>'
   +'</div></div>';
 });
 html+='</div>';
 html+='<p class="text-[10px] text-slate-500 mt-1">Five stops across media, each linked to the last by creator, theme, or mood.</p>';
 html+='</div>';
 panel.innerHTML=html;
 var ra=$('#rabbitAgain');if(ra)ra.onclick=function(){
  var pool=filtered();if(!pool.length)pool=ALL;
  if(rabbitSteer.mood)pool=pool.filter(function(x){return x.vibe===rabbitSteer.mood;});
  if(rabbitSteer.era)pool=pool.filter(function(x){return Math.floor((x.year||0)/10)*10===rabbitSteer.era;});
  if(!pool.length)pool=ALL;
  var seed=pool.slice().sort(function(a,b){return b.gm-a.gm;}).slice(0,30);
  renderRabbitHole(seed[Math.floor(Math.random()*seed.length)].id);
 };
 var rm=$('#rabMood');if(rm)rm.onchange=function(){rabbitSteer.mood=this.value;if($('#rabbitAgain'))$('#rabbitAgain').onclick();};
 var re=$('#rabEra');if(re)re.onchange=function(){rabbitSteer.era=+this.value;if($('#rabbitAgain'))$('#rabbitAgain').onclick();};
 var reo=$('#rabEndOwned');if(reo)reo.onchange=function(){rabbitSteer.endOwned=this.checked;renderRabbitHole(startId);};
 if(panel.scrollIntoView)panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function crossThreadHTML(it){
 var t=crossThread(it);if(!t)return '';
 var k=KM[t.it.kind];
 var verb={movie:'Watch',tv:'Watch',game:'Play',book:'Read'}[t.it.kind];
 return '<div class="mt-2.5 pt-2 border-t border-slate-800/70">'
  +'<div class="text-[10px] mb-1" style="color:#c084fc">\u2937 If you like this, cross over to:</div>'
  +'<button type="button" class="pairingChip flex items-center gap-2 w-full text-left" data-flip-jump="'+t.it.id+'" title="Open '+esc(t.it.title)+' in the Global Controller"><span class="text-[9px] px-1.5 py-0.5 rounded shrink-0" style="background:'+k.c+'22;color:'+k.c+'">'+k.label+'</span>'
  +'<span class="text-[12px] text-slate-200 font-semibold hover:text-teal-300">'+verb+' '+esc(t.it.title)+'</span>'
  +'<span class="text-[10px] text-slate-500">\u00b7 '+t.reason+'</span></button></div>';
}
function gmBreakdownHTML(it){
 var chips=[];
 var ovMap={declared:['\u2605 Declared all-time favorite \u2014 locked at 100','#fbbf24'],silver:['\u2726 Declared favorite (silver tier)','#cbd5e1'],owned:['\u25c8 In your physical collection','#4ade80']};
 (it.gmBoosts||[]).slice().sort((a,b)=>b[2]-a[2]).forEach(function(b){
  var lab={creator:'Creator',author:'Author',genre:'Genre',vibe:'Vibe',complexity:'Depth',craft:'Craft',dread:'Dread'}[b[0]]||b[0];
  var cap=(''+b[1]).replace(/\b\w/g,function(c){return c.toUpperCase();});
  chips.push('<span class="text-[9.5px] px-1.5 py-0.5 rounded" style="background:#1e293b;color:#cbd5e1">'+lab+': '+esc(cap)+' <b style="color:#fbbf24">+'+b[2]+'</b></span>');
 });
 var ov=it.gmOverride&&ovMap[it.gmOverride];
 var head='<div class="flex items-center gap-2 mb-1"><span class="lbl" style="color:#fbbf24">\u2605 Why this match?</span>'
  +'<span class="text-[9px] text-slate-500">base '+it.gmBase+(it.gmBoostTotal>0?' \u00b7 +'+it.gmBoostTotal+' taste':'')+' \u2192 '+it.gm+'</span></div>';
 var body=ov?'<div class="text-[10.5px] mb-1" style="color:'+ov[1]+'">'+ov[0]+'</div>':'';
 if(chips.length)body+='<div class="flex flex-wrap gap-1">'+chips.join('')+'</div>';
 else if(!ov)body+='<div class="text-[10px] text-slate-500">Scored on critical, audience and craft consensus \u2014 no personal-taste multipliers triggered.</div>';
 var ps=it.provStamp||{facts:'estimated',indices:'unscored'};
 var provTitle=ps.facts==='sourced'?('Facts checked against '+(ps.src||'sources')+(ps.checked?' on '+ps.checked:'')):ps.facts==='edition-dependent'?'Facts vary by edition/cut -- the value shown is one edition, not the only one':'Not yet checked against a source: scores and details are careful approximations';
 var provLabel=ps.facts==='sourced'?'\u25c9 Facts sourced':ps.facts==='edition-dependent'?'\u25d1 Edition-dependent':'\u25cb Unverified estimate';
 var provColor=ps.facts==='sourced'?'#4ade80':ps.facts==='edition-dependent'?'#fbbf24':'#94a3b8';
 var prov='<span title="'+provTitle+'" style="color:'+provColor+'">'+provLabel+'</span>'
  +(ps.indices==='rubric-v1'?'<span class="text-slate-600"> \u00b7 indices rubric v1</span>':'');
 body+='<div class="text-[9px] mt-1.5">'+prov+'</div>';
 return '<div class="mt-2 pt-2 border-t border-slate-800/50">'+head+body+'</div>';
}
function summaryHTML(it){const k=KM[it.kind];
 const kindWord={movie:'film',tv:'series',game:'game',book:'book'}[it.kind];
 const traits=summaryTraits(it);
 const gsent=it.genres&&it.genres.length?it.genres.slice(0,3).join(', '):'';
 // Opening line: what it is
 let line1='A '+it.year+' '+gsent+' '+kindWord+(it.creator?' by '+esc(it.creator):'')+'.';
 // Tagline (the curated hook)
 const hook=it.just?'\u201c'+esc(it.just)+'\u201d':'';
 // Standout traits line
 let line2=traits.length?'Stands out for its '+traits.join(', ')+'.':'';
 // Reception + fit
 const recep='Critics '+(it.crit>=90?'adore it':it.crit>=80?'rate it highly':it.crit>=70?'regard it well':'are mixed')+' ('+it.crit+'/100)';
 const aud='audiences '+(it.aud>=90?'love it':it.aud>=80?'rate it highly':it.aud>=70?'like it':'are split')+' ('+it.aud+'/100).';
 // Taste-fit note based on personal GOAT match
 let fit='';
 if(it.goat)fit='\u2605 One of your declared all-time favorites.';
 else if(it.silver)fit='\u2606 A silver-tier favorite of yours.';
 else if(it.owned)fit='\u2713 Already in your collection'+(it.physFormat?' ('+esc(it.physFormat)+')':'')+'.';
 else if(it.gm>=85)fit='\u2605 Very strong match for your taste ('+it.gm+'/100) \u2014 a prime discovery.';
 else if(it.gm>=72)fit='\u2605 Good match for your taste ('+it.gm+'/100).';
 else fit='Taste match: '+it.gm+'/100.';
 const vibeChip=it.vibe?'<span class="chip" style="color:#c4b5fd;border-color:#c4b5fd44">'+esc(it.vibe)+'</span>':'';
 return '<div class="summaryFace hidden border-t border-slate-800/80 px-3.5 py-3 bg-[#0b1322]/70">'
  +'<div class="flex items-center justify-between gap-2 mb-1.5"><span class="lbl" style="color:'+k.c+'">'+k.label+' \u00b7 Quick Look</span>'
  +'<button type="button" class="flipBack text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1" data-id="'+it.id+'">&#8617; back to card</button></div>'
  +'<p class="text-[12px] text-slate-200 leading-relaxed">'+line1+'</p>'
  +(hook?'<p class="text-[11.5px] text-slate-300 italic mt-1.5 leading-relaxed">'+hook+'</p>':'')
  +(line2?'<p class="text-[11px] text-slate-400 mt-1.5 leading-relaxed">'+line2+'</p>':'')
  +'<p class="text-[11px] text-slate-400 mt-1.5 leading-relaxed">'+recep+', '+aud+'</p>'
  +'<p class="text-[11.5px] mt-2 leading-relaxed" style="color:'+(it.goat||it.gm>=85?'#fcd34d':it.owned?'#4ade80':'#cbd5e1')+'">'+fit+'</p>'+((function(){var w=whyRecommended(it);return w?'<p class="text-[11px] mt-1 leading-relaxed" style="color:#7dd3fc">↳ '+w+'</p>':'';})())+((function(){var f=suggestedFormat(it);if(!f)return '';var have=it.owned&&it.physFormat;var match=have&&it.physFormat.toLowerCase().indexOf(f.fmt.toLowerCase().split(' ')[0].toLowerCase())>=0;return '<p class="text-[11px] mt-1 leading-relaxed" style="color:#fbbf24">◈ Best edition: <b>'+esc(f.fmt)+'</b> — '+f.why+(have&&!match?' <span style=\'color:#fb7185\'>(you own '+esc(it.physFormat)+')</span>':have&&match?' <span style=\'color:#4ade80\'>(✓ you have it)</span>':'')+'</p>';})())
  +'<div class="flex flex-wrap gap-1.5 mt-2.5">'+vibeChip+(it.fam||[]).slice(0,3).map(f=>'<span class="chip">'+esc(f)+'</span>').join('')+'</div>'+crossThreadHTML(it)
  +'</div>';
}
// Creator boost/bury stepper: a +/- control instead of a one-way "+Boost" button, so nudging a
// creator DOWN ("the opposite of boosting" -- someone whose work keeps recommending itself but
// you're just not that into) is exactly as easy and visible as nudging one up. Weight is shown
// live so you can see how far you've pushed it without opening the score breakdown.
function creatorBoostHTML(it){
 if(!it.creator)return '';
 var key=it.kind==='book'?'bookCreatorBoost':'creatorBoost';
 var existing=(PERSONAL_PROFILE[key]||[]).find(function(e){return e[0]===it.creator;});
 var w=existing?existing[1]:0;
 var color=w>0?'#4ade80':(w<0?'#f87171':'#94a3b8');
 return '<div class="flex items-center gap-1.5 text-[11px]">'
  +'<span class="text-slate-500">Creator weight:</span>'
  +'<button type="button" class="profEditBtn tierSeg" data-act="creatorbump" data-creator="'+esc(it.creator)+'" data-kind="'+it.kind+'" data-delta="-4" style="color:#f87171" title="Nudge '+esc(it.creator)+'’s work DOWN across your whole match scoring">−</button>'
  +'<span class="tabular-nums font-bold" style="color:'+color+';min-width:2.5ch;text-align:center" title="Current weight for '+esc(it.creator)+' (-20 to 20)">'+(w>0?'+':'')+w+'</span>'
  +'<button type="button" class="profEditBtn tierSeg" data-act="creatorbump" data-creator="'+esc(it.creator)+'" data-kind="'+it.kind+'" data-delta="4" style="color:#4ade80" title="Nudge '+esc(it.creator)+'’s work UP across your whole match scoring">+</button>'
  +'<span class="text-slate-400 truncate">'+esc(it.creator)+'</span>'
  +'</div>';
}
// Compact tier/own toggle row -- visible on every card without expanding it, so declaring a
// favorite or marking something owned doesn't require opening the detail panel first.
function tierRowHTML(it,roomy){
 // Gold/Silver/Bronze stay pure emoji, active or not -- a medal is self-explanatory, and dropping
 // the name text (which used to appear only once active, e.g. "🥇 Gold") keeps the row compact
 // and consistent regardless of state, per explicit user preference. Owned is the one segment that
 // always shows its "Owned" text alongside the diamond -- it's the one icon that's genuinely
 // ambiguous on its own, and there's exactly the room for it that dropping the other three labels
 // freed up. Active state for all four is still shown via the filled background + title's
 // "click to remove", not text.
 // Active state also gets a matching border on top of the filled background (not just background
 // alone) -- makes the highlighted segment unambiguous even where an emoji glyph itself renders
 // with strong inherent color (varies a lot across platforms/fonts) that could otherwise make an
 // active vs. inactive button harder to tell apart at a glance.
 function seg(act,emoji,name,label,active,color,showName){
  return '<button type="button" class="profEditBtn tierSeg'+(roomy?' tierSegRoomy':'')+'" data-act="'+act+'" data-id="'+it.id+'"'+(act==='own'?' data-kind="'+it.kind+'"':'')+' title="'+label+(active?' — click to remove':'')+'"'
   +(active?' style="background:'+color+';border-color:'+color+';color:#0B0F19"':' style="color:'+color+';border-color:transparent"')+'>'
   +emoji+(showName?' '+name:'')+'</button>';
 }
 // roomy: the GOAT Profile "Search & Build Your Favorites" list renders these one card at a time
 // (not the dense main grid), so it can afford noticeably more breathing room between the four
 // buttons -- addresses the specific "still quite close together" feedback about that screen
 // without touching the deliberately compact spacing every other card everywhere else relies on.
 return '<div class="flex items-center flex-wrap px-3.5 pb-3'+(roomy?' gap-3 mt-4':' gap-1.5 mt-auto pt-3')+'">'
 +seg('declare','\u{1F947}','Gold','Gold: your declared all-time favorites — pins a 100 match, the strongest recommendation signal',it.goat,'#fbbf24',false)
 +seg('silver','\u{1F948}','Silver','Silver: a strong favorite, one notch below Gold',it.silver,'#cbd5e1',false)
 +seg('bronze','\u{1F949}','Bronze','Bronze: really like it, a lighter nudge than Silver',it.bronze,'#cd7f32',false)
 +'<span class="w-px h-4 mx-0.5" style="background:#334155"></span>'
 +seg('own','◆','Owned','Toggle whether this is in your owned collection',it.owned,'#4ade80',true)
 +(roomy?'<span class="ml-auto flex items-center gap-3 text-[10.5px] text-slate-500 shrink-0"><span title="GOAT match /100">★ <b style="color:#fbbf24">'+it.gm+'</b></span><span title="Critical score /100">Crit <b class="text-slate-300">'+it.crit+'</b></span><span title="Audience score /100">Aud <b class="text-slate-300">'+it.aud+'</b></span></span>':'')
 +'</div>';
}
function cardHTML(it){const k=KM[it.kind];
 return '<div class="panel overflow-hidden hover:border-slate-600/80 transition-colors fade-in relative flex flex-col h-full">'
 +'<button type="button" class="cardHead w-full text-left p-3.5 flex gap-3 items-start" data-id="'+it.id+'">'
 +ring(it.crit,k.c,42)
 +'<div class="flex-1 min-w-0">'
 +'<div class="flex items-center gap-x-2 gap-y-1.5 flex-wrap"><span class="cardTitle text-[13px] font-semibold text-slate-100 leading-tight hover:text-teal-300 cursor-pointer underline decoration-dotted decoration-slate-600 underline-offset-2" data-flip="'+it.id+'" title="Click for a summary and full breakdown">'+esc(it.title)+'</span><span class="chip" style="color:'+k.c+';border-color:'+k.c+'44">'+k.label+'</span><span class="chip" style="color:#5eead4;border-color:#5eead455">'+esc(it.rating)+'</span>'+'<span class="chip" style="color:#fbbf24;border-color:#fbbf2444" title="GOAT match /100">\u2605 '+it.gm+'</span>'+(window._blendActive?'<span class="chip" style="color:#0B0F19;background:#34d399;border-color:#34d399;font-weight:800" title="Weighted blend match">\u2696 '+bespokeScore(it).toFixed(0)+'%</span>':'')+(it.chFlag?'<span class="chip" style="color:#0B0F19;background:#c084fc;border-color:#c084fc;font-weight:700">\u25c9 CANON 100</span>':(it.ch>=70?'<span class="chip" style="color:#c084fc;border-color:#c084fc44">\u25c9 '+it.ch+'</span>':''))+'</div>'
 +'<div class="text-[11px] text-slate-400 mt-1.5 truncate" title="'+esc(it.creator)+' · '+esc(it.org)+'">'+it.year+' · '+esc(it.creator)+' · '+esc(it.span)+'</div>'
 +'<div class="mt-2 space-y-1 cardMicro" title="This work\'s 3 strongest indices out of ~19 tracked -- click the card to see all of them">'+frontBars(it)+'</div>'
 +'</div><span class="text-slate-600 text-xs mt-1" aria-hidden="true">&#9662;</span></button>'+'<button type="button" class="wlBtn absolute top-2 right-2 text-base leading-none transition-transform hover:scale-125" data-wl="'+it.id+'" title="Toggle watchlist" aria-label="'+(wlHas(it.id)?'Remove from watchlist':'Add to watchlist')+'" style="color:'+(wlHas(it.id)?'#fb7185':'#475569')+'">'+(wlHas(it.id)?'\u2665':'\u2661')+'</button>'
 +tierRowHTML(it)
 +summaryHTML(it)
 +'<div class="detail hidden border-t border-slate-800/80 px-3.5 py-3.5 bg-[#0b1322]/60">'
 +'<div class="fidGrid">'+it.fid.map(f=>microBar2(f[0],f[1])).join('')+microBar2('Audience Score',it.aud)+microBar2('Critical Score',it.crit)+'</div>'
 +'<div class="idxGrid">'+[['\u2605 GOAT Match',it.gm,'#fbbf24'],['\u25c9 Cosmic Horror',it.ch,'#c084fc'],['Soundtrack',it.snd,'#7dd3fc'],['4K Reference',it.ref,'#818cf8'],['Emotional',it.emo,'#f0abfc'],['Awe / Spectacle',it.awe,'#fbbf24'],['Comfort',it.cozy,'#34d399'],['Performances',it.perf,'#fda4af'],['Iconicness',it.icon,'#fcd34d'],['Scariest',it.scary,'#f87171'],['Realism',it.real,'#86efac'],['Reality-Altering',it.reality,'#c4b5fd'],['Genuine Shock',it.shock,'#fb923c'],['Scientific',it.sci,'#67e8f9'],['Funniest',it.funny,'#fde047'],['Historically Accurate',it.hist,'#a3e635'],['Vibe / Atmosphere',it.vibe2,'#e879f9']].map(r=>'<div class="flex flex-col gap-0.5"><div class="flex items-baseline justify-between gap-2"><span class="lbl leading-tight" style="color:'+r[2]+'">'+r[0]+'</span><span class="text-[10px] tabular-nums shrink-0" style="color:'+r[2]+'">'+r[1]+'</span></div><div class="bar"><i style="width:'+r[1]+'%;background:'+r[2]+'"></i></div></div>').join('')+'</div>'
 +gmBreakdownHTML(it)
 +'<p class="text-[11px] text-slate-300 mt-2.5 italic">&ldquo;'+esc(it.just)+'&rdquo;</p>'
 +'<div class="flex flex-wrap gap-1.5 mt-2.5">'+it.genres.map(g=>{const boosted=(PERSONAL_PROFILE.genreBoost||[]).some(gb=>gb[0]===g.toLowerCase());return '<span class="chip" title="'+(boosted?'A genre your taste profile currently weights up':'Genre')+'"'+(boosted?' style="color:#fbbf24;border-color:#fbbf2455"':'')+'>'+(boosted?'★ ':'')+esc(g)+'</span>';}).join('')+(function(){const vboosted=!!(PERSONAL_PROFILE.vibeBoost||{})[it.vibe];return '<span class="chip" title="'+(vboosted?'A vibe your taste profile currently weights up':'Vibe / mood')+'"'+(vboosted?' style="color:#fbbf24;border-color:#fbbf2455"':' style="color:#c4b5fd"')+'>'+(vboosted?'★ ':'')+esc(it.vibe)+'</span>';})()+'<span class="chip">'+esc(it.format)+'</span>'+it.plats.map(p=>'<span class="chip" style="color:#7dd3fc">'+esc(p)+'</span>').join('')+'</div>'
 +crossMediumPairingsHTML(it)
 +'<div class="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-slate-800/70">'
 +creatorBoostHTML(it)
 +(it.kind==='book'?'<button type="button" class="profEditBtn presetBtn" data-act="bookaffinity" data-id="'+it.id+'" title="Raise this book’s match-score floor directly, independent of genre/author boosts">'+((PERSONAL_PROFILE.bookAffinity||{})[it.id]?'+ Raise affinity ('+PERSONAL_PROFILE.bookAffinity[it.id]+')':'+ Boost affinity')+'</button>':'')
 +'</div>'
 +'</div>'+'</div>';}
function renderController(list){
 computeMatch(list);
 $('#resultCount').textContent=(list.length>state.limit?(state.limit+' of '+list.length):list.length);
 const m=list.filter(x=>x.kind==='movie').length,t=list.filter(x=>x.kind==='tv').length,g=list.length-m-t;
 const bk=list.filter(x=>x.kind==='book').length;const gg=list.filter(x=>x.kind==='game').length;$('#scopeBreak').textContent=' · '+m+' films / '+t+' series / '+gg+' games / '+bk+' books';
 let note='';
 if(state.sort==='blend')note=' · ⚖ weighted blend: Tech '+state.w.tech.toFixed(2)+' · Dread '+state.w.dread.toFixed(2)+' · Mind '+state.w.myst.toFixed(2);
 window._blendActive=(state.sort==='blend');
 const sorted=list.slice().sort(SORTS[state.sort]||SORTS.overall);
 $('#priorityNote').textContent=note;renderActiveBar();
 const shown=sorted.slice(0,state.limit);$('#grid').innerHTML=shown.map(cardHTML).join('')||'<div class="col-span-full text-center text-slate-500 text-sm py-14">No works match every active filter. Loosen a threshold, remove a chip, or widen your genres.</div>';
}
let activeBarExpanded=false;
function renderActiveBar(){
 const bar=$('#activeBar');if(!bar)return;const chips=[];
 const X=(label,clear)=>'<button type="button" class="chip activeChip" data-clr="'+clear+'" style="color:#fca5a5;border-color:#fca5a544">'+label+' ✕</button>';
 if(state.q)chips.push(X('“'+esc(state.q)+'”','q'));
 if(state.type!=='all')chips.push(X(KM[state.type].label,'type'));
 if(state.struct!=='all')chips.push(X(state.struct==='limited'?'Limited series':'Multi-season','struct'));
 state.plats.forEach(p=>chips.push(X(esc(p),'plat:'+p)));
 state.genres.forEach(g=>chips.push(X(esc(g),'genre:'+g)));
 state.genresExclude.forEach(g=>chips.push(X('✕ '+esc(g),'genreEx:'+g)));
 state.ratings.forEach(r=>chips.push(X(esc(r),'rating:'+r)));
 if(state.minGoat>0)chips.push(X('★ GOAT ≥'+state.minGoat,'minGoat'));
 if(state.idx.runtime>0)chips.push(X('Runtime ≤'+state.idx.runtime+'m','idx:runtime'));
 const IL={snd:'Soundtrack',ref:'4K Ref',ch:'◉ Cosmic',emo:'Emotional',awe:'Awe',cozy:'Comfort',perf:'Performances',icon:'Iconic',scary:'Scariest',real:'Realistic',reality:'Reality-Altering',dread:'Dread',myst:'Mind',shock:'Shocking',sci:'Scientific',funny:'Funniest',hist:'Historical',vibe2:'Vibe',crit:'Critical',aud:'Audience',tech:'Technical Craft'};
 Object.keys(IL).forEach(k=>{if(state.idx[k]>0)chips.push(X(IL[k]+' ≥'+state.idx[k],'idx:'+k));});
 if(state.yearMin!=null||state.yearMax!=null)chips.push(X('Year '+(state.yearMin||'←')+'–'+(state.yearMax||'→'),'year'));
 if(state.ownedOnly)chips.push(X('◆ Owned only','owned'));
 if(state.notOwnedOnly)chips.push(X('○ Not owned','notowned'));
 const TL={gold:'🥇 Gold',silver:'🥈 Silver',bronze:'🥉 Bronze'};
 state.tierFilter.forEach(t=>chips.push(X(TL[t],'tier:'+t)));
 if(state.combine&&chips.length)chips.unshift('<span class="chip" style="color:#fbbf24;border-color:#fbbf2455">STRICT AND</span>');
 // A heavily-filtered search (multi-platform, several genres in and out, half a dozen thresholds...)
 // can produce enough chips to wrap several rows and push the actual results far down the page.
 // Collapse past a threshold, same "N more" pattern used elsewhere in the app, rather than let the
 // bar grow without bound -- expand/collapse state is deliberately not persisted, just a per-visit
 // convenience.
 const OVERFLOW_AT=10;
 const overflowing=chips.length>OVERFLOW_AT;
 const shown=overflowing&&!activeBarExpanded?chips.slice(0,OVERFLOW_AT):chips;
 const moreBtn=overflowing?'<button type="button" id="activeBarToggle" class="chip" style="color:#7dd3fc;border-color:#7dd3fc44">'+(activeBarExpanded?'▲ show less':'▾ +'+(chips.length-OVERFLOW_AT)+' more')+'</button>':'';
 bar.innerHTML=chips.length?('<span class="lbl mr-1">Active:</span>'+shown.join('')+moreBtn+'<button type="button" id="clearAllF" class="chip" style="color:#94a3b8">clear all</button>'):'';
 if(!chips.length)activeBarExpanded=false; // reset so the next unrelated search doesn't open pre-expanded
}

/* ===================== VIEW 2 · BESPOKE TASTE ENGINE ===================== */
const PRESETS={dread:{tech:0.85,dread:0.95,myst:0.90},reference:{tech:1,dread:0.15,myst:0.2},puzzle:{tech:0.3,dread:0.45,myst:1},balanced:{tech:0.6,dread:0.6,myst:0.6}};

/* ===================== VIEW 3 · VISUALIZATION SUITE ===================== */
const CH={};
const RCOLORS=['#a5b4fc','#f0abfc','#5eead4'];
function chartsReady(){return typeof Chart!=='undefined';}
var _chartRetry=0;
function initCharts(){
 if(!chartsReady()){
  // Chart.js CDN may still be loading — poll briefly and self-heal instead of failing permanently.
  if(_chartRetry<40){_chartRetry++;setTimeout(function(){if(state.view==='viz'){initCharts();if(CH.bubble)updateCharts(filtered());}},250);
   if(_chartRetry>8)$$('.chartFail').forEach(e=>e.classList.remove('hidden'));
   return;}
  $$('.chartFail').forEach(e=>e.classList.remove('hidden'));return;
 }
 $$('.chartFail').forEach(e=>e.classList.add('hidden'));
 if(CH.bubble)return;
 Chart.defaults.color='#7c8aa5';Chart.defaults.borderColor='rgba(148,163,184,.08)';
 CH.bubble=new Chart($('#bubbleC'),{type:'bubble',data:{datasets:[]},options:{responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:c=>{const d=c.raw;return d.t+' ('+d.yr+') · Crit '+d.x+' · Aud '+d.y+' · Tech '+d.tech;}}}},
  scales:{x:{title:{display:true,text:'Critical Score'},suggestedMin:55,suggestedMax:100},y:{title:{display:true,text:'Audience Score'},suggestedMin:55,suggestedMax:100}}}});
 CH.radar=new Chart($('#radarC'),{type:'radar',data:{labels:['Critical','Audience','Technical','Dread / Tension','Complexity'],datasets:[]},options:{responsive:true,maintainAspectRatio:false,
  scales:{r:{min:0,max:100,ticks:{stepSize:20,backdropColor:'transparent'},grid:{color:'rgba(148,163,184,.12)'},angleLines:{color:'rgba(148,163,184,.12)'},pointLabels:{color:'#94a3b8',font:{size:10}}}},
  plugins:{legend:{labels:{usePointStyle:true,boxWidth:8}}}}});
 CH.decade=new Chart($('#decadeC'),{type:'bar',data:{labels:[],datasets:[]},options:{responsive:true,maintainAspectRatio:false,
  scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,title:{display:true,text:'Masterpieces indexed'}}},
  plugins:{legend:{labels:{usePointStyle:true,boxWidth:8}}}}});
 buildRadarSelects();updateRadar();
}
function updateCharts(list){
 $('#vizScope').textContent=list.length+' works in scope · Global Controller filters apply live to charts A and C.';
 if(!CH.bubble)return;
 CH._vizList=list;
 renderBubble();
 // Decade range used to be a hardcoded 1950-2020 window covering only 3 of the 4 media kinds --
 // that silently dropped every pre-1950 or post-2020 work (real ones exist today, e.g. 1920s films
 // and 2026 releases) and every book from the chart. Derived from the actual data instead, so it
 // stays correct as the corpus grows in either direction.
 const years=list.map(x=>x.year).filter(function(y){return y>0;});
 const minD=years.length?Math.floor(Math.min.apply(null,years)/10)*10:1950;
 const maxD=years.length?Math.floor(Math.max.apply(null,years)/10)*10:2020;
 const decs=[];for(let d=minD;d<=maxD;d+=10)decs.push(d);
 const cnt=k=>decs.map(d=>list.filter(x=>x.kind===k&&x.year>=d&&x.year<d+10).length);
 CH.decade.data.labels=decs.map(d=>d+'s');
 CH.decade.data.datasets=[
  {label:'Movies',data:cnt('movie'),backgroundColor:'#8b5cf6'},
  {label:'TV',data:cnt('tv'),backgroundColor:'#22d3ee'},
  {label:'Games',data:cnt('game'),backgroundColor:'#f59e0b'},
  {label:'Books',data:cnt('book'),backgroundColor:'#4ade80'}];
 CH.decade.update('none');
}
var bubbleMed='all';
// The field used to advertise a "min score 55+" label with no filter anywhere actually enforcing
// it -- every point in scope got plotted regardless, which on top of getting the number wrong could
// make the chart a several-thousand-point smear whenever the Global Controller had no filters
// active. bubbleMinScore is the real, live-adjustable threshold that label always should have been.
var bubbleMinScore=0;
function renderBubble(){
 if(!CH.bubble)return;var list=(CH._vizList||ALL).filter(function(x){return x.crit>=bubbleMinScore;});
 var mk=function(kind){return list.filter(function(x){return x.kind===kind;}).map(function(x){return {x:x.crit,y:x.aud,r:Math.max(3,Math.min(15,(x.tech-70)/2.1+3)),t:x.title,yr:x.year,tech:x.tech};});};
 var sets=[
  {label:'Movies',kind:'movie',data:mk('movie'),backgroundColor:'rgba(167,139,250,.45)',borderColor:'#a78bfa'},
  {label:'TV',kind:'tv',data:mk('tv'),backgroundColor:'rgba(34,211,238,.40)',borderColor:'#22d3ee'},
  {label:'Games',kind:'game',data:mk('game'),backgroundColor:'rgba(251,191,36,.40)',borderColor:'#fbbf24'},
  {label:'Books',kind:'book',data:mk('book'),backgroundColor:'rgba(74,222,128,.38)',borderColor:'#4ade80'}];
 CH.bubble.data.datasets=(bubbleMed==='all'?sets:sets.filter(function(d){return d.kind===bubbleMed;}));
 CH.bubble.update('none');
}
function fingerprintOf(val){
 if(!val)return null;
 const i=val.indexOf('::');if(i<0)return null;
 const kind=val.slice(0,i),key=val.slice(i+2);
 if(kind==='id'){const it=byId.get(key);if(!it)return null;return{label:it.title,data:[it.crit,it.aud,it.tech,it.dread,it.myst]};}
 const works=ALL.filter(x=>x.creator.includes(key));if(!works.length)return null;
 const avg=f=>Math.round(works.reduce((s,x)=>s+f(x),0)/works.length);
 return{label:key+' (avg of '+works.length+')',data:[avg(x=>x.crit),avg(x=>x.aud),avg(x=>x.tech),avg(x=>x.dread),avg(x=>x.myst)]};
}
// Options catalog for the radar comboboxes (built once)
function radarOptions(){
 var groups=[];
 [['Films','movie'],['TV Series','tv'],['Video Games','game'],['Books','book']].forEach(function(g){
  var opts=ALL.filter(function(x){return x.kind===g[1];}).sort(function(a,b){return b.gm-a.gm;}).map(function(x){return {v:'id::'+x.id,label:x.title+' ('+x.year+')',search:(x.title+' '+(x.creator||'')).toLowerCase()};});
  groups.push({name:g[0],opts:opts});
 });
 groups.push({name:'Directors Pantheon (avg)',opts:directorsPantheon.map(function(d){return {v:'cr::'+d.name,label:d.name,search:d.name.toLowerCase()};})});
 groups.push({name:'Gaming Auteurs (avg)',opts:gamingAuteurs.map(function(a){return {v:'cr::'+a.name,label:a.name,search:a.name.toLowerCase()};})});
 if(typeof authorsPantheon!=='undefined')groups.push({name:'Authors Pantheon (avg)',opts:authorsPantheon.map(function(a){return {v:'cr::'+a.name,label:a.name,search:a.name.toLowerCase()};})});
 return groups;
}
var RADAR_OPTS=null;
function radarLabelFor(v){
 if(!v)return '— empty slot —';
 if(!RADAR_OPTS)RADAR_OPTS=radarOptions();
 for(var i=0;i<RADAR_OPTS.length;i++){for(var j=0;j<RADAR_OPTS[i].opts.length;j++){if(RADAR_OPTS[i].opts[j].v===v)return RADAR_OPTS[i].opts[j].label;}}
 return v.indexOf('cr::')===0?v.slice(4):v;
}
function renderRadarList(combo,q){
 if(!RADAR_OPTS)RADAR_OPTS=radarOptions();
 q=(q||'').trim().toLowerCase();
 var cur=$('#'+combo.dataset.slot).value;
 var listEl=combo.querySelector('.rcList');
 var html='<div class="rcOpt'+(cur===''?' sel':'')+'" data-v="">— empty slot —</div>';
 var any=false;
 RADAR_OPTS.forEach(function(g){
  var matches=q?g.opts.filter(function(o){return o.search.indexOf(q)>=0;}):g.opts;
  if(!matches.length)return;
  any=true;
  html+='<div class="rcOptGroup">'+esc(g.name)+'</div>';
  html+=matches.slice(0,q?40:200).map(function(o){return '<div class="rcOpt'+(cur===o.v?' sel':'')+'" data-v="'+esc(o.v)+'" title="'+esc(o.label)+'">'+esc(o.label)+'</div>';}).join('');
 });
 if(!any)html='<div class="rcEmpty">No matches for “'+esc(q)+'”</div>';
 listEl.innerHTML=html;
}
function setRadarSlot(slot,v){
 $('#'+slot).value=v;
 var combo=$('.radarCombo[data-slot='+slot+']');
 if(combo)combo.querySelector('.rcLabel').textContent=radarLabelFor(v);
 updateRadar();
}
function buildRadarSelects(){
 RADAR_OPTS=radarOptions();
 // default selections (only if unset)
 var defs={r1:'id::m13',r2:'id::g02',r3:'cr::Stanley Kubrick'};
 ['r1','r2','r3'].forEach(function(slot){
  var hid=$('#'+slot);if(!hid)return;
  if(!hid.value)hid.value=defs[slot];
  var combo=$('.radarCombo[data-slot='+slot+']');
  if(combo)combo.querySelector('.rcLabel').textContent=radarLabelFor(hid.value);
 });
}
function updateRadar(){if(!CH.radar)return;
 CH.radar.data.datasets=['#r1','#r2','#r3'].map((s,i)=>{const f=fingerprintOf($(s).value);if(!f)return null;
  return{label:f.label,data:f.data,borderColor:RCOLORS[i],backgroundColor:RCOLORS[i]+'22',pointBackgroundColor:RCOLORS[i],borderWidth:2,pointRadius:2.5};}).filter(Boolean);
 CH.radar.update();
}

/* ===================== VIEW 4 · REFERENCE MATRICES ===================== */
function matrixRow(it,i,cols){const k=KM[it.kind];
 return '<div class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 goatJump cursor-pointer" data-q="'+esc(it.title)+'" title="Open in Global Controller">'
 +'<span class="text-[10px] text-slate-500 w-6 tabular-nums">'+String(i+1).padStart(2,'0')+'</span>'
 +'<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
 +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200" title="'+esc(it.title)+' · '+esc(it.creator)+'">'+esc(it.title)+' <span class="text-slate-500 text-[10px]">'+it.year+'</span>'+(it.owned?' <span style="color:#4ade80;font-size:9px;font-weight:700" title="Owned">\u2713</span>':'')+'</span>'
 +cols.map(c=>'<span class="hidden sm:flex items-center gap-1.5 w-24 shrink-0"><span class="bar flex-1"><i style="width:'+c[0]+'%;background:'+c[1]+'"></i></span><span class="text-[10px] tabular-nums text-slate-400 w-5 text-right">'+c[0]+'</span></span>').join('')
 +'</div>';}
// MATRIX_TITLES was being collected every render and never read anywhere -- the quick-jump nav
// below is what that collection was clearly meant to drive; with 18 independently-scrolling
// panels on one page there was previously no way to reach e.g. "Scariest" without scrolling past
// 17 others first.
var MATRIX_TITLES=[];
var matrixOwnedOnly=false;
var matrixNavQ='';
function slugify(s){return s.replace(/&[a-z]+;/gi,' ').replace(/[^\w\s-]/g,'').trim().toLowerCase().replace(/\s+/g,'-');}
function matrixBlock(title,sub,arr,colFn,heads){
 if(MATRIX_TITLES.indexOf(title)<0)MATRIX_TITLES.push(title);
 var shown=matrixOwnedOnly?arr.filter(function(x){return x.owned;}):arr;
 return '<div class="panel overflow-hidden fade-in" id="mx-'+slugify(title)+'"><div class="px-4 pt-4 pb-3 border-b border-slate-800/70">'
 +'<div class="flex items-baseline justify-between gap-2"><h3 class="text-[12px] font-bold tracking-[.14em] text-slate-100 uppercase">'+title+'</h3><span class="chip">'+shown.length+(matrixOwnedOnly?' owned':' qualify')+'</span></div>'
 +'<p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">'+sub+'</p>'
 +'<div class="hidden sm:flex justify-end gap-2.5 mt-2.5">'+heads.map(h=>'<span class="lbl w-24 text-right">'+h+'</span>').join('')+'</div></div>'
 +'<div class="max-h-[460px] overflow-y-auto">'+(shown.length?shown.map((it,i)=>matrixRow(it,i,colFn(it))).join(''):'<div class="px-4 py-6 text-center text-slate-500 text-[12px]">None of these are in your collection yet.</div>')+'</div></div>';
}
function renderMatrixNav(){
 var el=$('#matrixNav');if(!el)return;
 var q=(matrixNavQ||'').trim().toLowerCase();
 var titles=q?MATRIX_TITLES.filter(function(t){return t.toLowerCase().indexOf(q)>=0;}):MATRIX_TITLES;
 el.innerHTML=titles.length?titles.map(function(t){var label=t.replace(/&amp;/g,'&').replace(/&ge;/g,'≥').replace(/&le;/g,'≤');
  var slug=slugify(t);var panel=document.getElementById('mx-'+slug);var chip=panel?panel.querySelector('.chip'):null;var countLabel=chip?chip.textContent:'';
  return '<a href="#mx-'+slug+'" class="matrixNavLink text-[10.5px] px-2.5 py-1 rounded-lg border border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-300 transition-colors whitespace-nowrap flex items-center gap-1.5" data-anchor="mx-'+slug+'">'+label+(countLabel?'<span class="text-slate-600">·</span><span class="tabular-nums'+(matrixOwnedOnly?' text-emerald-400':'')+'">'+countLabel+'</span>':'')+'</a>';}).join('')
  :'<div class="text-[11px] text-slate-500 px-1 py-1">No brackets match “'+esc(q)+'”.</div>';
}
function renderMatrices(){
 MATRIX_TITLES=[];
 const ref=ALL.filter(x=>x.kind!=='game'&&x.fid[0][1]>=94&&x.fid[1][1]>=90).sort((a,b)=>(b.fid[0][1]+b.fid[1][1]+b.fid[2][1])-(a.fid[0][1]+a.fid[1][1]+a.fid[2][1]));
 const dread=ALL.filter(x=>x.dread>=90).sort((a,b)=>b.dread-a.dread);
 const myst=ALL.filter(x=>x.myst>=90).sort((a,b)=>b.myst-a.myst);
 const eldritch=ALL.filter(x=>x.ch>=78).sort((a,b)=>(b.ch-a.ch)||(b.dread-a.dread));
 $('#matrixWrap').innerHTML=
  matrixBlock('4K Physical UHD Reference Tier','Disc-pushing transfers and object-audio mixes for calibrated HDR rigs. Films &amp; series with Transfer &ge; 94 and Audio &ge; 90.',ref,it=>[[it.fid[0][1],'#818cf8'],[it.fid[1][1],'#7dd3fc'],[it.fid[2][1],'#c4b5fd']],['Transfer','Audio','Cinema'])
  +matrixBlock('\u266b Soundtrack &amp; Audio Hall','Reference scores and sound design \u2014 the works that justify the speakers. Soundtrack index &ge; 90.',ALL.filter(x=>x.snd>=90).sort((a,b)=>b.snd-a.snd),it=>[[it.snd,'#7dd3fc'],[it.ref,'#818cf8']],['Audio','4K'])
  +matrixBlock('\u2605 Peak GOAT Match \u2014 Tuned To You','The single highest personalized matches across every medium \u2014 your taste engine\u2019s top picks. GOAT match \u2265 90.',ALL.filter(x=>x.gm>=90).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr)),it=>[[it.gm,'#fbbf24'],[it.ovr,'#94a3b8']],['Match','Overall'])
  +matrixBlock('Atmospheric Isolation &amp; Cosmic Dread','High-tension slow-burns across every medium. Dread / Immersion Index &ge; 90.',dread,it=>[[it.dread,'#fb7185'],[it.tech,'#818cf8']],['Dread','Tech'])
  +matrixBlock('\u25c9 Eldritch Cosmic Horror Canon','The void looks back: indifferent universes, unknowable entities, sanity under siege. Cosmic Horror Index &ge; 78 \u2014 anchored to your declared canon.',eldritch,it=>[[it.ch,'#c084fc'],[it.dread,'#fb7185']],['Mind','Critic'])
  +matrixBlock('🌌 Cosmic Awe &amp; Sense of Wonder','Vastness, transcendence, the sublime \u2014 works that make you feel small before something immense. Awe index \u2265 88.',ALL.filter(x=>x.awe>=88).sort((a,b)=>b.awe-a.awe),it=>[[it.awe,'#38bdf8'],[it.myst,'#34d399']],['Awe','Mind'])
  +matrixBlock('Mind-Bending Puzzles &amp; Ontological Mysteries','Structural labyrinths, recursive timelines, bottomless systems. Complexity &ge; 90.',myst,it=>[[it.myst,'#34d399'],[it.crit,'#94a3b8']],['Mind','Critic'])
  +matrixBlock('🌀 Reality-Bending &amp; Surreal','Dream logic, unreliable realities, the floor dropping out \u2014 works that warp perception. Reality-warp index \u2265 82.',ALL.filter(x=>x.reality>=82).sort((a,b)=>b.reality-a.reality),it=>[[it.reality,'#a78bfa'],[it.myst,'#34d399']],['Warp','Mind'])
  +matrixBlock('\u269b Hard Science &amp; Big Ideas','Rigorous, idea-dense works \u2014 physics, cosmology, deep systems, real intellectual heft. Scientific index \u2265 80.',ALL.filter(x=>x.sci>=80).sort((a,b)=>b.sci-a.sci),it=>[[it.sci,'#22d3ee'],[it.myst,'#34d399']],['Science','Mind'])
  +matrixBlock('🤠 Best Western &amp; Frontier','Gunfighters, open ranges, dark Americana and the closing of the frontier \u2014 ranked by match. Western family, top of the bracket.',ALL.filter(x=>x.fam.indexOf('Western')>=0).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr)).slice(0,24),it=>[[it.gm,'#d97706'],[it.ovr,'#94a3b8']],['Match','Overall'])
  +matrixBlock('\u2694 War &amp; Valor','The chaos, cost and brotherhood of combat \u2014 from the trenches to the beaches. War family, ranked by match.',ALL.filter(x=>x.fam.indexOf('War')>=0).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr)).slice(0,24),it=>[[it.gm,'#a3a3a3'],[it.real,'#86efac']],['Match','Real'])
  +matrixBlock('💀 Scariest \u2014 Pure Horror','Dread made physical \u2014 the works that get under your skin and stay there. Scare index \u2265 82.',ALL.filter(x=>x.scary>=82).sort((a,b)=>b.scary-a.scary),it=>[[it.scary,'#f87171'],[it.dread,'#fb7185']],['Scare','Dread'])
  +matrixBlock('⚡ Genuine Shock &amp; The Twist','Gut-punch reveals and moments that rewrite everything before them. Shock index \u2265 80.',ALL.filter(x=>x.shock>=80).sort((a,b)=>b.shock-a.shock),it=>[[it.shock,'#fb923c'],[it.crit,'#94a3b8']],['Shock','Critic'])
  +matrixBlock('🗿 Iconic &amp; Culture-Defining','The landmarks \u2014 works that shaped the medium and lodged in the collective memory. Iconic index \u2265 84.',ALL.filter(x=>x.icon>=84).sort((a,b)=>(b.icon-a.icon)||(b.crit-a.crit)),it=>[[it.icon,'#fcd34d'],[it.crit,'#94a3b8']],['Iconic','Critic'])
  +matrixBlock('🏛 Historical Weight &amp; True Stories','Meticulously grounded history \u2014 the real events, rendered with rigor. Historical-accuracy index \u2265 72.',ALL.filter(x=>x.hist>=72).sort((a,b)=>b.hist-a.hist),it=>[[it.hist,'#a3e635'],[it.real,'#86efac']],['History','Real'])
  +matrixBlock('🎭 Bravura Performances','Career-defining acting and voice work \u2014 the roles that carry their whole piece. Performance index \u2265 88.',ALL.filter(x=>x.perf>=88).sort((a,b)=>b.perf-a.perf),it=>[[it.perf,'#f472b6'],[it.crit,'#94a3b8']],['Perf','Critic'])
  +matrixBlock('💧 Tearjerker &amp; Emotional Gut-Punch','Bring tissues \u2014 the most devastating, moving works across every medium. Emotional index \u2265 86.',ALL.filter(x=>x.emo>=86).sort((a,b)=>b.emo-a.emo),it=>[[it.emo,'#f0abfc'],[it.crit,'#94a3b8']],['Emotion','Critic'])
  +matrixBlock('😴 Comfort &amp; Warmth','Rainy-Sunday companions \u2014 the cozy, humane, restorative works to return to. Comfort index \u2265 74.',ALL.filter(x=>x.cozy>=74).sort((a,b)=>b.cozy-a.cozy),it=>[[it.cozy,'#fbbf24'],[it.aud,'#94a3b8']],['Comfort','Audience'])
  +matrixBlock('😀 Wit &amp; Comedy Peak','The sharpest, funniest works across every medium \u2014 satire, farce, and perfect timing. Comedy index \u2265 74.',ALL.filter(x=>x.funny>=74).sort((a,b)=>b.funny-a.funny),it=>[[it.funny,'#fde047'],[it.aud,'#94a3b8']],['Funny','Audience']);
 renderMatrixNav();
 var q=(matrixNavQ||'').trim().toLowerCase();
 if(q){$$('#matrixWrap > .panel').forEach(function(p){var h3=p.querySelector('h3');var match=h3&&h3.textContent.toLowerCase().indexOf(q)>=0;p.classList.toggle('hidden',!match);});}
}

/* ===================== VIEW 5 · PAN-CREATOR ARCHIVES ===================== */
function worksFor(name){return ALL.filter(x=>x.creator.includes(name)).sort((a,b)=>b.crit-a.crit);}
function creatorCard(c,tab){const isDir=tab===true||tab==='directors';const isAuthor=tab==='authors';const isAuteur=tab==='auteurs'||tab===false;const works=worksFor(c.name);const accent=isDir?'#a78bfa':(isAuthor?'#4ade80':'#fbbf24');
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
function sortCreatorPairs(pairs,sortMode){
 if(sortMode==='az')return pairs.slice().sort(function(a,b){return a[0].name.localeCompare(b[0].name);});
 if(sortMode==='works')return pairs.slice().sort(function(a,b){return (worksFor(b[0].name).length)-(worksFor(a[0].name).length);});
 return pairs;
}
function renderCreators(){const tab=state.creatorTab;
 const q=(state.creatorSearch||'').trim().toLowerCase();
 const scope=state.creatorSearchScope||'all';
 const sortMode=state.creatorSort||'default';
 var grid=$('#creatorGrid');
 if(q){
  // search across ALL pantheons by default, tagging each with its tab type -- optionally scoped
  // to just one pantheon via the search-scope segmented control.
  var all=directorsPantheon.map(c=>[c,'directors']).concat(authorsPantheon.map(c=>[c,'authors'])).concat(gamingAuteurs.map(c=>[c,'auteurs']));
  if(scope!=='all')all=all.filter(function(pair){return pair[1]===scope;});
  var hits=sortCreatorPairs(all.filter(function(pair){return pair[0].name.toLowerCase().indexOf(q)>=0;}),sortMode);
  grid.innerHTML=hits.length?hits.map(function(pair){return creatorCard(pair[0],pair[1]);}).join(''):'<div class="col-span-full text-center text-slate-500 text-sm py-10">No creator matches “'+esc(q)+'”.</div>';
  var cc=$('#creatorSearchCount');if(cc)cc.textContent=hits.length+' of '+(scope==='all'?CREATOR_TOTAL:all.length)+' creators';
  return;
 }
 var cc=$('#creatorSearchCount');if(cc)cc.textContent='';
 const data=tab==='directors'?directorsPantheon:(tab==='authors'?authorsPantheon:gamingAuteurs);
 const pairs=sortCreatorPairs(data.map(function(c){return [c,tab];}),sortMode);
 grid.innerHTML=pairs.map(function(pair){return creatorCard(pair[0],pair[1]);}).join('');
 $$('#creatorSeg button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
}

/* ===================== VIEW 6 · CONTENDERS LEDGER ===================== */
function gauge(p){const r=26,c=2*Math.PI*r,off=c*(1-p/100);const col=p>=90?'#34d399':p>=80?'#a5b4fc':p>=70?'#7dd3fc':'#fbbf24';
 return '<svg width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="'+r+'" fill="none" stroke="#1b2740" stroke-width="5"/><circle cx="32" cy="32" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="5" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 32 32)"/><text x="32" y="34" text-anchor="middle" dominant-baseline="middle" fill="#f1f5f9" font-size="15" font-weight="800">'+p+'</text></svg>';}
function gaugeC(p,col){const r=26,c=2*Math.PI*r,off=c*(1-p/100);return '<svg width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="'+r+'" fill="none" stroke="#1b2740" stroke-width="5"/><circle cx="32" cy="32" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="5" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 32 32)"/><text x="32" y="34" text-anchor="middle" dominant-baseline="middle" fill="#f1f5f9" font-size="15" font-weight="800">'+p+'</text></svg>';}
let graphCenter=null;
function graphNeighbors(center){
 // center is {type:'creator'|'work', key}. Returns nodes+links for a radial ego-graph.
 var nodes=[],links=[],seen={};
 function addNode(nd){if(seen[nd.id])return seen[nd.id];seen[nd.id]=nd;nodes.push(nd);return nd;}
 var c;
 if(center.type==='creator'){
  c=addNode({id:'cr:'+center.key,label:center.key,type:'creator',size:16,canon:false});
  var works=ALL.filter(function(x){return x.creator&&x.creator.indexOf(center.key)>=0;}).sort(function(a,b){return b.gm-a.gm;}).slice(0,8);
  works.forEach(function(w){var nd=addNode({id:w.id,label:w.title,type:'work',kind:w.kind,size:8+w.gm/14,canon:!!(w.goat||w.silver),ref:w});links.push({s:c.id,t:nd.id,kind:'made',why:center.key+' created “'+w.title+'”'});});
  // co-creators via shared families among those works (surface 4 related creators)
  var famSet={};works.forEach(function(w){(w.fam||[]).forEach(function(f){famSet[f]=1;});});
  var related={};
  ALL.forEach(function(x){if(!x.creator||x.creator.indexOf(center.key)>=0)return;var sh=(x.fam||[]).filter(function(f){return famSet[f];});if(sh.length>=2&&(x.goat||x.silver||x.gm>=88)){x.creator.split(/,| and | & /).forEach(function(cr){cr=cr.trim();if(cr.length>3)related[cr]=(related[cr]||0)+1;});}});
  Object.keys(related).sort(function(a,b){return related[b]-related[a];}).slice(0,5).forEach(function(cr){var nd=addNode({id:'cr:'+cr,label:cr,type:'creator',size:12,canon:false});links.push({s:c.id,t:nd.id,kind:'kin',why:'Shares recurring themes with '+center.key});});
 } else {
  var w=byId.get(center.key);if(!w)return {nodes:[],links:[]};
  c=addNode({id:w.id,label:w.title,type:'work',kind:w.kind,size:18,canon:!!(w.goat||w.silver),ref:w});
  // its creator
  if(w.creator){var cnd=addNode({id:'cr:'+w.creator,label:w.creator,type:'creator',size:13,canon:false});links.push({s:c.id,t:cnd.id,kind:'by',why:'Created by '+w.creator});}
  // sibling works by same creator
  ALL.filter(function(x){return x.id!==w.id&&x.creator&&w.creator&&x.creator===w.creator;}).sort(function(a,b){return b.gm-a.gm;}).slice(0,4).forEach(function(sib){var nd=addNode({id:sib.id,label:sib.title,type:'work',kind:sib.kind,size:8+sib.gm/16,canon:!!(sib.goat||sib.silver),ref:sib});links.push({s:c.id,t:nd.id,kind:'sibling',why:'Also by '+w.creator});});
  // thematic neighbors (shared families, high match, cross-medium preferred)
  var fams=w.fam||[];
  ALL.filter(function(x){return x.id!==w.id&&x.creator!==w.creator;}).map(function(x){var sh=(x.fam||[]).filter(function(f){return fams.indexOf(f)>=0;});return {x:x,sh:sh.length,cross:x.kind!==w.kind};}).filter(function(o){return o.sh>=2;}).sort(function(a,b){return (b.sh-a.sh)||(b.x.gm-a.x.gm);}).slice(0,6).forEach(function(o){var x=o.x;var shared=(x.fam||[]).filter(function(f){return fams.indexOf(f)>=0;}).slice(0,2).join(', ');var nd=addNode({id:x.id,label:x.title,type:'work',kind:x.kind,size:7+x.gm/16,canon:!!(x.goat||x.silver),ref:x});links.push({s:c.id,t:nd.id,kind:'theme',why:'Shared themes: '+shared});});
 }
 return {nodes:nodes,links:links,center:c};
}
var graphTrail=[];
function graphKey(center){return center.type+':'+center.key;}
function renderGraph(center,fromTrail){
 var wrap=$('#graphWrap');if(!wrap)return;
 // breadcrumb history: push unless we're navigating via the trail itself or repeating the current node
 if(!fromTrail){
  var k=graphKey(center);
  if(!graphCenter||graphKey(graphCenter)!==k){
   // if this node is already in the trail, truncate back to it; else append current before moving
   var existing=-1;graphTrail.forEach(function(t,i){if(graphKey(t)===k)existing=i;});
   if(existing>=0)graphTrail=graphTrail.slice(0,existing);
   else if(graphCenter)graphTrail.push(graphCenter);
   if(graphTrail.length>8)graphTrail=graphTrail.slice(-8);
  }
 }
 graphCenter=center;
 var g=graphNeighbors(center);
 if(!g.nodes.length){wrap.innerHTML='<div class="p-8 text-center text-slate-500 text-sm">Nothing to graph from here.</div>';return;}
 var Wd=wrap.clientWidth||760,Ht=470,cx=Wd/2,cy=Ht/2;
 var others=g.nodes.filter(function(nd){return nd.id!==g.center.id;});
 var R=Math.min(cx,cy)-70;
 g.center.x=cx;g.center.y=cy;
 others.forEach(function(nd,i){var ang=(i/others.length)*Math.PI*2-Math.PI/2;var rr=R*(nd.type==='creator'?0.72:1);nd.x=cx+Math.cos(ang)*rr;nd.y=cy+Math.sin(ang)*rr;});
 var pos={};g.nodes.forEach(function(nd){pos[nd.id]=nd;});
 var lkCol={made:'#a78bfa',by:'#a78bfa',kin:'#64748b',sibling:'#22d3ee',theme:'#c084fc'};
 var lkLabel={made:'created','by':'created by',kin:'kindred creator',sibling:'same creator',theme:'shared theme'};
 var svg='<svg viewBox="0 0 '+Wd+' '+Ht+'" style="width:100%;height:'+Ht+'px" xmlns="http://www.w3.org/2000/svg">';
 // edges (thicker invisible hit-area for easy hover, visible line on top, midpoint dot with reason)
 g.links.forEach(function(l){var a=pos[l.s],b=pos[l.t];if(!a||!b)return;var col=lkCol[l.kind]||'#475569';var why=l.why||lkLabel[l.kind]||'';
  svg+='<g class="gedge"><line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="transparent" stroke-width="12" style="cursor:help"><title>'+esc(why)+'</title></line>'
   +'<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+col+'" stroke-width="1.3" opacity="0.42" pointer-events="none"/></g>';});
 // nodes
 g.nodes.forEach(function(nd){
  var col=nd.type==='creator'?'#e2e8f0':(KM[nd.kind]?KM[nd.kind].c:'#94a3b8');
  var rr=nd.size;
  svg+='<g class="gnode" data-gtype="'+nd.type+'" data-gkey="'+esc(nd.type==='creator'?nd.label:nd.id)+'" style="cursor:pointer">';
  if(nd.canon)svg+='<circle cx="'+nd.x.toFixed(1)+'" cy="'+nd.y.toFixed(1)+'" r="'+(rr+3.5)+'" fill="none" stroke="#fbbf24" stroke-width="2"/>';
  svg+='<circle cx="'+nd.x.toFixed(1)+'" cy="'+nd.y.toFixed(1)+'" r="'+rr+'" fill="'+col+'" fill-opacity="'+(nd.type==='creator'?0.9:0.8)+'" stroke="#0a1120" stroke-width="1.5"><title>'+esc(nd.label)+(nd.ref?' \u00b7 \u2605'+nd.ref.gm:'')+(nd.type==='creator'?' \u00b7 click to explore':'')+'</title></circle>';
  var lbl=nd.label.length>22?nd.label.slice(0,20)+'\u2026':nd.label;
  var ty=nd.y+rr+11;
  svg+='<text x="'+nd.x.toFixed(1)+'" y="'+ty.toFixed(1)+'" text-anchor="middle" fill="'+(nd.id===g.center.id?'#f1f5f9':'#94a3b8')+'" font-size="'+(nd.id===g.center.id?11:9.5)+'" font-weight="'+(nd.id===g.center.id?700:400)+'" pointer-events="none">'+esc(lbl)+'</text>';
  svg+='</g>';
 });
 svg+='</svg>';
 // breadcrumb trail + legend
 var crumbs='';
 if(graphTrail.length){
  var backBtn='<button type="button" id="graphBack" class="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300 transition-colors shrink-0" title="Back one step">\u2190 Back</button>';
  var homeBtn='<button type="button" id="graphHome" class="px-2 py-1 rounded-md border border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300 transition-colors shrink-0" data-i="0" title="Jump to the start of this path">\u2302</button>';
  crumbs='<div id="graphTrail" class="flex items-center flex-wrap gap-1.5 mb-2.5 p-1.5 rounded-lg text-[11px]" style="background:rgba(15,22,38,.6);border:1px solid rgba(51,65,85,.5)">'
   +homeBtn+backBtn
   +'<span class="text-slate-600 mx-0.5">/</span>'
   +graphTrail.map(function(t,i){var lab=t.type==='creator'?t.key:((byId.get(t.key)||{}).title||t.key);return '<button type="button" class="graphCrumb px-2 py-1 rounded-md hover:bg-indigo-500/15 border border-transparent hover:border-indigo-500/40 text-slate-400 hover:text-indigo-200 transition-colors" data-i="'+i+'">'+esc(lab.length>18?lab.slice(0,16)+'\u2026':lab)+'</button><span class="text-slate-700">\u203a</span>';}).join('')
   +'<span class="px-2 py-1 rounded-md text-slate-100 font-semibold" style="background:#4f46e533;border:1px solid #6366f155">'+esc((center.type==='creator'?center.key:((byId.get(center.key)||{}).title||center.key)))+'</span>'
   +'</div>';
 }
 var legend='<div class="flex items-center flex-wrap gap-x-2 gap-y-1.5 mt-2.5 p-2 rounded-lg text-[9.5px] text-slate-400" style="background:rgba(15,22,38,.5);border:1px solid rgba(51,65,85,.4)">'
  +'<span class="flex items-center gap-1 px-1.5 py-0.5 rounded" style="background:#a78bfa1a"><span style="display:inline-block;width:10px;height:2px;background:#a78bfa;border-radius:2px"></span> creator/work</span>'
  +'<span class="flex items-center gap-1 px-1.5 py-0.5 rounded" style="background:#22d3ee1a"><span style="display:inline-block;width:10px;height:2px;background:#22d3ee;border-radius:2px"></span> same creator</span>'
  +'<span class="flex items-center gap-1 px-1.5 py-0.5 rounded" style="background:#c084fc1a"><span style="display:inline-block;width:10px;height:2px;background:#c084fc;border-radius:2px"></span> shared theme</span>'
  +'<span class="flex items-center gap-1 px-1.5 py-0.5 rounded" style="background:#64748b1a"><span style="display:inline-block;width:10px;height:2px;background:#64748b;border-radius:2px"></span> kindred creator</span>'
  +'<span class="flex items-center gap-1 px-1.5 py-0.5 rounded" style="background:#fbbf241a;color:#fbbf24"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid #fbbf24"></span> your canon</span>'
  +'<span class="text-slate-600 ml-auto">hover a line for why it connects</span></div>';
 wrap.innerHTML=crumbs+svg+legend;
}
function graphChips(){
 var el=$('#graphChips');if(!el)return;
 var seeds=[['creator','Christopher Nolan'],['creator','Denis Villeneuve'],['work','m09'],['creator','Cormac McCarthy'],['creator','John Carpenter'],['work','g45']];
 el.innerHTML=seeds.map(function(s){var lbl=s[0]==='creator'?s[1]:(byId.get(s[1])||{}).title||s[1];return '<button type="button" class="graphChip text-[10.5px] px-2 py-0.5 rounded-lg border border-slate-700 text-slate-300 hover:border-indigo-500 hover:text-indigo-300 transition-colors" data-gtype="'+s[0]+'" data-gkey="'+esc(s[0]==='creator'?s[1]:s[1])+'">'+esc(lbl)+'</button>';}).join('');
}
let contMedium='all';
let contUnverifiedOnly=false;
let contVerifiedOnly=false;
function anticipationScore(c){
 // Personal 'For You' anticipation: how much this upcoming release matches YOUR taste,
 // blended with the editorial GOAT probability. Driven by the creative lead's pull in your engine.
 var lead=(c.creativeLead||'');var pull=0;var reasons=[];
 GOAT_CREATOR_BOOST.forEach(function(b){if(lead.indexOf(b[0])>=0){pull=Math.max(pull,b[1]);reasons.push(b[0]+' is in your creator pantheon');}});
 if(typeof BOOK_CREATOR_BOOST!=='undefined')BOOK_CREATOR_BOOST.forEach(function(b){if(lead.indexOf(b[0])>=0){pull=Math.max(pull,b[1]);reasons.push(b[0]+' is a favorite author');}});
 // pantheon membership adds pull
 var inPantheon=(directorsPantheon.some(function(d){return lead.indexOf(d.name)>=0;})||gamingAuteurs.some(function(a){return lead.indexOf(a.name)>=0;})||(typeof authorsPantheon!=='undefined'&&authorsPantheon.some(function(a){return lead.indexOf(a.name)>=0;})));
 if(inPantheon){pull=Math.max(pull,8);if(!reasons.length)reasons.push(lead+' is a master creator you follow');}
 // do you own / love works by this lead already?
 var byLead=ALL.filter(function(x){return x.creator&&lead&&x.creator.indexOf(lead)>=0;});
 var ownedByLead=byLead.filter(function(x){return x.owned;}).length;
 var avgGm=byLead.length?Math.round(byLead.reduce(function(s,x){return s+x.gm;},0)/byLead.length):0;
 if(ownedByLead>=2)reasons.push('you own '+ownedByLead+' of their works');
 // blend: editorial probability (60%) + creator pull scaled (25%) + your avg match to their catalog (15%)
 var pullNorm=Math.min(100,50+pull*3.2);
 var score=Math.round(c.goatProbability*0.6+pullNorm*0.25+(avgGm||70)*0.15);
 score=Math.max(40,Math.min(99,score));
 // Your own watchlist is the strongest personal signal there is — it outranks any modelled score.
 if(c.watchRank){
  var floor=Math.round(99-(c.watchRank-1)*1.5);
  score=Math.max(score,floor);
  reasons.unshift('#'+c.watchRank+' on your personal watchlist');
 }
 return {score:score,reasons:reasons.slice(0,2),pull:pull,watch:c.watchRank||0};
}
var contSort='foryou';
var contSearchQ='';
/* Only trusts an unambiguous "Month DD, YYYY" window (e.g. "November 19, 2026") -- vaguer windows
   like a bare year or "shoots 2027" can't be reliably compared to today, so they're left alone
   rather than risk a false flag. */
function parseWindowDate(window){
 var m=(window||'').match(/([A-Z][a-z]+ \d{1,2},? \d{4})/);
 if(!m)return null;
 var d=new Date(m[1]);
 return isNaN(d.getTime())?null:d;
}
function isPastWindow(c){
 if(c.migratedTo||/^Released|^Cancelled/.test(c.window||''))return false;
 var d=parseWindowDate(c.window);
 return d?d.getTime()<Date.now():false;
}
function renderContenders(){const MED={Film:'#a78bfa',TV:'#22d3ee',Game:'#fbbf24',Book:'#4ade80'};
 var cq=(contSearchQ||'').trim().toLowerCase();
 var pool=contenders.slice().filter(c=>contMedium==='all'||c.medium===contMedium).filter(c=>!contUnverifiedOnly||!c.verified).filter(c=>!contVerifiedOnly||c.verified)
  .filter(c=>!cq||(c.title+' '+c.creativeLead+' '+c.platform).toLowerCase().indexOf(cq)>=0);
 pool.forEach(function(c){var a=anticipationScore(c);c._antScore=a.score;c._antReasons=a.reasons;});
 pool.sort(
  contSort==='foryou'?function(a,b){return b._antScore-a._antScore;}
  :contSort==='title'?function(a,b){return a.title.localeCompare(b.title);}
  :contSort==='window'?function(a,b){var da=parseWindowDate(a.window),db=parseWindowDate(b.window);if(!da&&!db)return 0;if(!da)return 1;if(!db)return -1;return da-db;}
  :function(a,b){return b.goatProbability-a.goatProbability;});
 $$('.contMedBtn').forEach(b=>{var on=b.dataset.med===contMedium;var mc=MED[b.dataset.med]||'#818cf8';b.style.color=on?mc:'#94a3b8';b.style.borderColor=on?mc+'88':'rgba(148,163,184,.25)';b.style.background=on?mc+'18':'transparent';b.style.fontWeight=on?'700':'400';});
 var cc=$('#contCount');if(cc)cc.textContent=pool.length+(contMedium==='all'?' contenders':' '+contMedium.toLowerCase()+' contenders');
 var vc=$('#contVerifiedCount');if(vc){var verifiedN=pool.filter(function(c){return c.verified;}).length;vc.textContent='◉ '+verifiedN+'/'+pool.length+' spot-checked';}
 // Each of "Verified only" / "Unverified only" is only useful -- and only shown -- when the
 // medium-scoped pool actually has something in that state to isolate, computed independent of
 // the checkboxes' own current state so toggling one on/off doesn't make its own control disappear
 // out from under the click.
 var mediumPool=contenders.filter(function(c){return contMedium==='all'||c.medium===contMedium;});
 var anyUnverified=mediumPool.some(function(c){return !c.verified;});
 var anyVerified=mediumPool.some(function(c){return c.verified;});
 var uw=$('#contUnverifiedOnlyWrap');
 if(uw){uw.classList.toggle('hidden',!anyUnverified);if(!anyUnverified&&contUnverifiedOnly){contUnverifiedOnly=false;var cb=$('#contUnverifiedOnly');if(cb)cb.checked=false;}}
 var vw=$('#contVerifiedOnlyWrap');
 if(vw){vw.classList.toggle('hidden',!anyVerified);if(!anyVerified&&contVerifiedOnly){contVerifiedOnly=false;var vcb=$('#contVerifiedOnly');if(vcb)vcb.checked=false;}}
 $('#contenderGrid').innerHTML=pool.map(c=>{const col=MED[c.medium]||'#94a3b8';
  var antCol=c._antScore>=88?'#fbbf24':c._antScore>=78?'#f0abfc':'#818cf8';
  var reasonLine=(c._antReasons&&c._antReasons.length)?'<div class="text-[10.5px] mt-1.5" style="color:'+antCol+'">\u2605 For you: '+esc(c._antReasons.join(' \u00b7 '))+'</div>':'';
  var MEDICON={Film:'🎬',TV:'📺',Game:'🎮',Book:'📖'};
  return '<div class="panel p-4 flex gap-3.5 fade-in"><div class="shrink-0 flex flex-col items-center gap-2.5">'
  +'<div class="flex flex-col items-center gap-0.5">'+gaugeC(c._antScore,antCol)+'<span class="lbl" style="color:'+antCol+';font-weight:700">For You</span></div>'
  +'<div class="flex flex-col items-center gap-0.5 opacity-60">'+gauge(c.goatProbability)+'<span class="lbl">Editorial</span></div></div>'
  +'<div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap"><span class="text-[14px] font-bold text-slate-50 leading-tight">'+esc(c.title)+'</span><span class="chip" style="color:'+col+';border-color:'+col+'44">'+(MEDICON[c.medium]||'')+' '+c.medium.toUpperCase()+'</span>'+(c.watchRank?'<span class="chip" style="color:#0B0F19;background:#fb7185;border-color:#fb7185;font-weight:800" title="On your personal watchlist">\u2665 WATCHLIST #'+c.watchRank+'</span>':'')+(c.migratedTo?'<button type="button" class="chip contMigratedBtn" data-q="'+esc(c.migratedTo)+'" style="color:#0B0F19;background:#4ade80;border-color:#4ade80;font-weight:800;cursor:pointer" title="Released and reconciled into the scored corpus with real review data \u2014 click to view it in the Global Controller">\u2713 IN LEDGER \u2014 VIEW SCORE</button>':'')+(isPastWindow(c)?'<span class="chip" style="color:#0B0F19;background:#fb923c;border-color:#fb923c;font-weight:800" title="This window has passed but the entry has not been checked or reconciled -- likely due for a status update (see NOTES.md refresh runbook).">\u26a0 WINDOW PASSED \u2014 CHECK STATUS</span>':'')+'</div>'
  +'<div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 mt-2 text-[11px]">'
  +'<span class="text-slate-500">Lead</span><span class="text-slate-200 min-w-0 truncate">'+esc(c.creativeLead)+'</span>'
  +'<span class="text-slate-500">Where</span><span class="text-slate-300 min-w-0 truncate">'+esc(c.platform)+'</span>'
  +'<span class="text-slate-500">Window</span><span class="text-indigo-300 font-semibold">'+esc(c.window)+'</span>'
  +'</div>'
  +reasonLine
  +'<p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">'+esc(c.pedigree)+'</p>'
  +(c.verified?'<div class="text-[9.5px] mt-1" style="color:#4ade8090" title="Release status and any review scores were checked against live sources on this date">◉ Spot-checked '+esc(c.verified)+'</div>':'<div class="text-[9.5px] mt-1" style="color:#f8717190" title="Still running on the original editorial estimate -- hasn’t been checked against live sources yet. See NOTES.md for the refresh runbook.">◯ Not yet spot-checked</div>')
  +'</div></div>';}).join('');
}

/* ===================== VIEW 7 · PERSONAL GOAT PROFILE ===================== */
const goatProfile={
 declared:[
  {cat:'Movies',items:[{name:'Oppenheimer',q:'Oppenheimer'},{name:'Interstellar',q:'Interstellar'},{name:'The Lord of the Rings trilogy',q:'Lord of the Rings'},{name:'The Odyssey (Nolan)',q:'Odyssey'}]},
  {cat:'Books',items:[{name:'The Lord of the Rings trilogy',q:'Fellowship'},{name:'The Fisherman',q:'Fisherman'},{name:'The Name of the Wind',q:'Name of the Wind'}]},
  {cat:'TV Shows',items:[{name:'True Detective S1',q:'True Detective'},{name:'Mr. Robot',q:'Mr. Robot'},{name:'M*A*S*H'}]},
  {cat:'Video Game',items:[{name:'Outer Wilds',q:'Outer Wilds',note:'without competition'}]},
  {cat:'Director',items:[{name:'Christopher Nolan'}]},
  {cat:'Actors',items:[{name:'Cillian Murphy'},{name:'Robin Williams'}]},
  {cat:'Composers',items:[{name:'Hans Zimmer'},{name:'Ludwig G\u00f6ransson'}]},
  {cat:'Cinematographer',items:[{name:'Hoyte van Hoytema'}]},
  {cat:'Artist',items:[{name:'Johnny Cash',note:'without competition'}]},
  {cat:'YouTube',items:[{name:'Markiplier'}]}
 ],
 recs:[
  {cat:'Movies',basis:'Projected from Oppenheimer, Interstellar and LOTR: cosmic scale + human intimacy, time, mortality, practical craft.',items:[{n:'Dune: Part Two',s:97,k:'movie',q:'Dune: Part Two',why:'Villeneuve\u2019s desert cathedral \u2014 prophecy, scale and dread in the exact key of your canon.'},{n:'Blade Runner 2049',s:96,k:'movie',q:'Blade Runner 2049',why:'Villeneuve + Deakins + Zimmer \u2014 the precise scale-and-melancholy your favorites live in.'},{n:'Sicario',s:93,k:'movie',q:'Sicario',why:'Villeneuve dread with Deakins light; procedural tension pulled taut as wire.'},{n:'The Assassination of Jesse James',s:92,k:'movie',q:'Assassination of Jesse James',why:'Elegiac, Deakins-shot Americana \u2014 mythic melancholy and Cash-scored patience.'},{n:'Close Encounters of the Third Kind',s:91,k:'movie',q:'Close Encounters',why:'Spielberg\u2019s awe-struck first contact \u2014 five notes and a mountain of longing.'},{n:'Ad Astra',s:90,k:'movie',why:'A lonely space odyssey about fathers and the void; Interstellar\u2019s quiet cousin.'},{n:'First Man',s:89,k:'movie',why:'Chazelle\u2019s Armstrong \u2014 practical, grounded spaceflight with an aching interior.'},{n:'Prisoners',s:88,k:'movie',q:'Prisoners',why:'Villeneuve + Deakins moral-abyss thriller; dread and consequence, no easy exits.'},{n:'The Master',s:87,k:'movie',q:'The Master',why:'PTA + Hoffman + 70mm; a hypnotic study of belief, control and damaged men.'},{n:'Children of Men',s:86,k:'movie',q:'Children of Men',why:'Cuar\u00f3n\u2019s single-take despair-and-hope masterwork; grounded speculative dread.'}]},
  {cat:'Books',basis:'Projected from LOTR, The Fisherman and Name of the Wind: cosmic horror, hard SF, weird fiction, mythic fantasy, ideas.',items:[{n:'The Left Hand of Darkness',s:93,k:'book',q:'The Left Hand of Darkness',why:'Le Guin\u2019s ansible-cold anthropology of gender and loyalty; SF as literature.'},{n:'Stories of Your Life and Others',s:92,k:'book',q:'Stories of Your Life',why:'Ted Chiang\u2019s perfect idea-stories \u2014 Arrival\u2019s source; awe with airtight logic.'},{n:'Perdido Street Station',s:92,k:'book',q:'Perdido Street Station',why:'Mi\u00e9ville\u2019s teeming New Weird city; grotesque, inventive, unforgettable.'},{n:'The Fifth Head of Cerberus',s:91,k:'book',q:'Fifth Head of Cerberus',why:'Gene Wolfe\u2019s dense identity puzzle-box \u2014 rewards the obsessive reread you give LOTR.'},{n:'The Ballad of Black Tom',s:90,k:'book',q:'Ballad of Black Tom',why:'LaValle rewrites Lovecraft with rage and soul; cosmic horror reclaimed.'},{n:'The Expanse: Leviathan Wakes',s:89,k:'book',q:'Leviathan Wakes',why:'The definitive modern space opera \u2014 noir detective meets system-wide dread.'},{n:'A Canticle for Leibowitz',s:88,k:'book',q:'Canticle for Leibowitz',why:'Monks preserve knowledge across a post-nuclear deep-time; mournful, profound SF.'},{n:'The Lions of Al-Rassan',s:88,k:'book',q:'Lions of Al-Rassan',why:'Guy Gavriel Kay\u2019s moorish-Spain epic \u2014 heartbreak and grandeur, Rothfuss-lush prose.'},{n:'Exhalation',s:87,k:'book',q:'Exhalation',why:'More impeccable Chiang thought-experiments; rigorous wonder, humane to the core.'},{n:'The Ocean at the End of the Lane',s:86,k:'book',q:'Ocean at the End of the Lane',why:'Gaiman\u2019s tender childhood-and-terror fable; myth pressing at ordinary life.'}]},
  {cat:'TV Series',basis:'Projected from True Detective S1, Mr. Robot and M*A*S*H: dread, obsession, philosophical weight, wounded men.',items:[{n:'Severance',s:95,k:'tv',q:'Severance',why:'Corporate dread as a puzzle-box of the self; the eeriest workplace ever filmed.'},{n:'The Leftovers',s:94,k:'tv',q:'The Leftovers',why:'Grief, faith and the unexplained \u2014 the most emotionally devastating prestige drama.'},{n:'Devs',s:91,k:'tv',q:'Devs',why:'Garland\u2019s determinism thriller; quantum dread with a monastic hum.'},{n:'Andor',s:90,k:'tv',q:'Andor',why:'Star Wars as a le Carr\u00e9 novel \u2014 patient, adult, revolutionary tension.'},{n:'The Expanse',s:89,k:'tv',q:'The Expanse',why:'Hard-SF politics with weight and grime; the space opera your Expanse shelf demands.'},{n:'For All Mankind',s:88,k:'tv',q:'For All Mankind',why:'An alternate space race that never stops \u2014 optimism engineered like Apollo.'},{n:'Hannibal',s:88,k:'tv',q:'Hannibal',why:'Baroque, operatic dread \u2014 the most beautiful nightmare on television; True Detective\u2019s aesthetic sibling.'},{n:'Better Call Saul',s:87,k:'tv',q:'Better Call Saul',why:'A slow-motion moral tragedy; the finest character erosion on television.'},{n:'Dark',s:86,k:'tv',q:'Dark',why:'A time-loop town where everything connects; puzzle-box dread you decode for years.'},{n:'Mindhunter',s:85,k:'tv',q:'Mindhunter',why:'Fincher-cold procedural into the minds of monsters; True Detective\u2019s clinical sibling.'}]},
  {cat:'Video Games',basis:'Projected from Outer Wilds: mystery-as-mechanic, cosmic awe, knowledge-gated progression, lonely wonder.',items:[{n:'Return of the Obra Dinn',s:93,k:'game',q:'Obra Dinn',why:'Deduction as the entire game \u2014 Outer Wilds\u2019 knowledge-progression in a ghost ship.'},{n:'Tunic',s:92,k:'game',q:'Tunic',why:'A hidden manual you assemble page by page; secrets rewarding the Outer Wilds brain.'},{n:'Blue Prince',s:91,k:'game',q:'Blue Prince',why:'A shifting manor of deductive puzzles; the purest 2025 heir to mystery-as-mechanic.'},{n:'Subnautica',s:90,k:'game',q:'Subnautica',why:'Alien-ocean awe and dread; wonder and terror in the same held breath.'},{n:'Animal Well',s:89,k:'game',q:'Animal Well',why:'A dense secret-box metroidvania; every screen hides a knowledge-gated marvel.'},{n:'SOMA',s:88,k:'game',q:'SOMA',why:'Underwater existential horror about consciousness; cosmic dread with a thesis.'},{n:'The Witness',s:88,k:'game',q:'The Witness',why:'An island that teaches you its language wordlessly; pure epiphany-as-progress.'},{n:'Disco Elysium',s:87,k:'game',q:'Disco Elysium',why:'The most literate RPG ever written; a wounded detective and a whole broken worldview.'},{n:'The Talos Principle 2',s:86,k:'game',q:'Talos Principle 2',why:'Philosophy-soaked puzzles about consciousness and what comes after humanity.'},{n:'Lorelei and the Laser Eyes',s:85,k:'game',q:'Lorelei',why:'A surreal puzzle-mansion of nested mysteries; Obra Dinn\u2019s dreamlike cousin.'}]},
  {cat:'Directors',basis:'Projected from Nolan worship: architects of scale, time and practical craft.',items:[
   {n:'Denis Villeneuve',s:97,k:'movie',why:'The other living master of monumental, sincere sci-fi.',tags:['sci-fi','space','epic']},
   {n:'Stanley Kubrick',s:93,k:'movie',why:'Nolan\u2019s declared north star; 2001 is Interstellar\u2019s father.',tags:['sci-fi','psychological','epic']},
   {n:'Alex Garland',s:90,k:'movie',why:'Ideas-first sci-fi \u2014 Devs is the most Nolan show not by Nolan.',tags:['sci-fi','psychological']},
   {n:'David Fincher',s:89,k:'movie',why:'Forensic precision; Mr. Robot is built from his grammar.',tags:['crime','psychological']},
   {n:'Alfonso Cuar\u00f3n',s:89,k:'movie',why:'Gravity and Children of Men \u2014 long-take awe under pressure.',tags:['sci-fi','drama']},
   {n:'Damien Chazelle',s:88,why:'First Man: the most Interstellar-coded film outside Nolan.',tags:['drama','space']},
   {n:'Sam Mendes',s:87,k:'movie',why:'1917 \u2014 one continuous breath of war-film craft.',tags:['war','epic']},
   {n:'Ridley Scott',s:86,k:'movie',why:'World-building density; the lived-in epic\u2019s inventor.',tags:['sci-fi','epic','historical']},
   {n:'Steven Spielberg',s:86,k:'movie',why:'Awe engineering itself \u2014 plus Band of Brothers stewardship.',tags:['war','epic','space']},
   {n:'Joseph Kosinski',s:84,k:'movie',why:'Maverick\u2019s practical-first doctrine is pure Nolan creed.',tags:['epic']}]},
  {cat:'Actors',basis:'Projected from Cillian Murphy and Robin Williams: quiet intensity + comedy hiding deep drama.',items:[
   {n:'Philip Seymour Hoffman',s:94,why:'The Master of interior storms \u2014 Murphy-grade stillness.',tags:['psychological','drama'],works:['The Master','Capote','Doubt','Magnolia','Boogie Nights']},
   {n:'Matthew McConaughey',s:93,why:'Your double feature already: Interstellar AND True Detective S1.',tags:['mystery','space','psychological'],works:['Interstellar','True Detective']},
   {n:'Daniel Day-Lewis',s:93,why:'Total-immersion gravity; There Will Be Blood is Oppenheimer\u2019s kin.',tags:['historical','drama'],works:['There Will Be Blood','Phantom Thread']},
   {n:'Gary Oldman',s:92,why:'Chameleon intensity; already orbiting Nolan\u2019s ensembles.',tags:['war','historical'],works:['The Dark Knight','The Fifth Element']},
   {n:'Christian Bale',s:91,why:'Nolan\u2019s other obsessive lead \u2014 The Prestige, the Trilogy.',tags:['psychological','crime'],works:['The Prestige','The Dark Knight','Vice']},
   {n:'Jim Carrey',s:90,why:'The Robin Williams path: comedian to devastating dramatist.',tags:['drama'],works:['Eternal Sunshine of the Spotless Mind','The Truman Show']},
   {n:'Mads Mikkelsen',s:89,why:'European stillness that reads like Murphy\u2019s blue-eyed menace.',tags:['psychological','crime'],works:['Hannibal','The Hunt']},
   {n:'Robert Downey Jr.',s:88,why:'His Oppenheimer turn proves the dramatic ceiling you value.',tags:['historical','drama'],works:['Oppenheimer','Zodiac']},
   {n:'Rami Malek',s:87,why:'Elliot Alderson \u2014 fragility and precision you already trust.',tags:['psychological','crime'],works:['Mr. Robot','Bohemian Rhapsody']},
   {n:'Andrew Scott',s:86,why:'Ripley\u2019s slow-burn interiority; magnetic restraint.',tags:['psychological','mystery'],works:['Ripley']}]},
  {cat:'Composers',basis:'Projected from Zimmer + G\u00f6ransson: massive texture, ticking clocks, melody as physics.',items:[
   {n:'Andrew Prahlow',s:96,why:'The Outer Wilds score \u2014 your GOAT game\u2019s entire soul is his.',tags:['space','mystery'],works:['Outer Wilds']},
   {n:'Howard Shore',s:95,why:'The LOTR trilogy\u2019s leitmotif cathedral; already your canon.',tags:['epic','historical'],works:['The Lord of the Rings: The Fellowship of the Ring','Se7en','The Silence of the Lambs']},
   {n:'J\u00f3hann J\u00f3hannsson',s:94,why:'Sicario and Arrival \u2014 dread and wonder as sub-bass.',tags:['sci-fi','psychological'],works:['Sicario','Arrival']},
   {n:'Hildur Gu\u00f0nad\u00f3ttir',s:93,why:'Chernobyl scored from reactor recordings; texture as terror.',tags:['historical','psychological'],works:['Chernobyl','Joker']},
   {n:'Max Richter',s:92,why:'On the Nature of Daylight \u2014 time-and-grief minimalism.',tags:['drama','time'],works:['Ad Astra','The Leftovers']},
   {n:'Trent Reznor & Atticus Ross',s:91,why:'Electronic dread with machine pulse; Fincher\u2019s engine room.',tags:['psychological','crime'],works:['The Social Network','Gone Girl','Soul','Watchmen']},
   {n:'John Williams',s:90,why:'The melodic awe tradition Zimmer rebuilt in concrete.',tags:['space','epic'],works:['Jaws','E.T. the Extra-Terrestrial',"Schindler's List",'Jurassic Park','Close Encounters of the Third Kind']},
   {n:'Mac Quayle',s:88,why:'The actual Mr. Robot score \u2014 synth anxiety you already love.',tags:['psychological','crime'],works:['Mr. Robot']},
   {n:'Benjamin Wallfisch',s:87,why:'Zimmer\u2019s 2049 co-architect; the same wall of brass.',tags:['sci-fi','space'],works:['Blade Runner 2049','It']},
   {n:'Ramin Djawadi',s:85,why:'Westworld\u2019s player-piano \u2014 theme-craft at series scale.',tags:['epic','sci-fi'],works:['Westworld','Game of Thrones']}]},
  {cat:'Cinematographers',basis:'Projected from van Hoytema: large-format scale, natural light, faces against the void.',items:[
   {n:'Roger Deakins',s:97,why:'1917, Sicario, 2049 \u2014 the living ceiling of the craft.',tags:['war','crime','epic'],works:['1917','Sicario','Blade Runner 2049']},
   {n:'Greig Fraser',s:95,why:'Dune\u2019s desert light; the heir to monumental large-format.',tags:['sci-fi','space','epic'],works:['Dune: Part Two','Dune']},
   {n:'Emmanuel Lubezki',s:93,why:'Gravity and The Revenant \u2014 natural-light awe in motion.',tags:['drama','space'],works:['Gravity','The Revenant']},
   {n:'Wally Pfister',s:92,why:'Nolan\u2019s eye before Hoyte: Inception, The Prestige, TDK.',tags:['sci-fi','psychological'],works:['Inception','The Prestige','The Dark Knight']},
   {n:'Andrew Lesnie',s:91,why:'Middle-earth\u2019s light \u2014 the trilogy you already canonized.',tags:['epic','historical'],works:['The Lord of the Rings: The Fellowship of the Ring','King Kong']},
   {n:'Bradford Young',s:89,why:'Arrival\u2019s soft gravity; intimacy at alien scale.',tags:['sci-fi','drama'],works:['Arrival','Selma']},
   {n:'Linus Sandgren',s:88,why:'First Man\u2019s cockpit grain \u2014 IMAX awe earned by friction.',tags:['space','drama'],works:['La La Land','American Hustle']},
   {n:'Janusz Kami\u0144ski',s:87,why:'Band of Brothers\u2019 desaturated war language came from him.',tags:['war','historical'],works:['Band of Brothers','Saving Private Ryan']},
   {n:'Claudio Miranda',s:86,why:'Maverick\u2019s real-G cockpits; practical spectacle doctrine.',tags:['epic','drama'],works:['Top Gun: Maverick','Life of Pi']},
   {n:'Jakob Ihre',s:85,why:'Chernobyl\u2019s sickly fluorescents \u2014 dread you can see.',tags:['historical','psychological'],works:['Chernobyl']}]},
  {cat:'Music Artists',basis:'Projected from Johnny Cash: outlaw baritones, dark Americana, redemption and gravitas.',items:[
   {n:'Colter Wall',s:96,why:'The closest living heir to the Cash baritone; prairie-gothic ballads.',tags:['western','historical'],vibes:['Slow-Burn Evening']},
   {n:'Bruce Springsteen (Nebraska era)',s:94,why:'Stark acoustic Americana about guilt, ghosts and highways.',tags:['western','drama'],vibes:['Rainy Sunday Comfort']},
   {n:'Waylon Jennings',s:93,why:'Outlaw country first principles; Cash\u2019s Highwaymen brother.',tags:['western'],vibes:['Slow-Burn Evening']},
   {n:'Nick Cave & The Bad Seeds',s:92,why:'Murder ballads and biblical dread \u2014 Cash covered him back.',tags:['western','psychological'],vibes:['Midnight Ritual']},
   {n:'Sturgill Simpson',s:90,why:'Outlaw voice aimed at metaphysics; country that thinks cosmically.',tags:['western','space'],vibes:['Late-Night Cosmic Dread']},
   {n:'Leonard Cohen',s:89,why:'Late-period Cohen shares American Recordings\u2019 deathbed gravity.',tags:['drama','psychological'],vibes:['Midnight Ritual']},
   {n:'Kris Kristofferson',s:88,why:'The Highwaymen songwriter\u2019s pen \u2014 Sunday Mornin\u2019 melancholy.',tags:['western','drama'],vibes:['Rainy Sunday Comfort']},
   {n:'Tyler Childers',s:87,why:'Appalachian sincerity, fire-and-brimstone storytelling.',tags:['western','historical'],vibes:['Slow-Burn Evening']},
   {n:'Chris Stapleton',s:86,why:'Whiskey-deep voice carrying classic outlaw weight today.',tags:['western','drama'],vibes:['Rainy Sunday Comfort']},
   {n:'Marty Robbins',s:85,why:'Gunfighter ballads \u2014 the cinematic Old West Cash drew from.',tags:['western','historical'],vibes:['Slow-Burn Evening']}]},
  {cat:'YouTube',basis:'Projected from Markiplier + your cosmic streak: charismatic longform, space, mystery.',items:[
   {n:'Kurzgesagt',s:93,why:'Optimistic-nihilist cosmology \u2014 Outer Wilds energy, animated.',tags:['sci-fi','space'],vibes:['Notebook-and-Theories Night']},
   {n:'melodysheep',s:92,why:'Timelapse of the Future is Interstellar as a YouTube epic.',tags:['space','epic'],vibes:['Projector-Worthy Spectacle']},
   {n:'Jacob Geller',s:91,why:'Video essays on games and mortality; has an Outer Wilds classic.',tags:['psychological','mystery'],vibes:['Systems Rabbit Hole']},
   {n:'Veritasium',s:91,why:'Physics curiosity with production polish and real stakes.',tags:['sci-fi'],vibes:['Notebook-and-Theories Night']},
   {n:'LEMMiNO',s:90,why:'Cinematic deep-dive mysteries with True Detective patience.',tags:['mystery','psychological'],vibes:['Puzzle-Box Replay']},
   {n:'SmarterEveryDay',s:88,why:'Engineering wonder, humane and hands-on.',tags:['sci-fi'],vibes:['Notebook-and-Theories Night']},
   {n:'Game Maker\u2019s Toolkit',s:87,why:'Why Outer Wilds works, explained \u2014 design literacy fuel.',tags:['mystery'],vibes:['Systems Rabbit Hole']},
   {n:'Internet Historian',s:86,why:'Markiplier-grade charisma applied to documentary chaos.',tags:['historical','crime'],vibes:['Late-Night Channel Static']},
   {n:'Scott Manley',s:85,why:'Orbital mechanics and spaceflight, fly safe.',tags:['space','sci-fi'],vibes:['Sci-Fi Lore']},
   {n:'Jacksepticeye',s:84,why:'The adjacent let\u2019s-play energy if you want more Mark-likes.',tags:['drama'],vibes:['One-More-Run Loop']}]}
 ]
};
if(PROFILE_FROM_STORAGE)goatProfile.declared=PERSONAL_PROFILE.declaredCanon||[];
else PERSONAL_PROFILE.declaredCanon=goatProfile.declared;
/* --- Personal GOAT-match scoring across the full 2,502-work corpus --- */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.declaredGoatIds=['m09','m06','m65','t03','t10','g45','m120','b19','b20','b21','b32','b23'];
const GOAT_DECLARED=new Set(PERSONAL_PROFILE.declaredGoatIds||[]);
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.creatorBoost=[['Christopher Nolan',14],['Denis Villeneuve',12],['Peter Jackson',10],['Steven Spielberg',9],['Stanley Kubrick',9],['Alex Garland',8],['Sam Esmail',8],['Jonathan Nolan',8],['David Fincher',7],['Alfonso Cuar\u00f3n',7],['Ridley Scott',7],['Martin Scorsese',7],['John Carpenter',7],['Peter Weir',7],['Sam Mendes',6],['Craig Mazin',6],['Vince Gilligan',6],['Sergio Leone',6],['Ron Howard',6],['Quentin Tarantino',6],['Clint Eastwood',6],['Robert Zemeckis',6],['Frank Darabont',6],['Joel & Ethan Coen',5],['Gus Van Sant',5],['Joseph Kosinski',5],['Bong Joon-ho',5],['Paul Thomas Anderson',5],['Akira Kurosawa',5]];
const GOAT_CREATOR_BOOST=PERSONAL_PROFILE.creatorBoost||[];
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.genreBoost=[['time',6],['sci-fi',5],['epic',4],['space',4],['western',4],['mystery',3],['war',3],['psychological',4],['drama',3],['crime',3],['historical',3]];
const GOAT_GENRE_BOOST=PERSONAL_PROFILE.genreBoost||[];
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.vibeBoost={'Notebook-and-Theories Night':8,'Puzzle-Box Replay':7,'Reference Demo Night':4,'Projector-Worthy Spectacle':4,'Late-Night Cosmic Dread':3,'World-Builder Marathon':3,'Systems Rabbit Hole':3,'Appointment Slow-Burn':2};
const GOAT_VIBE_BOOST=PERSONAL_PROFILE.vibeBoost||{};
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.bookCreatorBoost=[['Tolkien',12],['Dan Simmons',9],['Patrick Rothfuss',9],['Ursula K. Le Guin',8],['Isaac Asimov',7],['Liu Cixin',7],['Carl Sagan',7],['Gene Wolfe',6],['Frank Herbert',6],['Arthur C. Clarke',5],['Neil deGrasse Tyson',5],['Walter Isaacson',5],['Yuval Noah Harari',4],['China Mi\u00e9ville',5],['Jeff VanderMeer',5],['H.P. Lovecraft',5],['Cormac McCarthy',5],['Neal Stephenson',5],['Ted Chiang',5],['Susanna Clarke',5],['Stephen King',8]];
const BOOK_CREATOR_BOOST=PERSONAL_PROFILE.bookCreatorBoost||[];
/* Does this work carry `keyword` as a genre, or as something that inherits from it?
   Looked up through data/genre-taxonomy.js rather than searched for as a substring.

   The substring version this replaces (`x.genres.join(' ').toLowerCase().includes(keyword)`) is
   the mechanism behind two of the worst defects this repo has had, and its failure mode is always
   the same: letters that happen to line up. A boost on "time" hit anything containing those four
   letters; one compound tag drew two different boosts because two keywords both appeared inside
   its name; and the reverse error is just as bad -- a plain exact match would stop a Horror boost
   from ever reaching Body Horror or Folk Horror, which is 27 tags in this corpus.

   Matching a declared inheritance list fixes both directions at once, and counts once per boost
   no matter how many of a work's tags inherit from the keyword -- so a work tagged both
   "Cosmic Horror" and "Gothic Horror" collects the Horror boost a single time, not twice. */
function genreMatches(x,keyword){
 const want=String(keyword).toLowerCase();
 const tax=(typeof GENRE_TAXONOMY!=='undefined')?GENRE_TAXONOMY:{};
 return (x.genres||[]).some(function(tag){
  const inherits=tax[tag]||[tag];
  return inherits.some(function(p){return p.toLowerCase()===want;});
 });
}
ALL.forEach(x=>{
 let base=0.5*x.crit+0.2*x.aud+0.3*x.tech,a=0;const br=[];
 GOAT_CREATOR_BOOST.forEach(c=>{if(x.creator.includes(c[0])){a+=c[1];br.push(['creator',c[0],c[1]]);}});
 if(x.kind==='book'){BOOK_CREATOR_BOOST.forEach(c=>{if(x.creator.includes(c[0])){a+=c[1];br.push(['author',c[0],c[1]]);}});}
 const gs=x.genres.join(' ').toLowerCase();
 GOAT_GENRE_BOOST.forEach(g=>{if(genreMatches(x,g[0])){a+=g[1];br.push(['genre',g[0],g[1]]);}});
 const vb=GOAT_VIBE_BOOST[x.vibe]||0;if(vb){a+=vb;br.push(['vibe',x.vibe,vb]);}
 if(x.myst>70){var mb=(x.myst-70)/6;a+=mb;br.push(['complexity','Ontological depth',Math.round(mb*10)/10]);}
 if(x.tech>85){var tb=(x.tech-85)/5;a+=tb;br.push(['craft','Technical craft',Math.round(tb*10)/10]);}
 /* No upper bound. This used to read `x.dread>80&&x.dread<=95`, which meant the boost climbed to
    +1.5 at dread 95 and then fell off a cliff to zero at 96 -- so the sixteen most dread-soaked
    works in the corpus (The Shining 97, The Thing 98, Hereditary 99, Come and See 99) were the
    only ones that got nothing for it. A threshold with a ceiling reads like a range check, but
    every other boost here is monotonic, and a taste signal that reverses at the top of its own
    scale is a bug in any reading. */
 if(x.dread>80){var db=(x.dread-80)/10;a+=db;br.push(['dread','Atmospheric dread',Math.round(db*10)/10]);}
 x.gm=Math.max(40,Math.min(99,Math.round(base*0.5+a*1.2+14)));
 x.goat=false;
 x.gmBase=Math.round(base*0.5+14);x.gmBoosts=br;x.gmBoostTotal=Math.round(a*1.2*10)/10;
});
/* ---- The tier ladder ----
   Gold / Silver / Bronze / merely-owned are four strengths of the same statement: "this matches
   me". Each lifts a work's match score toward a floor, and the floors are what separate them.

   Every rung blends the work's own score with its floor using the SAME weight, so the four are
   parallel lines that cannot cross. That is the whole fix here. They used to use different
   weights -- Silver 0.45/0.55, Bronze 0.65/0.35, owned 0.5/0.5 -- which made them lines of
   different slopes, and lines of different slopes intersect. Owned (floor 82) overtook Bronze
   (floor 80) below gm 86.7, so marking something Bronze did nothing at all to anything you own,
   which is most of what a person tiers. The ladder was only a ladder in the comment.

   Ownership sits at the bottom deliberately: you own things you have not decided about yet, so it
   is the weakest of the four signals. Gold is a pin to 100 rather than a blend, applied last.

   A rung only ever raises a score (each is applied with `if (target > gm)`), so being tiered can
   never cost a work anything, and the highest applicable rung wins regardless of evaluation
   order. */
const TIER_FLOOR={silver:88,bronze:84,owned:80};
const TIER_OWN_WEIGHT=0.5;
function tierTarget(gm,tier){return Math.round(gm*TIER_OWN_WEIGHT+TIER_FLOOR[tier]*(1-TIER_OWN_WEIGHT));}
/* Silver tier: declared second-tier favorites. Half the pull of a GOAT pick; lifts the floor and reshapes the algorithmic neighborhood. */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.silverTierIds=['m101','m102','m14','m12','m10','m81','m07','m02','m37','m84','m56','m103','m104','m20','m105','m106','t17','t47','t13','t101','m107','m108','m109','m110','m111','m112','m113','m114','m115','m116','m86','g101','m159'];
const GOAT_SILVER=new Set(PERSONAL_PROFILE.silverTierIds||[]);
ALL.forEach(x=>{x.silver=GOAT_SILVER.has(x.id);if(x.silver){var sg=tierTarget(x.gm,'silver');if(sg>x.gm){x.gm=sg;x.gmOverride=x.gmOverride||'silver';}}});
/* Bronze tier: a third, lighter-pull tier below Silver -- "really like, worth a nudge" rather than
   a full favorite. Same blend as every other rung, one floor lower (see the tier ladder above). */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.bronzeTierIds=[];
/* Pinned specialized-index sliders: a UI preference (which of the 17 Advanced sliders also show
   in the always-visible main filter row, alongside Technical Fidelity / GOAT Match / Cosmic Horror),
   not a taste signal -- doesn't affect scoring at all, just which controls are one click away.
   Defaults to 4K Reference + Soundtrack (see DEFAULT_PINNED_IDX below) so a fresh profile already
   shows 5 well-rounded quick filters instead of an empty row. */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.pinnedIdx=DEFAULT_PINNED_IDX.slice();
const GOAT_BRONZE=new Set(PERSONAL_PROFILE.bronzeTierIds||[]);
ALL.forEach(x=>{x.bronze=GOAT_BRONZE.has(x.id);if(x.bronze){var bg=tierTarget(x.gm,'bronze');if(bg>x.gm){x.gm=bg;x.gmOverride=x.gmOverride||'bronze';}}});
function tierRank(x){return x.goat?3:x.silver?2:x.bronze?1:0;}
/* Owned, but not tiered: the weakest rung of the ladder above -- a real signal, since you bought
   it, but weaker than any deliberate tier because you own things you have not judged yet. */
ALL.forEach(x=>{if(x.owned&&!x.goat){const target=tierTarget(x.gm,'owned');if(target>x.gm){x.gm=target;x.gmOverride=x.gmOverride||'owned';}x.ownedBoost=true;}});
/* Book affinity: your fingerprint (Tolkien mythology, cosmic horror, physics/space, sincere science bios) lifts matching books. */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.bookAffinity={b19:96,b20:94,b21:95,b18:90,b22:92,b31:86,b26:92,b08:94,b12:90,b34:90,b29:90,b30:88,b33:88,b32:86,b04:86,b02:84,b05:88,b09:84,b10:84,b38:86,b37:88,b39:90,b28:84,b27:86,b47:84,b40:82,b58:90,b153:90,b154:92,b71:92,b53:86,b155:84,b156:84,b64:86,b56:90,b148:88,b74:92,b118:88,b151:86,b152:88,b157:88,b158:88,b159:84,b160:88,b88:86,b96:82,b100:84,b54:90,b52:90,b55:92,b126:88,b129:86,b130:88,b131:88,b132:88,b133:90,b78:90,b77:90,b79:88,b68:84,b70:86,b72:82,b150:86,b149:86,b76:86,b161:82,b162:84,b163:84,b164:84,b165:82,b166:82,b167:88,b93:84,b94:78};
const BOOK_AFFINITY=PERSONAL_PROFILE.bookAffinity||{};
ALL.forEach(x=>{if(x.kind==='book'&&BOOK_AFFINITY[x.id]){x.gm=Math.max(x.gm,BOOK_AFFINITY[x.id]);}});
GOAT_DECLARED.forEach(id=>{const x=byId.get(id);if(x){x.gm=100;x.goat=true;x.gmOverride='declared';}});
/* ===== Generated recommendations, corpus-backed and people-backed (Phase 4 of the sharing roadmap) =====
   Movies/Books/TV Series/Video Games recommendations below are computed live from the same gm
   score (and its gmBoosts reasons) that PERSONAL_PROFILE drives everywhere else in the app,
   instead of being a fixed hand-picked list -- that's what makes them generalize to any declared
   canon, not just Payton's. (This replaces an older mechanism that nudged specific titles' gm up
   to match a hardcoded rec list; that's no longer needed now that recs are generated FROM gm.)

   Directors get the same treatment via a different route: every name in that curated list also
   directs real corpus entries (checked -- all 10 do), so their score is the average gm of their
   own top films/TV in the ledger. That's genuinely computed, not approximated, so Directors is
   marked generated:true just like the four corpus-backed categories above.

   The other five (Actors, Composers, Cinematographers, Music Artists, YouTube) have no such
   corpus to borrow from -- there's no dataset of actors or composers with their own genre/style
   metadata to rank against. Each hand-picked entry there carries a small `tags` array (genre
   keywords matching the vocabulary genreBoost already uses), and its score comes from how many of
   those tags a loaded profile happens to weight -- real signal, but coarser than a full corpus
   lookup, so these stay flagged `approx:true` and labeled accordingly rather than passed off as
   fully computed. Building an actual creator dataset to close that last gap is still the honest
   next step (see NOTES.md Phase 4). */
const RECS_KIND_BY_CAT={Movies:'movie',Books:'book','TV Series':'tv','Video Games':'game'};
const DECLARED_CAT_ALIASES={Movies:['Movies'],Books:['Books'],'TV Series':['TV Shows','TV Series'],'Video Games':['Video Game','Video Games'],Directors:['Director','Directors'],Actors:['Actors'],Composers:['Composers'],Cinematographers:['Cinematographer','Cinematographers'],'Music Artists':['Artist','Music Artists'],YouTube:['YouTube']};
function computeBasisText(cat){
 const declaredGroup=(PERSONAL_PROFILE.declaredCanon||[]).find(d=>(DECLARED_CAT_ALIASES[cat]||[cat]).includes(d.cat));
 const declaredNames=declaredGroup?declaredGroup.items.map(it=>it.name):[];
 return declaredNames.length
  ?'Projected from your declared '+cat.toLowerCase()+': '+declaredNames.join(', ')+'.'
  :'No '+cat.toLowerCase()+' declared yet — ranked by match to your taste weights.';
}
function directorCorpusScore(name){
 const works=ALL.filter(x=>(x.kind==='movie'||x.kind==='tv')&&x.creator&&x.creator.includes(name));
 if(!works.length)return null;
 const top=works.slice().sort((a,b)=>b.gm-a.gm).slice(0,3);
 return Math.round(top.reduce((s,x)=>s+x.gm,0)/top.length);
}
function crossMediumPairings(it,n){
 n=n||3;
 return ALL.filter(x=>x.kind!==it.kind)
  .map(x=>{
   const shared=(it.genres||[]).filter(g=>(x.genres||[]).indexOf(g)>=0).length;
   const vibeMatch=(it.vibe&&x.vibe===it.vibe)?1:0;
   return {x:x,shared:shared,vibeMatch:vibeMatch,score:shared*10+vibeMatch*8+x.gm*0.15};
  })
  .filter(s=>s.shared>0||s.vibeMatch)
  .sort((a,b)=>b.score-a.score)
  .slice(0,n);
}
function crossMediumPairingsHTML(it){
 const pairs=crossMediumPairings(it,3);
 if(!pairs.length)return '';
 return '<div class="mt-2.5 pt-2.5 border-t border-slate-800/70">'
  +'<span class="lbl">⇄ Cross-Medium Pairings · other kinds that share this vibe/genre</span>'
  +'<div class="flex flex-wrap gap-1.5 mt-1.5">'+pairs.map(p=>{
   const x=p.x,k2=KM[x.kind];
   const why=p.vibeMatch&&p.shared?'same vibe · '+p.shared+' shared genre'+(p.shared>1?'s':''):p.vibeMatch?'same vibe':(p.shared+' shared genre'+(p.shared>1?'s':''));
   return '<button type="button" class="chip pairingChip" data-flip-jump="'+x.id+'" style="color:'+k2.c+';border-color:'+k2.c+'44" title="'+esc(why)+'"><span class="font-semibold">'+k2.label+'</span> '+esc(x.title)+' <span class="text-slate-500">· ★'+x.gm+'</span></button>';
  }).join('')+'</div></div>';
}
function personCorpusScore(works){
 if(!works||!works.length)return null;
 const matched=works.map(t=>ALL.find(x=>x.title.toLowerCase()===String(t).toLowerCase())).filter(Boolean);
 if(!matched.length)return null;
 const top=matched.slice().sort((a,b)=>b.gm-a.gm).slice(0,3);
 return Math.round(top.reduce((s,x)=>s+x.gm,0)/top.length);
}
function tagOverlapScore(tags,vibes){
 const genreBoost=PERSONAL_PROFILE.genreBoost||[];
 const vibeBoost=PERSONAL_PROFILE.vibeBoost||{};
 let base=55;
 (tags||[]).forEach(tag=>{const g=genreBoost.find(gb=>gb[0]===tag);if(g)base+=g[1];});
 (vibes||[]).forEach(v=>{const vb=vibeBoost[v];if(vb)base+=vb*0.6;});
 return Math.max(40,Math.min(99,Math.round(base)));
}
function goatWhy(x){
 if(!x.gmBoosts||!x.gmBoosts.length)return 'Scores well on craft and reception even without a direct match to your declared favorites.';
 const phrase=b=>{
  if(b[0]==='creator')return 'shares creator '+b[1]+' with your declared canon';
  if(b[0]==='author')return 'by '+b[1]+', an author your profile favors';
  if(b[0]==='genre')return 'matches your weighted “'+b[1]+'” genre';
  if(b[0]==='vibe')return 'fits your “'+b[1]+'” vibe';
  if(b[0]==='complexity')return 'has the ontological depth you favor';
  if(b[0]==='craft')return 'stands out on technical craft';
  if(b[0]==='dread')return 'carries the atmospheric dread you favor';
  return b[1];
 };
 const top=x.gmBoosts.slice().sort((a,b)=>b[2]-a[2]).slice(0,2);
 const text=top.map(phrase).join(' and ')+'.';
 return text.charAt(0).toUpperCase()+text.slice(1);
}
function buildGeneratedRec(cat){
 const kind=RECS_KIND_BY_CAT[cat];
 /* Nothing you have already declared is a recommendation. Owned and Gold were excluded from the
    start; Silver and Bronze were not, which is backwards -- tiering a work pulls its gm UP toward
    the rung's floor, so a Silver pick you do not happen to own is *more* likely to be handed back
    to you as a discovery than an untiered work of the same quality. Payton's Silver list is almost
    entirely also-owned so this never showed locally, but the app has to work for someone who tiers
    without owning, which is most people. */
 const items=ALL.filter(x=>x.kind===kind&&!x.owned&&!x.goat&&!x.silver&&!x.bronze)
  .sort((a,b)=>b.gm-a.gm)
  .slice(0,10)
  .map(x=>({n:x.title,s:x.gm,k:x.kind,q:x.title,why:goatWhy(x)}));
 return {cat:cat,basis:computeBasisText(cat),items:items,generated:true};
}
Object.keys(RECS_KIND_BY_CAT).forEach(cat=>{
 const idx=goatProfile.recs.findIndex(c=>c.cat===cat);
 const rec=buildGeneratedRec(cat);
 if(idx>=0)goatProfile.recs[idx]=rec;else goatProfile.recs.push(rec);
});
goatProfile.recs.forEach(c=>{
 if(c.generated)return;
 c.basis=computeBasisText(c.cat);
 if(c.cat==='Directors'){
  c.items=c.items.map(it=>{const hit=directorCorpusScore(it.n);return Object.assign({},it,{s:hit!==null?hit:tagOverlapScore(it.tags)});});
  c.items.sort((a,b)=>b.s-a.s);
  c.generated=true;
 }else{
  c.items=c.items.map(it=>{const hit=personCorpusScore(it.works);return Object.assign({},it,{s:hit!==null?hit:tagOverlapScore(it.tags,it.vibes),linked:hit!==null});});
  c.items.sort((a,b)=>b.s-a.s);
  c.approx=true;
  c.partiallyLinked=c.items.some(it=>it.linked);
 }
});
/* --- Cosmic Horror Index: declared canon locked at 100, eldritch canon hand-scored, remainder algorithmic --- */
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.cosmicHorrorDeclaredIds=['m02','m37','m39','m20','g101'];
const CH_DECLARED=PERSONAL_PROFILE.cosmicHorrorDeclaredIds||[];
if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.cosmicHorrorCanon={m02:100,m37:100,m39:100,m20:100,g101:100,g02:98,m26:96,m40:93,g19:92,g24:92,m30:92,g22:91,m28:90,t02:90,g20:90,g41:90,m95:88,m76:88,t59:88,g12:88,g39:88,g23:88,m90:87,m96:86,t14:86,t65:86,g27:86,g40:86,m34:85,t72:85,m69:84,m19:84,t01:84,t71:84,g13:84,g26:84,m83:82,t51:82,t76:82,g25:82,m24:80,t98:80,m92:78,t87:78,t25:78,g45:78,g28:78,m81:76,t63:76,m72:74,t24:74};
const CH_CANON=PERSONAL_PROFILE.cosmicHorrorCanon||{};
ALL.forEach(x=>{
 const gsx=x.genres.join(' ').toLowerCase();
 let c=0.3*x.dread+0.25*x.myst;
 const horrorish=/horror|supernatural|gothic|giallo|slasher/.test(gsx);
 if(gsx.includes('cosmic'))c+=30;
 if(horrorish)c+=8;
 if(/supernatural|gothic|folk/.test(gsx))c+=6;
 if(x.vibe==='Late-Night Cosmic Dread')c+=22;
 else if(x.vibe==='Midnight Ritual'||x.vibe==='Headphones-Only Descent')c+=8;
 else if(x.vibe==='Single-Sitting Descent')c+=4;
 if(gsx.includes('sci-fi'))c+=4;
 if(!horrorish&&!gsx.includes('cosmic')&&x.vibe!=='Late-Night Cosmic Dread')c*=0.75;
 x.ch=Math.max(5,Math.min(95,Math.round(c)));
 x.chFlag=false;
});
Object.keys(CH_CANON).forEach(id=>{const x=byId.get(id);if(x)x.ch=CH_CANON[id];});
CH_DECLARED.forEach(id=>{const x=byId.get(id);if(x)x.chFlag=true;});

/* ===================== EXPANDED COMPUTED INDICES ===================== */
const SND_BOOST={'m06':6,'m13':6,'m16':6,'m15':5,'m09':5,'m67':6,'m49':5,'m87':4,'m44':3,'m103':5,'m106':6,'m105':3,'g70':6,'g93':8,'g94':4,'g10':4,'g11':4,'g02':4,'t13':4,'t67':5};
ALL.forEach(x=>{
 let snd;
 if(x.kind==='game'){snd=Math.round(0.55*x.tech+0.25*x.crit+0.20*x.aud);}
 else{const a=(x.fid.find(f=>/audio/i.test(f[0]))||[0,x.tech])[1];snd=Math.round(0.7*a+0.2*x.crit+0.1*x.aud);}
 snd+=(SND_BOOST[x.id]||0);x.snd=Math.max(0,Math.min(100,snd));
 if(x.kind==='game'){x.ref=Math.round(0.7*x.tech+0.3*x.crit);}
 else{x.ref=Math.round(0.55*x.fid[0][1]+0.30*x.fid[1][1]+0.15*x.fid[2][1]);}
 x.ref=Math.max(0,Math.min(100,x.ref));
});
const EMO={'m06':95,'m65':86,'m75':92,'m89':96,'m29':94,'m48':90,'m82':95,'m24':88,'m99':70,'m100':74,'m101':96,'m104':95,'m105':90,'m102':82,'m70':84,'m50':82,'m51':80,'m62':92,'m59':82,'m83':86,'m97':76,
 't04':95,'t44':70,'t19':80,'t47':92,'t13':90,'t36':92,'t45':84,'t101':90,'t94':92,'t48':84,'t35':86,'t60':74,'t24':82,'t78':84,'t73':86,'t97':78,
 'g65':95,'g66':94,'g10':88,'g11':86,'g44':86,'g70':90,'g69':92,'g76':94,'g42':88,'g59':86,'g98':90,'g13':92,'g14':88,'g52':84,'g45':82,'g94':80,'g75':84,'g20':82,'g71':86,'m107':95,'m110':94,'m113':88,'m114':70,'m108':78,'m109':74,'m112':72,'m111':70,'m115':72};
ALL.forEach(x=>{
 let e=EMO[x.id];
 if(e==null){const dramatic=/drama|tragedy|war|romance|family/i.test(x.genres.join(' '));e=Math.round(0.45*x.crit+0.25*x.aud+(dramatic?18:0)+(x.dread>85?6:0));e=Math.max(20,Math.min(82,e));}
 x.emo=e;
 const epic=/epic|adventure|space|fantasy|sci-fi|war|mythology|open world/i.test(x.genres.join(' '));
 x.awe=Math.max(0,Math.min(100,Math.round(0.45*x.tech+0.2*x.crit+(epic?16:0)+(['Projector-Worthy Spectacle','Reference Demo Night','Couch Showcase Demo','World-Builder Marathon','Visual Showcase'].includes(x.vibe)?14:0))));
 const cozy=/comedy|adventure|fantasy|romance|kitchen|3d platformer|dramedy/i.test(x.genres.join(' '));
 x.cozy=Math.max(0,Math.min(100,Math.round((100-x.dread)*0.5+x.aud*0.35+(cozy?16:0)-(x.myst>88?8:0))));
});
const GENRE_FAMILIES=[
 ['Sci-Fi',/sci-?fi|cyberpunk|space|dystopia|apocalyp|alt-history|time (loop|travel)|philosophical sci|feminist sf|military sf/i],
 ['Horror',/horror|slasher|giallo|gothic|cosmic|body horror|folk horror|supernatural|vampire|ghost story|possession|haunted/i],
 ['Documentary',/documentary|mockumentary/i],
 ['Drama',/(^|\b)drama|tragedy|family|medical|kitchen|coming.of.age|slice of life|domestic|social commentary/i],
 ['Thriller',/thriller|espionage|spy|conspiracy|techno-|revenge|disaster/i],
 ['Mystery / Detective',/mystery|detective|deduction|noir|procedural|fmv|point-and-click|visual novel/i],
 ['Crime',/crime|heist|institutional|legal/i],
 ['Psychological',/psychological|surreal|metafiction|postmodern|new weird|experimental|arthouse|minimalist|\bmeta\b/i],
 ['Action / Adventure',/action|adventure|shooter|fps|run-and-gun|boss rush|rail|stealth|hack|fighting|beat .em up|soulslike|first-person|top-down|team-based|multiplayer|\bparty\b|collectathon|\bvr\b/i],
 ['Epic / Historical',/epic|historical|period|mythology/i],
 ['Fantasy',/fantasy|dark fantasy|magical realism|magical girl/i],
 ['Western',/western/i],
 ['Comedy / Satire',/comedy|satire|dramedy|black comedy|sitcom|farce/i],
 ['Anime / Animated',/anime|animat|mecha/i],
 ['RPG',/\brpg\b|crpg|jrpg|roguelike rpg|mmorpg/i],
 ['Open World / Survival',/open world|survival|sandbox|exploration|automation|city builder|\bbuilder\b|simulation|\bsim\b|walking sim|farming|life sim|anthology/i],
 ['Puzzle / Systems',/puzzle|logic|deckbuilder|deck-build|tactics|tactical|metroidvania|immersive sim|deduction|synesthesia|roguelike|roguelite/i],
 ['Romance',/romance/i],
 ['Superhero',/superhero/i],
 ['War',/\bwar\b|anti-war|military/i],
 ['Physics & Cosmology',/physics|cosmology|astro/i],
 ['Philosophy & Ideas',/philosophy|philosophical|futurism|stoic|metaphysical|religious|political|revolution/i],
 ['Science & Nature',/\bscience\b|mathematics|engineering|technology|anthropology|psychology|sociology|journalism|biology|economics|nature|linguistics|\bdesign\b|\bart\b|business|travel/i],
 ['Biography & History',/biography|biopic|history|memoir|historical/i],
 ['Literary & Poetry',/literary|poetry|graphic novel|fiction|essay|short stor|verse novel|narrative|\bsilent\b|nostalgia|\bindie\b|\bstrand\b/i],
 ['Platformer',/platformer|3d platformer|2d platformer/i],
 ['Strategy & Tactics',/strategy|4x|rts|turn-based|grand strategy|tactical/i],
 ['Sports & Music',/sport|racing|music|rhythm|\bband\b/i]
];
/* Family membership by lookup, not by running 28 regexes over a joined genre string.
   That string search is the last substring surface in the scoring path, and it is the one that
   filed A Storm of Swords and A Clash of Kings under Biography, because a compound label matched
   a history pattern. Which families a tag belongs to is a curation decision, so data/genre-
   taxonomy.js states it per tag; a tag in two families says so, and no work can be swept into a
   third by an accident of spelling. GENRE_FAMILIES is kept as the ordered family list that drives
   the lens UI. */
ALL.forEach(x=>{
 const fams={};
 (x.genres||[]).forEach(function(tag){
  ((typeof GENRE_FAMILY_OF!=='undefined'&&GENRE_FAMILY_OF[tag])||[]).forEach(function(f){fams[f]=1;});
 });
 x.fam=GENRE_FAMILIES.map(f=>f[0]).filter(f=>fams[f]);
});
const GENRE_COUNTS={};GENRE_FAMILIES.forEach(f=>{GENRE_COUNTS[f[0]]=ALL.filter(x=>x.fam.includes(f[0])).length;});

/* ===================== DEEP INDEX BATTERY ===================== */
/* Hand-tuned overrides (id:score) where the algorithm alone would miss the mark. */
const PERF={'m09':99,'m54':99,'m97':98,'m85':97,'m46':96,'m52':95,'m70':95,'m101':97,'m104':93,'m05':94,'m02':93,'m55':96,'m45':93,'m86':95,'m50':92,'m29':92,'m99':94,'m12':95,'m20':95,'m22':93,'m32':92,
 't19':98,'t17':98,'t18':96,'t44':97,'t21':95,'t03':95,'t10':94,'t45':94,'t96':93,'t52':94,'t88':93,'t57':92,'t58':92,'t101':92,'t13':91,'t46':92,
 'g59':96,'g65':94,'g66':95,'g39':90,'g40':92,'g42':93,'g13':90,'g71':88,'g34':88,'m113':93,'m109':92,'m107':90,'m112':95,'m110':92,'m111':92};
const ICON={'m65':99,'m88':98,'m46':98,'m40':97,'m12':97,'m37':96,'m02':99,'m86':96,'m63':97,'m64':96,'m41':95,'m87':94,'m06':95,'m07':94,'m59':95,'m60':94,'m44':92,'m45':95,'m91':92,'m72':93,'m106':97,'m103':95,'m104':95,'m85':95,'m50':94,
 't41':97,'t19':97,'t17':98,'t01':94,'t30':93,'t20':93,'t29':90,'t28':92,'t47':92,'t101':93,'t27':90,
 'g77':98,'g01':96,'g92':99,'g83':95,'g36':95,'g34':95,'g15':95,'g13':94,'g38':93,'g80':93,'g79':92,'g94':92,'g02':94,'g52':92,'g07':92,'m112':90,'m111':90,'m110':88,'m107':88,'m114':86};
const SCARY={'m24':99,'m37':98,'m20':96,'m72':97,'m02':95,'m38':94,'m90':96,'m28':95,'m25':92,'m96':94,'m73':92,'m74':92,'m71':90,'m91':92,'m39':93,'m69':88,'m95':86,'m94':86,'m21':92,'m23':93,
 't24':93,'t14':95,'t16':92,'t49':90,'t59':92,'t25':90,'t61':90,'t98':90,'t51':90,'t26':86,
 'g02':95,'g12':99,'g13':96,'g14':94,'g17':95,'g19':98,'g21':97,'g16':93,'g18':94,'g101':98,'g23':93,'g20':90,'g41':88,'g22':90,'g96':88};
const REAL={'m09':96,'m29':95,'m48':92,'m66':94,'m36':92,'m13':70,'m99':95,'m89':97,'m86':90,'m47':90,'m17':92,'m97':90,'m85':88,'m54':86,'m103':82,'m106':74,'m102':88,'m105':80,
 't13':98,'t20':96,'t21':92,'t44':92,'t47':95,'t33':92,'t84':92,'t88':88,'t97':90,'t101':88,'t36':80,'t46':86,
 'g64':95,'g33':84,'g96':86,'g37':88,'g19':86,'g28':82,'g09':84};
const REALITY={'m01':99,'m32':99,'m07':97,'m08':97,'m11':96,'m79':98,'m80':96,'m82':95,'m78':95,'m81':95,'m93':94,'m83':96,'m57':96,'m58':95,'m61':94,'m76':95,'m34':94,'m30':95,'m10':94,'m84':94,
 't02':99,'t08':98,'t07':96,'t23':96,'t31':95,'t64':94,'t72':97,'t100':94,'t90':92,'t91':92,'t83':92,'t27':90,
 'g45':98,'g07':98,'g50':96,'g51':95,'g52':94,'g71':96,'g55':95,'g46':92,'g59':94,'g24':92,'g100':70};
const SHOCK={'m24':99,'m52':98,'m46':96,'m56':94,'m35':95,'m62':95,'m89':96,'m90':94,'m32':92,'m70':92,'m96':92,'m50':94,'m84':92,'m83':90,'m29':92,
 't13':94,'t41':92,'t49':92,'t36':92,'t60':90,'t98':88,'t63':92,'t44':88,
 'g66':96,'g74':98,'g34':95,'g13':94,'g52':92,'g71':94,'g35':90,'g12':94,'m112':90,'m111':86};
const SCI={'m06':97,'m14':95,'m09':94,'m26':92,'m27':92,'m48':86,'m49':88,'m105':96,'m88':80,'m61':86,'m13':82,'m79':92,'m80':88,'m31':86,'m30':84,'m81':82,'m78':80,
 't38':90,'t39':92,'t79':95,'t80':86,'t91':88,'t12':90,'t11':82,'t99':92,'t36':78,
 'g45':94,'g90':92,'g91':88,'g89':84,'g57':90,'g46':84,'g31':82,'g85':80,'g28':84,'m108':86,'m114':92,'m113':80};
const FUNNY={'m101':70,'m102':72,'m77':82,'m04':70,
 't57':92,'t58':94,'t45':86,'t101':95,'t93':88,'t44':84,'t88':82,'t22':80,'t18':78,'t95':76,
 'g38':96,'g51':95,'g52':90,'g94':84,'g100':80,'g73':82,'g59':86};
const HIST={'m09':95,'m86':86,'m103':80,'m106':62,'m44':80,'m99':86,'m22':92,'m48':70,'m66':92,
 't13':96,'t47':95,'t21':92,'t33':90,'t88':86,'t84':86,'t46':88,'t101':84,'t94':90,'t97':82,
 'g64':86,'g31':74,'g85':70,'m113':82,'m112':58,'m109':80,'m115':78};
const VIBEIDX={'m13':99,'m41':96,'m32':97,'m68':96,'m69':95,'m91':95,'m05':94,'m20':95,'m60':94,'m61':94,'m88':93,'m99':93,'m33':94,'m44':93,'m100':95,
 't01':96,'t02':97,'t10':94,'t27':92,'t57':94,'t70':95,'t72':94,'t67':95,'t71':93,
 'g02':97,'g10':95,'g40':95,'g22':94,'g73':95,'g71':94,'g94':93,'g93':95,'g75':94,'g03':92};
function lerpScore(x,o,baseFn,lo,hi){let v=o[x.id];if(v==null){v=baseFn(x);v=Math.max(lo,Math.min(hi,v));}return v;}
ALL.forEach(x=>{
 const g=x.genres.join(' ').toLowerCase();
 x.perf=lerpScore(x,PERF,it=>Math.round(0.62*it.crit+0.18*it.aud+(/(drama|psychological|biopic|tragedy)/.test(g)?10:0)+(it.kind==='movie'?4:it.kind==='tv'?3:-6)),35,90);
 x.icon=lerpScore(x,ICON,it=>Math.round(0.4*it.crit+0.3*it.aud+(2025-it.year>20?10:0)+(it.crit>=90?6:0)),30,88);
 x.scary=lerpScore(x,SCARY,it=>{const h=/horror|slasher|gothic|cosmic|giallo|body horror|supernatural/.test(g);return Math.round((h?0.55:0.2)*it.dread+(h?20:0)+(it.vibe==='Late-Night Cosmic Dread'?12:0)+(it.vibe==='Midnight Ritual'?8:0));},5,90);
 x.real=lerpScore(x,REAL,it=>{const r=/(historical|biopic|war|crime drama|procedural|disaster|institutional)/.test(g);const f=/(fantasy|sci-fi|superhero|anime|mythology|cyberpunk|space)/.test(g);return Math.round(55+(r?22:0)-(f?28:0)+(it.crit-80)*0.4);},10,90);
 x.reality=lerpScore(x,REALITY,it=>Math.round(0.6*it.myst+(/(surreal|metafiction|time|psychological|cosmic)/.test(g)?14:0)+(it.vibe==='Puzzle-Box Replay'?10:0)),10,90);
 x.shock=lerpScore(x,SHOCK,it=>Math.round(0.4*it.dread+0.25*it.myst+(/(thriller|horror|crime|revenge)/.test(g)?10:0)),10,86);
 x.sci=lerpScore(x,SCI,it=>{const sf=/sci-fi|space|cyberpunk|philosophical/.test(g);return Math.round((sf?0.5:0.15)*it.myst+(sf?28:0)+(it.crit-80)*0.2);},5,86);
 x.funny=lerpScore(x,FUNNY,it=>{const c=/comedy|satire|dramedy|black comedy/.test(g);return Math.round((c?42:8)+(c?it.aud*0.4:it.aud*0.1));},5,82);
 x.hist=lerpScore(x,HIST,it=>{const h=/historical|biopic|war|period/.test(g);return h?Math.round(60+(it.crit-80)*0.4):Math.max(5,Math.round(it.myst*0.15));},5,80);
 x.vibe2=lerpScore(x,VIBEIDX,it=>Math.round(0.4*it.tech+0.3*it.aud+(it.vibe&&/cosmic|midnight|ritual|neon|noir/i.test(it.vibe)?10:0)),30,90);
});
/* ---- Content ratings (algorithmic certification) ---- */
function certify(x){const g=x.genres.join(' ').toLowerCase();
 if(x.kind==='book'){
  if(/cosmic horror|weird fiction|gothic/.test(g)||x.dread>=80)return 'Mature Readers';
  // Verse is decided by the book's FORM (contextTags.formatType, surfaced as x.format), not by
  // searching its genre strings for "poetry". 200 prose novels -- The Great Gatsby, Anna Karenina,
  // Middlemarch, Madame Bovary -- used to certify as Verse purely because they carry the compound
  // family label "Literary & Poetry" among their genres, and a substring match cannot tell that
  // apart from a genuine Poetry tag. Matching the form field exactly can.
  if(x.format==='Poetry')return 'Verse';
  if(/physics|cosmology|mathematics|philosophy|engineering/.test(g))return 'Technical';
  if(/biography|history|memoir|anthropology|science|technology|futurism|design|art/.test(g))return 'Nonfiction';
  return 'General';
 }
 if(x.kind==='game'){
  /* Rated from GENRE alone, never from x.dread. For a game, x.dread carries
     immersionTensionIndex, and RUBRIC.md construct 2 defines that as absorption -- how
     completely the game takes you in -- explicitly NOT menace. Rating content maturity from
     how gripping something is says that anything hard to put down must be for adults, and
     that is exactly what it did: 71 of 258 games certified M with no violent or horror genre
     anywhere, among them Outer Wilds, Return of the Obra Dinn, Subnautica and Inside. Outer
     Wilds is rated E10+ in reality.
     A game's real age rating is a FACT (ESRB/PEGI, and IGDB carries it), not something to
     infer from a taste index. Phase 5 fetches it. Until then genre is the honest signal:
     narrower coverage, but it stops asserting something false about a third of the library. */
  if(/horror|cosmic|gothic|body|vampire/.test(g))return 'M';
  if(/shooter|\bfps\b|action rpg|soulslike|dark fantasy|stealth action|crime|revenge|cyberpunk|\bwar\b|fighting|beat .em up|run-and-gun|boss rush|dystopian/.test(g))return 'M';
  if(/party|sports|rhythm|racing|collectathon|social sim/.test(g))return 'E';
  if(/puzzle|platformer|metroidvania|simulation|\bsim\b|exploration|sandbox|builder|automation|synesthesia|walking sim|point-and-click|visual novel|deduction/.test(g))return 'E10+';
  return 'T';
 }
 // film/tv
 const mature=/horror|slasher|giallo|crime|revenge|war|neo-noir|body horror|cosmic|gangster|thriller/.test(g);
 /* Certification reads a work's fields, never its name. This used to carry `|| /^(the thing|
    hereditary|come and see|possession|oldboy|se7en)/` against the lowercased title, and every one
    of those six already cleared dread>=86 on its own -- so the clause decided nothing and was pure
    latent risk: it is a PREFIX match, so any future "Possession of Hannah Grace" or "The Thing
    About Pam" would silently certify as heavy on the strength of its first two words. A title is
    not a property of a work's content, and a rule keyed to one cannot generalise to the next
    thousand records. */
 const heavy=x.dread>=86;
 if(x.kind==='tv'){
  if(mature||x.dread>=78)return 'TV-MA';
  if(/drama|mystery|sci-fi|fantasy|period/.test(g))return 'TV-14';
  return 'TV-PG';
 }
 if(heavy||(mature&&x.dread>=72))return x.dread>=92?'NC-17 / Unrated':'R';
 if(mature||x.dread>=66||/psychological|dystopian/.test(g))return 'R';
 if(/sci-fi|action|epic|adventure|superhero|fantasy|western|thriller/.test(g))return 'PG-13';
 if(/animated|family|comedy/.test(g))return 'PG';
 return 'PG-13';
}
ALL.forEach(x=>{x.rating=certify(x);});
const RATING_ORDER=['G','PG','PG-13','R','NC-17 / Unrated','TV-PG','TV-14','TV-MA','E','E10+','T','M','Nonfiction','Technical','General','Mature Readers','Verse'];
const RATING_COUNTS={};ALL.forEach(x=>{RATING_COUNTS[x.rating]=(RATING_COUNTS[x.rating]||0)+1;});
function renderTasteDNA(){
 const canon=ALL.filter(x=>x.goat||x.silver||x.owned);
 if(!canon.length){return;}
 const dims=[['Performances','perf','#fda4af'],['Emotional','emo','#f0abfc'],['Reality-Altering','reality','#c4b5fd'],['Vibe / Atmosphere','vibe2','#e879f9'],['Scientific','sci','#67e8f9'],['Iconicness','icon','#fcd34d'],['Soundtrack','snd','#7dd3fc'],['Awe / Spectacle','awe','#fbbf24'],['Complexity','myst','#34d399'],['Realism','real','#86efac']];
 const avg=(arr,k)=>Math.round(arr.reduce((s,x)=>s+x[k],0)/arr.length);
 $('#tasteDNA').innerHTML=dims.map(d=>{const you=avg(canon,d[1]),all=avg(ALL,d[1]),diff=you-all;
  return '<div class="flex items-center gap-3"><span class="text-[11px] text-slate-300 w-32 shrink-0">'+d[0]+'</span>'
   +'<div class="flex-1 bar" style="height:7px"><i style="width:'+you+'%;background:'+d[2]+'"></i></div>'
   +'<span class="text-[11px] tabular-nums w-8 text-right" style="color:'+d[2]+'">'+you+'</span>'
   +'<span class="text-[10px] tabular-nums w-16 text-right '+(diff>=0?'text-emerald-400':'text-slate-500')+'">'+(diff>=0?'+':'')+diff+' vs avg</span></div>';}).join('');
}
// The 4 corpus-backed declared categories are rendered live from the actual Gold/Silver/Bronze
// tier data (GOAT_DECLARED/GOAT_SILVER/GOAT_BRONZE), not from the static declaredCanon list --
// declaredCanon only ever tracked Gold (built by the GOAT Picker's finalize step), so anything
// tiered Silver or Bronze from a card's compact row or the GOAT Profile search was previously
// invisible on this page entirely. Non-corpus hand-curated categories (Director, Actors, etc.)
// have no tier concept, so they keep the original flat "declared" rendering.
var CORPUS_CANON_KIND={Movies:'movie',Books:'book','TV Shows':'tv','Video Game':'game'};
var TIER_STYLE={gold:['\u{1F947}','Gold','#fbbf24'],silver:['\u{1F948}','Silver','#cbd5e1'],bronze:['\u{1F949}','Bronze','#cd7f32']};
// Each tier group is ALSO a drop zone (data-tier/data-kind), and always renders -- even with zero
// items -- so an empty tier still has somewhere to drag a chip into. Dragging a chip from one
// zone to another within the same medium re-tiers it via moveToTier(), below, which goes through
// the exact same mutateProfileAndReload path a click on the tier row does -- so a drag-based move
// recomputes the GOAT match weight exactly as if you'd clicked the old tier off and the new one on.
function tierChipGroupHTML(kind,items,tierKey,filterQ){
 var s=TIER_STYLE[tierKey];
 var shown=filterQ?items.filter(function(x){return x.title.toLowerCase().indexOf(filterQ)>=0;}):items;
 var body;
 if(shown.length)body=shown.map(function(x){return '<span class="chip goatJump tierDragChip" draggable="true" data-q="'+esc(x.title)+'" data-drag-id="'+x.id+'" data-drag-kind="'+kind+'" title="Click to open in Global Controller, or drag to Gold/Silver/Bronze below to re-tier" style="color:'+s[2]+';border-color:'+s[2]+'55;cursor:grab">'+esc(x.title)+'</span>';}).join('');
 else if(filterQ&&items.length)body='<span class="text-[10.5px] text-slate-600 italic">no matches for \u201c'+esc(filterQ)+'\u201d</span>';
 else body='<span class="text-[10.5px] text-slate-600 italic">drag a title here to make it '+s[1]+'</span>';
 return '<div class="mt-2 first:mt-0 tierDropZone rounded-lg -m-1 p-1" data-tier="'+tierKey+'" data-kind="'+kind+'"><div class="text-[9.5px] tracking-[.16em] uppercase mb-1 font-bold" style="color:'+s[2]+'">'+s[0]+' '+s[1]+' <span class="text-slate-600 font-normal">('+(filterQ?shown.length+'/'+items.length:items.length)+')</span></div>'
  +'<div class="flex flex-wrap gap-1.5 min-h-[24px]">'+body+'</div></div>';
}
function declaredCategoryHTML(d){
 var kind=CORPUS_CANON_KIND[d.cat];
 var filterQ=(state.goatDeclaredQ||'').trim().toLowerCase();
 if(!kind){
  var items=filterQ?d.items.filter(function(it){return it.name.toLowerCase().indexOf(filterQ)>=0;}):d.items;
  if(filterQ&&!items.length)return '';
  return '<div class="panel p-3.5" style="border-color:#fbbf2433">'
   +'<div class="lbl" style="color:#fbbf24">\u2605 '+esc(d.cat)+'</div>'
   +'<div class="flex flex-wrap gap-1.5 mt-2">'+items.map(it=>'<span class="chip'+(it.q?' goatJump':'')+'"'+(it.q?' data-q="'+esc(it.q)+'" title="Open in Global Controller" style="color:#fde68a;border-color:#fbbf2455;cursor:pointer"':' style="color:#fde68a;border-color:#fbbf2455"')+'>'+esc(it.name)+(it.note?' <span class="text-slate-500">\u00b7 '+esc(it.note)+'</span>':'')+'</span>').join('')+'</div></div>';
 }
 var pool=ALL.filter(function(x){return x.kind===kind;});
 var anyTiered=pool.some(function(x){return x.goat||x.silver||x.bronze;});
 // With a filter typed and this whole category having nothing matching it, drop the category
 // entirely rather than show three empty "no matches" drop zones in a row.
 if(filterQ&&anyTiered&&!pool.some(function(x){return (x.goat||x.silver||x.bronze)&&x.title.toLowerCase().indexOf(filterQ)>=0;}))return '';
 var body=tierChipGroupHTML(kind,pool.filter(function(x){return x.goat;}),'gold',filterQ)
  +tierChipGroupHTML(kind,pool.filter(function(x){return x.silver;}),'silver',filterQ)
  +tierChipGroupHTML(kind,pool.filter(function(x){return x.bronze;}),'bronze',filterQ);
 return '<div class="panel p-3.5" style="border-color:#47556933"><div class="lbl" style="color:#e2e8f0">'+esc(d.cat)+'</div>'
  +(anyTiered?'':'<div class="text-[11px] text-slate-500 mt-1">None declared yet \u2014 search above to tier some.</div>')
  +body+'</div>';
}
// The four corpus categories are shown whenever the profile has ANY tiered work in them, even if
// declaredCanon never mentions that category. Previously this list came only from declaredCanon,
// which is populated by the sample profile and the GOAT Picker's finalize step -- so on an account
// started from scratch it was empty, and tiering something Gold/Silver/Bronze from a card had
// nowhere to appear at all. That looked exactly like "my picks aren't saving" even when they were.
function declaredCategoriesToRender(){
 var cats=(goatProfile.declared||[]).slice();
 var named={};cats.forEach(function(d){named[d.cat]=true;});
 Object.keys(CORPUS_CANON_KIND).forEach(function(cat){
  if(named[cat])return;
  var kind=CORPUS_CANON_KIND[cat];
  var hasTiered=ALL.some(function(x){return x.kind===kind&&(x.goat||x.silver||x.bronze);});
  if(hasTiered)cats.push({cat:cat,items:[]});
 });
 return cats;
}
function renderGoat(){renderTasteDNA();
 var declaredHTML=declaredCategoriesToRender().map(declaredCategoryHTML).join('');
 $('#goatDeclared').innerHTML=declaredHTML||((state.goatDeclaredQ||'').trim()?'<div class="col-span-full text-center text-slate-500 text-sm py-6">Nothing in your declared canon matches “'+esc(state.goatDeclaredQ.trim())+'”.</div>':'');
 $('#goatRecs').innerHTML=goatProfile.recs.map(cat=>{
  var hidden=PERSONAL_PROFILE.hiddenRecs||[];
  var visible=cat.items.filter(function(it){return hidden.indexOf(recKey(cat.cat,it))<0;});
  var hiddenN=cat.items.length-visible.length;
  return '<div class="panel overflow-hidden fade-in">'
  +'<div class="px-4 pt-4 pb-3 border-b border-slate-800/70"><div class="flex items-baseline justify-between gap-2"><h3 class="text-[12px] font-bold tracking-[.14em] uppercase text-slate-100">'+esc(cat.cat)+(cat.approx?(cat.partiallyLinked?' <span class="text-[8.5px] font-normal normal-case tracking-normal text-emerald-400/80" title="Where a pick has a known, ledger-linked work (marked ◆ below), the score is a real average of that work'+"'"+'s GOAT match, not a guess. Unlinked picks fall back to genre overlap.">◆ partly ledger-linked</span>':' <span class="text-[8.5px] font-normal normal-case tracking-normal text-amber-400/70" title="No corpus of music/video-essay works exists to link these picks to (the ledger only tracks movies, TV, games and books), so these stay hand-curated -- but the score and order do respond to both your genre AND vibe weights.">◈ approximate — by genre + vibe overlap</span>'):'')+'</h3><span class="lbl">match /100</span></div>'
  +'<p class="text-[10.5px] text-slate-500 mt-1 leading-relaxed">'+esc(cat.basis)+'</p>'
  +(hiddenN?'<button type="button" class="recUnhideAll text-[10px] text-sky-400/80 hover:text-sky-300 mt-1.5" data-cat="'+esc(cat.cat)+'">'+hiddenN+' hidden here — show again</button>':'')
  +'</div>'
  +(visible.length?visible.map((it,i)=>'<div class="flex items-center gap-2.5 px-3.5 py-2 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 group'+(it.q?' goatJump cursor-pointer':'')+'"'+(it.q?' data-q="'+esc(it.q)+'" title="Open in Global Controller"':'')+'>'
   +'<span class="text-[10px] text-slate-500 w-5 tabular-nums">'+String(i+1).padStart(2,'0')+'</span>'
   +'<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+(it.k?KM[it.k].c:'#475569')+'"></span>'
   +'<div class="flex-1 min-w-0"><div class="text-[12px] text-slate-200 truncate">'+esc(it.n)+(it.linked?' <span class="text-[8.5px] text-emerald-400/80 uppercase tracking-[.12em]" title="Score is a real average of this person’s linked ledger work(s)">◆ linked</span>':'')+(it.q?' <span class="text-[8.5px] text-amber-300/70 uppercase tracking-[.12em]">on ledger</span>':'')+'</div>'
   +'<div class="text-[10px] text-slate-500 truncate" title="'+esc(it.why)+'">'+esc(it.why)+'</div></div>'
   +'<span class="hidden sm:flex w-24 shrink-0"><span class="bar flex-1"><i style="width:'+it.s+'%;background:linear-gradient(90deg,#b45309,#fbbf24)"></i></span></span>'
   +'<span class="text-[11px] font-bold tabular-nums w-7 text-right" style="color:#fbbf24">'+it.s+'</span>'
   +'<button type="button" class="recHideBtn shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-rose-300 text-[13px] leading-none px-1" data-cat="'+esc(cat.cat)+'" data-key="'+esc(recKey(cat.cat,it))+'" title="Hide this from recommendations">✕</button>'
   +'</div>').join(''):'<div class="px-3.5 py-3 text-[11px] text-slate-500">Everything here is hidden.</div>')
  +'</div>';
 }).join('');
}
// Search & Build Your Favorites: the GOAT Profile tab's embedded replacement for the old separate
// "Pick Your GOATs" header button/modal. Reuses tierRowHTML() -- the exact same compact Gold/
// Silver/Bronze/Owned row every card already has -- so there's one tiering UI in the whole app to
// learn, not two. Delegated via #goatSearchResults rather than #grid, since this list isn't part
// of the results grid.
// Type/tier filters + sort turn this from "type a title, hope it's near the top" into something
// you can actually browse -- e.g. Books + Untiered to work through your whole to-be-tiered backlog
// by medium, or My Tiers first to review/audit what's already declared instead of only discovering
// new things.
function goatSearchPool(q){
 var pool=ALL;
 if(state.goatType!=='all')pool=pool.filter(function(x){return x.kind===state.goatType;});
 if(state.goatTierFilter==='untiered')pool=pool.filter(function(x){return !(x.goat||x.silver||x.bronze||x.owned);});
 else if(state.goatTierFilter==='gold')pool=pool.filter(function(x){return x.goat;});
 else if(state.goatTierFilter==='silver')pool=pool.filter(function(x){return x.silver;});
 else if(state.goatTierFilter==='bronze')pool=pool.filter(function(x){return x.bronze;});
 else if(state.goatTierFilter==='owned')pool=pool.filter(function(x){return x.owned;});
 if(q)pool=pool.filter(function(x){return (x.title+' '+x.creator+' '+(x.genres||[]).join(' ')).toLowerCase().indexOf(q)>=0;});
 return pool;
}
function goatSearchSort(pool,q){
 if(state.goatSort==='title')return pool.slice().sort(function(a,b){return a.title.localeCompare(b.title);});
 if(state.goatSort==='yearNew')return pool.slice().sort(function(a,b){return b.year-a.year;});
 if(state.goatSort==='tier')return pool.slice().sort(function(a,b){return (tierRank(b)-tierRank(a))||(b.gm-a.gm);});
 // 'match' (default): with no search typed, lead with fresh suggestions rather than a list topped
 // by whatever's already Gold/Silver/Bronze/Owned (those pin gm to 100/~88/~80, so a plain gm sort
 // just showed your own past picks back at you first). A search or any explicit filter is already
 // a deliberate narrowing, so it sorts by raw match instead of hiding tiered picks at the bottom.
 if(!q&&state.goatTierFilter==='all')return pool.slice().sort(function(a,b){
   var au=!(a.goat||a.silver||a.bronze||a.owned),bu=!(b.goat||b.silver||b.bronze||b.owned);
   if(au!==bu)return au?-1:1;
   return b.gm-a.gm;
  });
 return pool.slice().sort(function(a,b){return b.gm-a.gm;});
}
function renderGoatSearchResults(q){
 if(q==null){var qi=$('#goatSearchInput');q=qi?qi.value:'';}
 q=(q||'').trim().toLowerCase();
 var el=$('#goatSearchResults');if(!el)return;
 var pool=goatSearchSort(goatSearchPool(q),q);
 var cc=$('#goatSearchCount');if(cc)cc.textContent=pool.length+(pool.length===1?' match':' matches')+(pool.length>25?' · showing top 25':'');
 var shown=pool.slice(0,25);
 // Status is communicated by tierRowHTML alone (its active segments already highlight in color
 // and, for Gold/Silver/Bronze/Owned, are self-explanatory) -- this used to ALSO render a separate
 // row of GOLD/SILVER/BRONZE/OWNED chips duplicating exactly the same information right above it,
 // which is what made this list look cramped and "overlapping" on a narrow screen: two rows saying
 // the same thing, wrapping unpredictably in a compact result card. One row now, not two.
 el.innerHTML=shown.map(function(x){
  return '<div class="panel p-2.5 pb-1">'
   +'<div class="flex items-center gap-2 flex-wrap"><span class="chip" style="color:'+KM[x.kind].c+';border-color:'+KM[x.kind].c+'44">'+KM[x.kind].label+'</span>'
   +'<span class="text-[12.5px] font-semibold text-slate-100">'+esc(x.title)+'</span>'
   +'<span class="text-[10.5px] text-slate-500">· '+x.year+' · '+esc(x.creator)+'</span></div>'
   +tierRowHTML(x,true)
   +'</div>';
 }).join('')||'<div class="rcEmpty">No matches</div>';
}
on('#goatSearchInput','input',e=>{renderGoatSearchResults(e.target.value);});
on('#goatSearchResults','click',e=>{const pe=e.target.closest('.profEditBtn');if(pe)handleProfileEditClick(pe);});
on('#goatTypeSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.goatType=b.dataset.t;$$('#goatTypeSeg button').forEach(x=>x.classList.toggle('on',x===b));renderGoatSearchResults();scheduleURLSync();});
on('#goatTierSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.goatTierFilter=b.dataset.tf;$$('#goatTierSeg button').forEach(x=>x.classList.toggle('on',x===b));renderGoatSearchResults();scheduleURLSync();});
on('#goatSortSel','change',e=>{state.goatSort=e.target.value;renderGoatSearchResults();scheduleURLSync();});
let goatDeclaredSearchT=null;
on('#goatDeclaredSearch','input',e=>{clearTimeout(goatDeclaredSearchT);const v=e.target.value;goatDeclaredSearchT=setTimeout(()=>{state.goatDeclaredQ=v;scheduleURLSync();$('#goatDeclared').innerHTML=(declaredCategoriesToRender().map(declaredCategoryHTML).join(''))||((state.goatDeclaredQ||'').trim()?'<div class="col-span-full text-center text-slate-500 text-sm py-6">Nothing in your declared canon matches “'+esc(state.goatDeclaredQ.trim())+'”.</div>':'');},120);});
on('#goatRecs','click',e=>{
 const hb=e.target.closest('.recHideBtn');
 if(hb){e.stopPropagation();hideRec(hb.dataset.cat,hb.dataset.key);return;}
 const ub=e.target.closest('.recUnhideAll');
 if(ub){e.stopPropagation();unhideAllRecsInCat(ub.dataset.cat);return;}
});
// Drag-and-drop between a medium's own Gold/Silver/Bronze columns (see tierChipGroupHTML/
// moveToTier above). Scoped to #goatDeclared and, within it, to drop zones sharing the dragged
// chip's own data-drag-kind -- a chip can only ever land in a same-medium zone since each
// category panel only contains its own kind's zones, but the explicit kind check also makes a
// same-panel-only drag obvious from the code, not just true by construction.
on('#goatDeclared','dragstart',e=>{const chip=e.target.closest('.tierDragChip');if(!chip)return;e.dataTransfer.setData('text/plain',chip.dataset.dragId);e.dataTransfer.effectAllowed='move';});
on('#goatDeclared','dragover',e=>{const zone=e.target.closest('.tierDropZone');if(!zone)return;e.preventDefault();e.dataTransfer.dropEffect='move';});
on('#goatDeclared','drop',e=>{const zone=e.target.closest('.tierDropZone');if(!zone)return;e.preventDefault();
 const id=e.dataTransfer.getData('text/plain');if(!id)return;
 const x=byId.get(id);if(!x||x.kind!==zone.dataset.kind)return;
 moveToTier(id,zone.dataset.tier);
});
function goatJumpTo(q){
 state.q=q;$('#q').value=q;
 state.type='all';$$('#typeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.type==='all'));
 switchView('controller');
 window.scrollTo({top:0,behavior:'smooth'});
}
document.addEventListener('click',e=>{const j=e.target.closest('.goatJump');if(j&&j.dataset.q)goatJumpTo(j.dataset.q);});
document.addEventListener('click',e=>{const pe=e.target.closest('.profEditBtn');if(pe&&pe.dataset.act==='setformat'){e.stopPropagation();handleProfileEditClick(pe);}});

/* ===================== ROUTING & BINDINGS ===================== */
function updateWlNav(){const c=wlCount();const el=$('#wlNavCount');if(el)el.textContent=c?('('+c+')'):'';}
function wlItems(){return Object.keys(WL).map(id=>byId.get(id)).filter(Boolean);}
// Per-kind time-to-finish estimate. Movies use the real runtime field; TV assumes ~8hrs/season
// (a reasonable prestige-TV average); games strip the "~" the corpus already prefixes hour
// estimates with; books estimate from page count at a typical ~50 pages/hour reading pace.
// Previously this shared one formula across TV *and* books (season-count logic applied to a book's
// raw page count), which for a 400+ page novel multiplied by 8 into a wildly wrong four-digit
// "hours" figure -- and the result was never even displayed anywhere, so the bug was invisible.
function estimateHours(x){
 if(x.kind==='movie')return (x.mins||parseInt(x.span)||120)/60;
 if(x.kind==='tv')return (parseInt(x.span)||1)*8;
 if(x.kind==='game')return parseInt(String(x.span).replace('~',''))||20;
 if(x.kind==='book')return (parseInt(x.span)||300)/50;
 return 0;
}
function formatHours(h){return h>=48?Math.round(h/24)+' days':Math.round(h)+' hrs';}
function renderWatchlist(){
 const items=wlItems();
 const watched=items.filter(x=>WL[x.id].watched),todo=items.filter(x=>!WL[x.id].watched);
 const backlogHrs=todo.reduce((s,x)=>s+estimateHours(x),0);
 const avg=items.length?Math.round(items.reduce((s,x)=>s+x.ovr,0)/items.length):0;
 var BACKLOG_TITLE='Estimated, not measured: movies use their actual runtime, TV uses ~8hrs/season, games use their listed playtime (or 20hrs if unlisted), books use pages\u00f750wpm. Treat this as a rough sense of scale, not a real countdown.';
 $('#wlStats').innerHTML=[['Saved',items.length,null],['Up Next',todo.length,null],['Complete',watched.length,null],['Est. Backlog',todo.length?formatHours(backlogHrs):'\u2014',BACKLOG_TITLE],['Avg Quality',avg||'\u2014',null]]
  .map(s=>'<div class="panel p-3 text-center"'+(s[2]?' title="'+esc(s[2])+'"':'')+'><div class="text-xl font-extrabold text-slate-50 tabular-nums">'+s[1]+(s[2]?' <span style="font-size:9px;color:#64748b" title="'+esc(s[2])+'">(est.)</span>':'')+'</div><div class="lbl mt-1">'+s[0]+'</div></div>').join('');
 const wf=state.wlFilter||'all',wt=state.wlType||'all',wq=(state.wlSearchQ||'').trim().toLowerCase(),ws=state.wlSort||'added';
 let list=wf==='todo'?todo:wf==='done'?watched:items;
 if(wt!=='all')list=list.filter(x=>x.kind===wt);
 if(wq)list=list.filter(x=>(x.title+' '+x.creator).toLowerCase().indexOf(wq)>=0);
 list=list.slice().sort(ws==='title'?(a,b)=>a.title.localeCompare(b.title):ws==='match'?(a,b)=>b.gm-a.gm:(a,b)=>(WL[b.id].added||0)-(WL[a.id].added||0));
 const DONE_VERB={movie:'Watched',tv:'Watched',game:'Played',book:'Read'};
 $('#wlGrid').innerHTML=list.length?list.map(x=>{const k=KM[x.kind];const done=WL[x.id].watched;const verb=DONE_VERB[x.kind]||'Done';
  return '<div class="panel p-3 flex gap-3 items-start'+(done?' opacity-60':'')+'">'
   +ring(x.crit,k.c,38)
   +'<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 flex-wrap"><span class="text-[13px] font-semibold text-slate-100">'+esc(x.title)+'</span><span class="chip" style="color:'+k.c+';border-color:'+k.c+'44">'+k.label+'</span><span class="chip" style="color:#5eead4;border-color:#5eead455">'+esc(x.rating)+'</span></div>'
   +'<div class="text-[11px] text-slate-400 mt-0.5 truncate">'+x.year+' \u00b7 '+esc(x.creator)+' \u00b7 <span title="Estimated from runtime/season count/playtime/page count \u2014 not a guarantee">~'+formatHours(estimateHours(x))+'</span></div>'
   +'<div class="flex gap-1.5 mt-2"><button type="button" class="wlDone presetBtn" data-id="'+x.id+'" title="'+(done?'Click to mark as not yet '+verb.toLowerCase():'Mark this '+verb.toLowerCase())+'" style="'+(done?'color:#34d399;border-color:#34d39955':'')+'">'+(done?'\u2713 '+verb+' \u00b7 click to undo':'Mark '+verb.toLowerCase())+'</button><button type="button" class="wlRemove presetBtn" data-id="'+x.id+'" title="Remove from your watchlist entirely" style="color:#fca5a5;border-color:#fca5a544">Remove</button></div>'
   +'</div></div>';}).join(''):'<div class="col-span-full text-center text-slate-500 text-sm py-12">'+(items.length?'Nothing matches this filter.':'Nothing saved yet \u2014 tap the \u2661 on any card to build your backlog.')+'</div>';
 const saved=new Set(Object.keys(WL));
 const recs=ALL.filter(x=>!saved.has(x.id)).sort((a,b)=>(b.gm-a.gm)||(b.ovr-a.ovr)).slice(0,12);
 $('#wlRecs').innerHTML=recs.map(x=>{const k=KM[x.kind];
  return '<button type="button" class="wlAdd panel p-2.5 w-full text-left flex items-center gap-2 hover:border-slate-600" data-id="'+x.id+'">'
   +'<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
   +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200">'+esc(x.title)+' <span class="text-slate-500 text-[10px]">'+x.year+'</span></span>'
   +'<span class="text-[11px] font-bold tabular-nums" style="color:#fbbf24">\u2605'+x.gm+'</span><span class="text-rose-400 text-sm">\u2661</span></button>';}).join('');
 updateWlNav();
}
/* ===== Collection Timeline ===== */
var tlScope='owned';
var tlMedium='all';
var tlZoomDecade=null;
function renderTimeline(){
 var items=(tlScope==='owned'?ALL.filter(x=>x.owned):ALL).filter(x=>typeof x.year==='number'&&x.year!==0);
 if(tlMedium!=='all')items=items.filter(x=>x.kind===tlMedium);
 if(!items.length){
  $('#tlStats').innerHTML=[['Works on timeline',0,'#f0abfc'],['Spans','—','#22d3ee'],['Busiest decade','—','#fbbf24'],['Peak count',0,'#4ade80']]
   .map(x=>'<div class="panel p-3 text-center"><div class="text-lg font-extrabold text-slate-50 tabular-nums leading-tight">'+x[1]+'</div><div class="lbl mt-1" style="color:'+x[2]+'">'+x[0]+'</div></div>').join('');
  $('#tlChart').innerHTML='<div class="text-center text-slate-500 text-sm py-10">Nothing to show for this filter.</div>';
  $('#tlEras').innerHTML='';
  return;
 }
 // --- stats ---
 var years=items.map(x=>x.year);
 var earliest=Math.min.apply(null,years),latest=Math.max.apply(null,years);
 var modern=years.filter(y=>y>=1900);
 var span=(latest-(modern.length?Math.min.apply(null,modern):earliest));
 // busiest decade
 var dd={};items.forEach(x=>{var d=Math.floor(x.year/10)*10;dd[d]=(dd[d]||0)+1;});
 var peak=Object.entries(dd).sort((a,b)=>b[1]-a[1])[0];
 $('#tlStats').innerHTML=[
  ['Works on timeline',items.length,'#f0abfc'],
  ['Spans',(earliest<0?Math.abs(earliest)+' BC':earliest)+' \u2013 '+latest,'#22d3ee'],
  ['Busiest decade',(peak?peak[0]+'s':'\u2014'),'#fbbf24'],
  ['Peak count',(peak?peak[1]:0),'#4ade80']
 ].map(x=>'<div class="panel p-3 text-center"><div class="text-lg font-extrabold text-slate-50 tabular-nums leading-tight">'+x[1]+'</div><div class="lbl mt-1" style="color:'+x[2]+'">'+x[0]+'</div></div>').join('');
 // --- SVG histogram by decade (pre-1900 bucketed) ---
 var buckets={};var preCount=0,preItems=[];
 items.forEach(x=>{if(x.year<1900){preCount++;preItems.push(x);}else{var d=Math.floor(x.year/10)*10;(buckets[d]=buckets[d]||[]).push(x);}});
 var decades=Object.keys(buckets).map(Number).sort((a,b)=>a-b);
 var maxCount=Math.max(preCount,Math.max.apply(null,decades.map(d=>buckets[d].length)));
 var colOf=x=>KM[x.kind].c;
 var W=Math.max(700,(decades.length+(preCount?1:0))*64),H=240,pad=30,bw=48,gap=16;
 var cols=[];if(preCount)cols.push(['Pre-1900',preItems,-9999,1900]);decades.forEach(d=>cols.push([d+'s',buckets[d],d,d+10]));
 var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">';
 cols.forEach(function(c,i){
  var x=pad+i*(bw+gap);
  var items2=c[1];var h=(items2.length/maxCount)*(H-70);
  svg+='<g class="tlBar" style="cursor:pointer" data-ymin="'+c[2]+'" data-ymax="'+c[3]+'" data-kind="'+(tlMedium!=='all'?tlMedium:'')+'" data-label="'+esc(c[0])+'"><title>'+c[0]+' — '+items2.length+' works · click to open in the Global Controller, or use the 🔍 to preview here</title><rect x="'+x+'" y="'+(H-30-h-4)+'" width="'+bw+'" height="'+(h+4)+'" fill="transparent"/>';
  // stacked by medium
  var order=['book','movie','tv','game'];
  var y=H-30;
  order.forEach(function(kind){
   var cnt=items2.filter(it=>it.kind===kind).length;if(!cnt)return;
   var seg=(cnt/items2.length)*h;
   svg+='<rect x="'+x+'" y="'+(y-seg)+'" width="'+bw+'" height="'+seg+'" fill="'+KM[kind].c+'" opacity="0.85" rx="2"/>';
   y-=seg;
  });
  svg+='<text x="'+(x+bw/2)+'" y="'+(H-14)+'" fill="#94a3b8" font-size="10" text-anchor="middle">'+c[0]+'</text>';
  svg+='<text x="'+(x+bw/2)+'" y="'+(H-38-h)+'" fill="#e2e8f0" font-size="11" font-weight="700" text-anchor="middle">'+items2.length+'</text>';
  svg+='<text class="tlZoomBtn" x="'+(x+bw-2)+'" y="'+(H-30-h-8)+'" fill="#7dd3fc" font-size="12" text-anchor="end" style="cursor:zoom-in">🔍</text>';
  svg+='</g>';
 });
 svg+='</svg>';
 // legend
 var legend='<div class="flex gap-3 flex-wrap mt-2 text-[10px]">'+['movie','tv','game','book'].map(k=>'<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:'+KM[k].c+'"></span>'+KM[k].label+'</span>').join('')+'</div>';
 $('#tlChart').innerHTML=items.length?('<div class="lbl mb-2" style="color:#f0abfc">Works per decade · click a bar to open it in the Global Controller, or 🔍 to preview without leaving this tab</div>'+svg+legend):'<div class="text-center text-slate-500 text-sm py-10">Nothing to show for this filter.</div>';
 // --- optional in-tab decade zoom/preview (no navigation away from Timeline) ---
 var zoomBox=$('#tlDecadeZoom');
 if(zoomBox){
  if(tlZoomDecade!=null){
   var col2=cols.filter(function(c){return c[2]===tlZoomDecade;})[0];
   if(col2){
    var top=col2[1].slice().sort(function(a,b){return b.gm-a.gm;}).slice(0,12);
    zoomBox.innerHTML='<div class="panel p-3 mt-3"><div class="flex items-center justify-between mb-2"><span class="lbl" style="color:#7dd3fc">🔍 '+esc(col2[0])+' — top '+top.length+' of '+col2[1].length+'</span><button type="button" id="tlZoomClose" class="text-[10.5px] text-slate-500 hover:text-slate-300">✕ close</button></div>'
     +'<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">'+top.map(function(it){var k=KM[it.kind];return '<div class="flex items-center gap-2 text-[11px] goatJump cursor-pointer hover:bg-slate-800/30 rounded px-1 -mx-1" data-q="'+esc(it.title)+'" title="Open '+esc(it.title)+' in the Global Controller"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span><span class="flex-1 truncate text-slate-200 hover:text-teal-300">'+esc(it.title)+'</span><span class="text-slate-500 tabular-nums">'+it.year+'</span><span class="tabular-nums font-semibold" style="color:'+k.c+'">'+it.gm+'</span></div>';}).join('')+'</div></div>';
   } else {zoomBox.innerHTML='';tlZoomDecade=null;}
  } else zoomBox.innerHTML='';
 }
 // --- era highlight rows (chronological), each era shows top works ---
 var ERAS=[[-9999,1900,'Antiquity & Classics'],[1900,1960,'The Mid-Century'],[1960,1980,'The New Wave'],[1980,2000,'The Modern Canon'],[2000,2015,'The Digital Age'],[2015,9999,'The Present']];
 var html='';
 ERAS.forEach(function(era){
  var evs=items.filter(x=>x.year>=era[0]&&x.year<era[1]).sort((a,b)=>b.gm-a.gm);
  if(!evs.length)return;
  var chip=function(x){var k=KM[x.kind];return '<span class="cardTitle text-[11px] px-2 py-1 rounded-lg border flex items-center gap-1.5 cursor-pointer hover:border-slate-500" data-flip="'+x.id+'" style="border-color:'+k.c+'44" title="Click to open"><span class="w-1.5 h-1.5 rounded-full" style="background:'+k.c+'"></span>'+(x.owned?'<span style="color:#4ade80">\u2713</span> ':'')+esc(x.title)+' <span class="text-slate-500">'+x.year+'</span> <span style="color:#fbbf24">\u2605'+x.gm+'</span></span>';};
  var top=evs.slice(0,8),rest=evs.slice(8);
  var eid='era'+Math.abs(era[0]);
  html+='<div class="panel p-4"><div class="flex items-center justify-between mb-2"><div class="lbl" style="color:#c084fc">'+esc(era[2])+'</div><div class="text-[11px] text-slate-500">'+evs.length+' works</div></div>'
   +'<div class="flex flex-wrap gap-2">'+top.map(chip).join('')+'</div>'
   +(rest.length?'<div id="'+eid+'" class="flex flex-wrap gap-2 mt-2 hidden">'+rest.map(chip).join('')+'</div>'
     +'<button type="button" class="eraMore text-[10.5px] mt-2.5 px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:border-purple-500 hover:text-purple-300 transition-colors" data-era="'+eid+'" data-n="'+rest.length+'">\u2295 Show all '+evs.length+'</button>':'')
   +'</div>';
 });
 $('#tlEras').innerHTML=html;
}
/* ===== Taste Portrait dashboard ===== */
var FAMILY_COLORS={'Sci-Fi':'#67e8f9','Horror':'#f87171','Documentary':'#e2e8f0','Drama':'#cbd5e1','Thriller':'#fbbf24','Mystery / Detective':'#a5b4fc','Crime':'#fb923c','Psychological':'#c084fc','Action / Adventure':'#fb7185','Epic / Historical':'#fcd34d','Fantasy':'#818cf8','Western':'#d97706','Comedy / Satire':'#fde047','Anime / Animated':'#f0abfc','RPG':'#a78bfa','Open World / Survival':'#4ade80','Puzzle / Systems':'#34d399','Romance':'#f472b6','Superhero':'#38bdf8','War':'#a3a3a3','Physics & Cosmology':'#22d3ee','Philosophy & Ideas':'#c4b5fd','Science & Nature':'#86efac','Biography & History':'#a3e635','Literary & Poetry':'#93c5fd','Platformer':'#fb7185','Strategy & Tactics':'#f59e0b','Sports & Music':'#2dd4bf'};
function renderFamilyLens(){
 var el=$('#familyLens');if(!el)return;
 var rows=GENRE_FAMILIES.map(function(f){
  var name=f[0];var members=ALL.filter(function(x){return x.fam.includes(name);});
  if(!members.length)return null;
  var owned=members.filter(function(x){return x.owned;}).length;
  var topGm=Math.max.apply(null,members.map(function(x){return x.gm;}));
  return {name:name,total:members.length,owned:owned,topGm:topGm};
 }).filter(Boolean).sort(function(a,b){return a.name.localeCompare(b.name);});
 el.innerHTML=rows.map(function(r){
  var col=FAMILY_COLORS[r.name]||'#94a3b8';
  var pct=Math.round(r.owned/r.total*100);
  return '<button type="button" class="familyTile text-left p-3 rounded-xl border transition-colors" data-fam="'+esc(r.name)+'" style="border-color:'+col+'2e;background:'+col+'0d" title="Browse '+esc(r.name)+' across all media">'
   +'<div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full shrink-0" style="background:'+col+'"></span><span class="text-[12.5px] font-semibold text-slate-100 leading-tight">'+esc(r.name)+'</span></div>'
   +'<div class="flex items-baseline gap-2 mt-1.5"><span class="text-[18px] font-extrabold tabular-nums" style="color:'+col+'">'+r.total+'</span><span class="text-[10px] text-slate-500">works · '+r.owned+' owned</span></div>'
   +'<div class="mt-1.5 h-1 rounded-full overflow-hidden" style="background:rgba(148,163,184,.15)"><div style="width:'+pct+'%;height:100%;background:'+col+'"></div></div>'
   +'<div class="text-[9.5px] text-slate-500 mt-1">top match <span style="color:#fbbf24">★'+r.topGm+'</span></div>'
   +'</button>';
 }).join('');
}
// --- helper: horizontal bar list (shared by every "most-owned X" / distribution panel) ---
function barList(entries,color,max){
 const mx=max||Math.max(1,...entries.map(e=>e[1]));
 return entries.map(e=>'<div class="flex items-center gap-2"><span class="text-[12px] text-slate-300 w-40 shrink-0 truncate">'+esc(e[0])+'</span>'
  +'<span class="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden"><span class="block h-full rounded-full" style="width:'+(e[1]/mx*100)+'%;background:'+color+'"></span></span>'
  +'<span class="text-[11px] font-bold tabular-nums w-6 text-right" style="color:'+color+'">'+e[1]+'</span></div>').join('');
}
function renderPortrait(){
 renderFamilyLens();
 const owned=ALL.filter(x=>x.owned);
 const films=owned.filter(x=>x.kind==='movie');
 const tv=owned.filter(x=>x.kind==='tv');
 const games=owned.filter(x=>x.kind==='game');
 const books=owned.filter(x=>x.kind==='book');
 // Headline stats, genre center-of-gravity and decade distribution all honor the same medium
 // scope picker -- previously they always summed across every medium at once, so "your" decade
 // distribution or genre gravity was really "your movies + TV + games + books" undifferentiated,
 // with no way to see just e.g. your book-collecting habits in isolation the way Blind Spots
 // already let you scope by medium.
 const ps=state.portraitScope||'all';
 const scoped=ps==='all'?owned:owned.filter(x=>x.kind===ps);
 // --- headline stats ---
 const ownedAvg=scoped.length?Math.round(scoped.reduce((s,x)=>s+x.ovr,0)/scoped.length):0;
 const decadeSpan=(function(){const ys=scoped.map(x=>x.year).filter(y=>y&&y>0);const modern=ys.filter(y=>y>=1900);return modern.length?(Math.min(...modern)+'\u2013'+Math.max(...modern)):(ys.length?Math.min(...ys)+'\u2013'+Math.max(...ys):'\u2014');})();
 // Top creator now scans whichever kind(s) are in scope, not just movies -- someone whose
 // collection is really a TV or book collection previously got either the wrong answer or "\u2014".
 const topCreator=(function(){const c={};scoped.forEach(x=>{if(x.creator)c[x.creator]=(c[x.creator]||0)+1;});const e=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return e?e[0]:'\u2014';})();
 $('#portraitStats').innerHTML=[
  ['Works owned',scoped.length,'#c4b5fd'],
  ['Avg quality',ownedAvg+' / 100','#4ade80'],
  ['Collection span',decadeSpan,'#22d3ee'],
  ['Top creator',topCreator,'#fbbf24']
 ].map(s=>'<div class="panel p-3 text-center"><div class="text-lg font-extrabold text-slate-50 tabular-nums leading-tight">'+s[1]+'</div><div class="lbl mt-1" style="color:'+s[2]+'">'+s[0]+'</div></div>').join('');
 // --- most-owned creators, one panel per medium (all four now, not just movies/books) ---
 function topCreatorsOf(list){const c={};list.forEach(x=>{if(x.creator)c[x.creator]=(c[x.creator]||0)+1;});return Object.entries(c).filter(e=>e[1]>=2).sort((a,b)=>b[1]-a[1]).slice(0,8);}
 $('#portraitDirectors').innerHTML=barList(topCreatorsOf(films),'#a78bfa')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 $('#portraitAuthors').innerHTML=barList(topCreatorsOf(books),'#4ade80')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 $('#portraitTV').innerHTML=barList(topCreatorsOf(tv),'#22d3ee')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 $('#portraitGames').innerHTML=barList(topCreatorsOf(games),'#fbbf24')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 // --- genre center of gravity (owned, by family, scoped) ---
 const gc={};scoped.forEach(x=>(x.fam||[]).forEach(f=>gc[f]=(gc[f]||0)+1));
 $('#portraitGenres').innerHTML=barList(Object.entries(gc).sort((a,b)=>b[1]-a[1]).slice(0,10),'#22d3ee')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 // --- decade distribution (scoped) ---
 const dd={};let preCount=0;scoped.forEach(x=>{if(x.year&&x.year>0){if(x.year<1900){preCount++;}else{const d=Math.floor(x.year/10)*10;dd[d+'s']=(dd[d+'s']||0)+1;}}});
 let decEntries=Object.keys(dd).sort().map(d=>[d,dd[d]]);
 if(preCount)decEntries=[['Pre-1900',preCount]].concat(decEntries);
 $('#portraitDecades').innerHTML=barList(decEntries,'#fbbf24')||'<div class="text-slate-500 text-[12px]">\u2014</div>';
 // --- blind spots (its own, independent medium filter -- deliberately not tied to portraitScope,
 // since "what am I missing in X" is a different question from "show me my Y stats") ---
 renderPortraitGaps();
 renderCreatorBlindSpots();
}
// A genre-level blind spot detector already existed (renderPortraitGaps: acclaimed works in
// families you own little of); there was no creator-level equivalent -- a way to see "creators
// you own literally nothing from, whose work actually matches your taste." Different from the
// Collection tab's "creators you collect with more to get" gap finder, which only ever looks at
// creators you already own 2+ works from.
function creatorBlindSpots(){
 var ownedCreators={};
 ALL.filter(function(x){return x.owned;}).forEach(function(x){
  (x.creator||'').split(/,| and | & /).forEach(function(cr){cr=cr.trim();if(cr)ownedCreators[cr]=true;});
 });
 var byCreator={};
 ALL.forEach(function(x){
  if(!x.creator)return;
  x.creator.split(/,| and | & /).forEach(function(cr){
   cr=cr.trim();if(cr.length<3||ownedCreators[cr])return;
   (byCreator[cr]=byCreator[cr]||{creator:cr,kind:x.kind,works:[]}).works.push(x);
  });
 });
 return Object.values(byCreator)
  .map(function(c){var top=c.works.slice().sort(function(a,b){return b.gm-a.gm;})[0];return {creator:c.creator,kind:c.kind,n:c.works.length,top:top};})
  .filter(function(r){return r.top.gm>=80;})
  .sort(function(a,b){return b.top.gm-a.top.gm;})
  .slice(0,9);
}
function renderCreatorBlindSpots(){
 var el=$('#creatorBlindSpots');if(!el)return;
 var rows=creatorBlindSpots();
 el.innerHTML=rows.map(function(r){var k=KM[r.kind];
  return '<div class="panel p-2.5 goatJump cursor-pointer" data-q="'+esc(r.top.title)+'" title="Open '+esc(r.top.title)+' in the Global Controller">'
   +'<div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
   +'<span class="flex-1 min-w-0 truncate text-[12px] font-semibold text-slate-200">'+esc(r.creator)+'</span>'
   +'<span class="text-[11px] font-bold tabular-nums" style="color:#fbbf24">\u2605'+r.top.gm+'</span></div>'
   +'<div class="text-[10px] text-slate-500 mt-1 ml-3.5 truncate">'+esc(k.label)+' \u00b7 start with '+esc(r.top.title)+(r.n>1?' \u00b7 '+r.n+' works on ledger':'')+'</div></div>';
 }).join('')||'<div class="text-slate-500 text-[12px]">No strong-matching creators outside your collection right now.</div>';
}
function renderPortraitGaps(){
 const owned=ALL.filter(x=>x.owned);
 const gf=state.gapFilter||'all';
 // Scope the "thin family" analysis to the selected medium so gaps are medium-relevant.
 const scopeAll=gf==='all'?ALL:ALL.filter(x=>x.kind===gf);
 const scopeOwned=gf==='all'?owned:owned.filter(x=>x.kind===gf);
 const famOwned={};scopeOwned.forEach(x=>(x.fam||[]).forEach(f=>famOwned[f]=(famOwned[f]||0)+1));
 const allFams={};scopeAll.forEach(x=>(x.fam||[]).forEach(f=>allFams[f]=true));
 const thin=Object.keys(allFams).filter(f=>(famOwned[f]||0)<=2);
 const seen={};
 const gaps=scopeAll.filter(x=>!x.owned&&(x.fam||[]).some(f=>thin.includes(f)))
   .sort((a,b)=>b.ovr-a.ovr)
   .filter(x=>{if(seen[x.title])return false;seen[x.title]=1;return true;})
   .slice(0,12);
 $('#portraitGaps').innerHTML=gaps.map(x=>{const k=KM[x.kind];const thinFam=(x.fam||[]).find(f=>thin.includes(f))||'';
  return '<div class="panel p-2.5 goatJump cursor-pointer" data-q="'+esc(x.title)+'" title="Open in Global Controller"><div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
   +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200">'+esc(x.title)+' <span class="text-slate-500 text-[10px]">'+x.year+'</span></span>'
   +'<span class="text-[11px] font-bold tabular-nums" style="color:'+k.c+'">'+x.ovr+'</span></div>'
   +(thinFam?'<div class="text-[10px] text-slate-500 mt-1 ml-3.5 truncate">'+esc(k.label)+' \u00b7 '+esc(thinFam)+'</div>':'')+'</div>';}).join('')
   ||'<div class="text-slate-500 text-[12px]">No significant blind spots in this category \u2014 your collection covers it well.</div>';
}
/* ===== Franchise / Series grouping ===== */
const SERIES_DEFS=[
 {name:'The Lord of the Rings (film trilogy)',kind:'movie',members:['The Lord of the Rings: The Fellowship of the Ring','The Lord of the Rings: The Two Towers','The Lord of the Rings: The Return of the King'],total:3},
 {name:"The Man with No Name Trilogy",kind:'movie',members:['The Man with No Name Trilogy','The Good, the Bad and the Ugly'],total:3,boxSet:'The Man with No Name Trilogy'},
 {name:'Alien (Ridley/Cameron)',kind:'movie',members:['Alien','Aliens'],total:2},
 {name:'Middle-earth (Tolkien books)',kind:'book',members:['The Hobbit','The Fellowship of the Ring','The Two Towers','The Return of the King','The Silmarillion','Unfinished Tales','The Adventures of Tom Bombadil','The Children of Húrin'],total:8},
 {name:'The Kingkiller Chronicle',kind:'book',members:['The Name of the Wind',"The Wise Man's Fear",'The Slow Regard of Silent Things','The Doors of Stone'],total:4},
 {name:'The Dark Tower',kind:'book',members:['The Gunslinger','The Drawing of the Three','The Waste Lands','Wizard and Glass','Wolves of the Calla','Song of Susannah','The Dark Tower'],total:7},
 {name:'Hyperion Cantos',kind:'book',members:['Hyperion','The Fall of Hyperion','Endymion','The Rise of Endymion'],total:4},
 {name:'Foundation (original trilogy)',kind:'book',members:['Foundation','Foundation and Empire','Second Foundation'],total:3},
 {name:'Remembrance of Earth\u2019s Past (Three-Body)',kind:'book',members:['The Three-Body Problem','The Dark Forest',"Death's End"],total:3},
 {name:'The Book of the New Sun',kind:'book',members:['The Book of the New Sun'],total:1},
 {name:'Hainish / Le Guin SF',kind:'book',members:['The Dispossessed'],total:1},
 {name:'Lovecraft / cosmic horror',kind:'book',members:['At the Mountains of Madness','The Necronomicon (Lovecraft)','The King in Yellow','Best Ghost Stories of Algernon Blackwood'],total:4},
 {name:'Sagan (popular science)',kind:'book',members:['Cosmos','The Demon-Haunted World','Starry Messenger'],total:3},
 {name:'Harari (Sapiens trilogy)',kind:'book',members:['Sapiens','Homo Deus','Nexus'],total:3},
];
function formatRank(fmt){
 if(!fmt)return 0;var f=fmt.toLowerCase();
 if(f.indexOf('4k')>=0||f.indexOf('uhd')>=0)return 4;
 if(f.indexOf('deluxe')>=0||f.indexOf('illustrated')>=0)return 4;
 if(f.indexOf('blu')>=0||f.indexOf('bd')>=0)return 3;
 if(f.indexOf('hardcover')>=0)return 3;
 if(f.indexOf('dvd')>=0)return 2;
 if(f.indexOf('paperback')>=0||f.indexOf('softcover')>=0)return 2;
 if(f.indexOf('box')>=0)return 3;
 return 1;
}
function collectionGaps(){
 // Auto-detect collection gaps: (A) creators you collect where strong works sit unowned,
 // (B) same-root franchise/series entries you're missing. Honors the medium segment filter.
 var cs=state.collSeg||'all';
 var owned=ALL.filter(function(x){return x.owned&&(cs==='all'||x.kind===cs);});
 var out={creators:[],series:[]};
 // (A) Creators you own 2+ from, with unowned high-match works available
 var byCreator={};
 owned.forEach(function(x){if(!x.creator)return;x.creator.split(/,| and | & /).forEach(function(cr){cr=cr.trim();if(cr.length<3)return;(byCreator[cr]=byCreator[cr]||[]).push(x);});});
 Object.keys(byCreator).forEach(function(cr){
  if(byCreator[cr].length<2)return; // you "collect" this creator
  var missing=ALL.filter(function(x){return !x.owned&&(cs==='all'||x.kind===cs)&&x.creator&&x.creator.indexOf(cr)>=0;})
    .sort(function(a,b){return (b.gm-a.gm)||(b.ovr-a.ovr);});
  if(!missing.length)return;
  out.creators.push({creator:cr,ownedN:byCreator[cr].length,missing:missing.slice(0,5),topGm:missing[0].gm});
 });
 out.creators.sort(function(a,b){return (b.ownedN-a.ownedN)||(b.topGm-a.topGm);});
 out.creators=out.creators.slice(0,10);
 // (B) Same-root franchise gaps: cluster by a normalized title root (before ':' or a number)
 function root(t){return t.toLowerCase().replace(/[:\-\u2013].*$/,'').replace(/\b(part|vol|volume|book)\b.*$/,'').replace(/\b(i{1,3}|iv|v|vi{0,3}|\d+)\b\s*$/,'').replace(/[^a-z0-9 ]/g,'').trim();}
 var byRoot={};
 ALL.forEach(function(x){if(cs!=='all'&&x.kind!==cs)return;var r=root(x.title);if(r.length<4)return;(byRoot[r]=byRoot[r]||[]).push(x);});
 Object.keys(byRoot).forEach(function(r){
  var grp=byRoot[r];if(grp.length<2)return;
  var own=grp.filter(function(x){return x.owned;});
  var miss=grp.filter(function(x){return !x.owned;});
  if(!own.length||!miss.length)return; // own some, missing some = a real gap
  out.series.push({root:r,name:own[0].title.split(/[:\-\u2013]/)[0].trim(),kind:own[0].kind,ownedN:own.length,total:grp.length,missing:miss.sort(function(a,b){return (a.year||0)-(b.year||0);}).slice(0,6)});
 });
 out.series.sort(function(a,b){return (b.ownedN-a.ownedN)||(a.missing.length-b.missing.length);});
 out.series=out.series.slice(0,12);
 return out;
}
function collectionGapsHTML(){
 var g=collectionGaps();
 if(!g.creators.length&&!g.series.length)return '';
 var html='<div class="panel p-4 mb-4 mt-6"><div class="flex items-center gap-2 flex-wrap"><h3 class="text-base font-bold" style="color:#c084fc">🧩 Collection Intelligence \u2014 Gaps</h3>'
  +'<span class="text-[11px] text-slate-500 ml-auto">what your shelf is missing</span></div>'
  +'<p class="text-[11px] text-slate-500 mt-1.5 max-w-3xl">Series you\u2019ve started but haven\u2019t finished, and creators you clearly collect with acclaimed works still unowned \u2014 all drawn from the ledger.</p></div>';
 if(g.series.length){
  html+='<div class="mb-2 text-[11px] uppercase tracking-[.14em] text-slate-500">\u25e6 Franchise / series gaps</div><div class="space-y-2 mb-5">';
  g.series.forEach(function(sg){
   var k=KM[sg.kind];
   html+='<div class="panel p-3"><div class="flex items-center gap-2 mb-1"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
    +'<span class="text-[12.5px] font-semibold text-slate-100">'+esc(sg.name)+'</span>'
    +'<span class="text-[10px] text-slate-500">own '+sg.ownedN+' of '+sg.total+'</span></div>'
    +'<div class="flex flex-wrap gap-1.5">'+sg.missing.map(function(x){return '<span class="text-[10.5px] px-2 py-0.5 rounded goatJump cursor-pointer" data-q="'+esc(x.title)+'" style="background:#1e293b;color:#cbd5e1" title="'+esc(x.creator||'')+' \u2014 open in Global Controller">\u25e6 '+esc(x.title)+' <span style="color:#fbbf24">\u2605'+x.gm+'</span></span>';}).join('')+'</div></div>';
  });
  html+='</div>';
 }
 if(g.creators.length){
  html+='<div class="mb-2 text-[11px] uppercase tracking-[.14em] text-slate-500">\u25c8 Creators you collect \u2014 acclaimed works you\u2019re missing</div><div class="space-y-2">';
  g.creators.forEach(function(cg){
   var k=KM[cg.missing[0].kind];
   html+='<div class="panel p-3"><div class="flex items-center gap-2 mb-1">'
    +'<span class="text-[12.5px] font-semibold" style="color:'+k.c+'">'+esc(cg.creator)+'</span>'
    +'<span class="text-[10px] text-slate-500">you own '+cg.ownedN+'</span></div>'
    +'<div class="flex flex-wrap gap-1.5">'+cg.missing.map(function(x){var kk=KM[x.kind];return '<span class="text-[10.5px] px-2 py-0.5 rounded goatJump cursor-pointer" data-q="'+esc(x.title)+'" title="Open in Global Controller" style="background:#1e293b;color:#cbd5e1">'+esc(x.title)+' <span style="color:'+kk.c+'">'+kk.label+'</span> <span style="color:#fbbf24">\u2605'+x.gm+'</span></span>';}).join('')+'</div></div>';
  });
  html+='</div>';
 }
 return html;
}
function renderUpgradeAudit(){
 var owned=ALL.filter(x=>x.owned&&x.kind!=='game');
 var cs=state.collSeg||'all';
 if(cs!=='all')owned=owned.filter(x=>x.kind===cs);
 // An upgrade candidate = owned, and suggested best edition ranks higher than what you own.
 var cands=[];
 owned.forEach(function(x){
  var f=suggestedFormat(x);if(!f)return;
  var have=formatRank(x.physFormat),want=formatRank(f.fmt);
  if(want>have){
   // upgrade value: how much the format matters for THIS work (visual/craft driven) + quality
   var matter;
   if(x.kind==='movie'||x.kind==='tv'){var cine=(x.fid&&x.fid[2])?x.fid[2][1]:x.tech;var trans=(x.fid&&x.fid[0])?x.fid[0][1]:x.tech;matter=Math.max(cine,trans,x.awe||0);}
   else if(x.kind==='book'){matter=Math.max(x.crit||0,x.aud||0);}
   else matter=x.ovr;
   var mv=matter>10?matter:matter*10;var ov=x.ovr>10?x.ovr:x.ovr*10;var value=Math.min(100,Math.round((mv*0.6+ov*0.3+(want-have)*8)*10)/10);
   cands.push({x:x,from:x.physFormat,to:f.fmt,why:f.why,value:value,gap:want-have});
  }
 });
 cands.sort((a,b)=>b.value-a.value);
 var el=$('#collUpgrade');
 var head='<div class="panel p-4 mb-4"><div class="flex items-center gap-2 flex-wrap"><h3 class="text-base font-bold" style="color:#7dd3fc">\u2b06 Format Upgrade Audit</h3>'
  +'<span class="text-[11px] text-slate-500 ml-auto">'+cands.length+' worth upgrading</span></div>'
  +'<p class="text-[11px] text-slate-500 mt-1.5 max-w-3xl">Titles you own where a better edition would meaningfully improve the experience \u2014 ranked by how much the upgrade matters for that specific work.</p></div>';
 if(cs==='game'){el.innerHTML=head+'<div class="panel p-6 text-center text-slate-500 text-sm">Games aren\u2019t tracked for format upgrades \u2014 most are digital, so there\u2019s no physical edition to audit. \u2b06 Switch to Film / TV / Books above.</div>'+collectionGapsHTML();return;}
 if(!cands.length){el.innerHTML=head+'<div class="panel p-6 text-center text-slate-500 text-sm">Nothing to upgrade in this category \u2014 you own the best editions. \u2728</div>'+collectionGapsHTML();return;}
 var rows=cands.map(function(c,i){
  var k=KM[c.x.kind];
  var band=c.value>=88?'#4ade80':c.value>=78?'#fbbf24':'#94a3b8';
  // Mobile-first: title row on top (full width, wraps), then a transition/value row beneath.
  return '<div class="panel p-3">'
   +'<div class="flex items-start gap-2.5">'
   +'<div class="text-[12px] font-bold tabular-nums w-5 text-center shrink-0 mt-0.5" style="color:'+band+'">'+(i+1)+'</div>'
   +'<span class="w-2 h-2 rounded-full shrink-0 mt-1.5" style="background:'+k.c+'"></span>'
   +'<div class="flex-1 min-w-0">'
   +'<div class="text-[13px] text-slate-100 font-semibold leading-snug">'+esc(c.x.title)+' <span class="text-slate-500 text-[10px] font-normal">'+c.x.year+'</span> <span class="chip" style="color:'+k.c+';border-color:'+k.c+'44;font-size:8.5px;padding:1px 6px">'+k.label+'</span></div>'
   +'<div class="text-[11px] text-slate-400 mt-1 leading-relaxed">'+esc(c.why)+'</div>'
   +'<div class="flex items-center flex-wrap gap-2 mt-2">'
   +'<span class="text-[10.5px] px-2 py-1 rounded" style="background:#1e293b;color:#cbd5e1">'+esc(c.from||'\u2014')+'</span>'
   +'<span style="color:'+band+';font-weight:700">\u2192</span>'
   +'<span class="text-[10.5px] px-2 py-1 rounded font-semibold" style="background:'+band+'22;color:'+band+'">'+esc(c.to)+'</span>'
   +'<span class="ml-auto flex items-baseline gap-1"><span class="text-[15px] font-extrabold tabular-nums" style="color:'+band+'">'+c.value+'</span><span class="lbl" style="color:'+band+'">value</span></span>'
   +'</div>'
   +'</div>'
   +'</div>'
   +'</div>';
 }).join('');
 el.innerHTML=head+'<div class="space-y-2">'+rows+'</div>'+collectionGapsHTML();
}
function renderCollectionShelf(){
 var owned=ALL.filter(x=>x.owned);
 var cs=state.collSeg||'all';
 if(cs!=='all')owned=owned.filter(x=>x.kind===cs);
 var searchQ=(state.collSearchQ||'').trim().toLowerCase();
 if(searchQ)owned=owned.filter(function(x){return x.title.toLowerCase().indexOf(searchQ)>=0;});
 // Group into shelves by medium; each item is a spine whose height/color reflect the work.
 var groups=[['movie','Films'],['tv','Series'],['book','Books'],['game','Games']];
 var html='<p class="text-[11px] text-slate-500 mb-3">Your physical collection as a shelf \u2014 spine height reflects quality, colour marks the medium. Hover a spine for the title.</p>';
 groups.forEach(function(g){
  var items=owned.filter(x=>x.kind===g[0]).sort((a,b)=>a.title.localeCompare(b.title));
  if(!items.length)return;
  var k=KM[g[0]];
  // shelf
  html+='<div class="mb-5"><div class="flex items-center gap-2 mb-1.5"><span class="lbl" style="color:'+k.c+'">'+esc(g[1])+'</span><span class="text-[10px] text-slate-500">'+items.length+' on the shelf</span></div>';
  html+='<div class="relative rounded-t-sm px-2 pt-3 pb-0 flex items-end gap-[3px] flex-wrap" style="background:linear-gradient(180deg,#0b0f19,#0d1220);min-height:120px">';
  items.forEach(function(x){
   var q=Math.max(60,Math.min(100,x.ovr));
   var hgt=70+(q-60)*1.6; // 70-134px
   var hue=x.gm; // subtle brightness by taste match
   var goldRing=x.goat?'box-shadow:0 0 6px #fcd34d,inset 0 0 0 1px #fcd34d;':'';
   var lbl=esc(x.title);
   var initials=(x.title||'').split(' ').filter(w=>/[A-Za-z0-9]/.test(w[0])).slice(0,3).map(w=>w[0]).join('');
   html+='<div class="group relative cursor-default" style="width:16px;height:'+hgt+'px;border-radius:2px 2px 0 0;background:linear-gradient(180deg,'+k.c+'ee,'+k.c+'99);'+goldRing+'" title="'+lbl+' ('+x.year+') \u00b7 '+esc(x.physFormat||'')+'">'
    +'<span class="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-black/60" style="writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:0.5px">'+esc(initials)+'</span>'
    +'</div>';
  });
  // shelf board
  html+='</div><div style="height:8px;background:linear-gradient(180deg,#3a2a1a,#241a10);border-radius:0 0 3px 3px;box-shadow:0 4px 8px rgba(0,0,0,0.4)"></div></div>';
 });
 if(owned.length===0)html+='<div class="panel p-6 text-center text-slate-500 text-sm">'+(searchQ?'Nothing on the shelf matches “'+esc(state.collSearchQ.trim())+'”.':'No owned items in this category.')+'</div>';
 $('#collShelf').innerHTML=html;
}
// Shared by both the hand-curated SERIES_DEFS list and the auto-detected franchises below --
// same card shape either way, so a TV or game franchise reads identically to a curated movie/book
// trilogy instead of looking like a bolted-on second system.
function seriesCardHTML(k,name,ownedMembers,missing,total,complete){
 var pct=Math.round(ownedMembers.length/total*100);
 var rows=ownedMembers.slice().sort((a,b)=>(a.year||0)-(b.year||0)).map(x=>
  '<div class="flex items-center gap-2 py-1"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
  +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200">'+esc(x.title)+' <span class="text-slate-500 text-[10px]">'+x.year+'</span></span>'
  +'<span class="text-[10px] text-emerald-400">\u2713 '+esc(x.physFormat||'owned')+'</span>'
  +'<span class="text-[11px] font-bold tabular-nums ml-1" style="color:'+k.c+'">'+x.ovr+'</span></div>').join('');
 var missingHTML=missing.length?'<div class="mt-2 pt-2 border-t border-slate-800/70"><div class="text-[10px] text-amber-400/80 mb-1">To complete \u2014 in ledger, not owned:</div>'
  +missing.map(x=>'<div class="text-[11px] text-slate-400 truncate">\u25e6 '+esc(x.title)+'</div>').join('')+'</div>':'';
 return '<div class="panel p-4"><div class="flex items-center justify-between gap-2 mb-2">'
  +'<div class="lbl" style="color:'+k.c+'">'+k.label+' \u00b7 '+esc(name)+'</div>'
  +'<div class="text-[11px] font-bold tabular-nums '+(complete?'text-emerald-400':'text-slate-400')+'">'+ownedMembers.length+' / '+total+(complete?' \u2713 complete':'')+'</div></div>'
  +'<div class="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-3"><div class="h-full rounded-full" style="width:'+pct+'%;background:'+(complete?'#34d399':k.c)+'"></div></div>'
  +rows+missingHTML+'</div>';
}
// Same normalized-title-root clustering already used by collectionGaps() below, for the same
// reason: TV shows and games get zero entries in the hand-curated SERIES_DEFS list (it only
// covers movies and books), so franchises like a TV series' seasons or a game trilogy never
// grouped here at all. Auto-detecting fills that gap instead of hand-curating two more lists.
function seriesTitleRoot(t){return t.toLowerCase().replace(/[:\-\u2013].*$/,'').replace(/\b(part|vol|volume|book|season)\b.*$/,'').replace(/\b(i{1,3}|iv|v|vi{0,3}|\d+)\b\s*$/,'').replace(/[^a-z0-9 ]/g,'').trim();}
function renderCollectionSeries(){
 const cs=state.collSeg||'all';
 const q=(state.collSearchQ||'').trim().toLowerCase();
 const byId2=new Map(ALL.map(x=>[x.title,x]));
 // Build series cards: only show series where you own >=2, honoring the medium filter.
 const cards=[];
 SERIES_DEFS.forEach(def=>{
  if(cs!=='all'&&def.kind!==cs) return;
  const ownedMembers=def.members.map(t=>byId2.get(t)).filter(x=>x&&x.owned);
  const hasBox=def.boxSet&&(function(){const b=byId2.get(def.boxSet);return b&&b.owned;})();
  if(ownedMembers.length<2&&!hasBox) return; // only meaningful multi-item series (or a complete box set)
  if(q&&def.name.toLowerCase().indexOf(q)<0&&!ownedMembers.some(x=>x.title.toLowerCase().indexOf(q)>=0))return;
  const k=KM[def.kind];
  const missing=hasBox?[]:def.members.map(t=>byId2.get(t)).filter(x=>x&&!x.owned);
  const complete=hasBox||ownedMembers.length>=def.total;
  const effOwned=hasBox?def.members.map(t=>byId2.get(t)).filter(Boolean):ownedMembers;
  cards.push({pct:Math.round((hasBox?def.total:ownedMembers.length)/def.total*100),name:def.name,html:seriesCardHTML(k,def.name,hasBox?effOwned:ownedMembers,missing,def.total,complete)});
 });
 // Auto-detected TV / game franchises (curated list has neither)
 const curatedTitles=new Set(SERIES_DEFS.flatMap(d=>d.members.concat(d.boxSet?[d.boxSet]:[])));
 ['tv','game'].forEach(function(kind){
  if(cs!=='all'&&cs!==kind)return;
  const byRoot={};
  ALL.forEach(function(x){if(x.kind!==kind||curatedTitles.has(x.title))return;const r=seriesTitleRoot(x.title);if(r.length<4)return;(byRoot[r]=byRoot[r]||[]).push(x);});
  Object.keys(byRoot).forEach(function(r){
   const grp=byRoot[r];
   const ownedMembers=grp.filter(function(x){return x.owned;});
   if(ownedMembers.length<2)return;
   const name=grp[0].title.split(/[:\-\u2013]/)[0].trim();
   if(q&&name.toLowerCase().indexOf(q)<0&&!ownedMembers.some(x=>x.title.toLowerCase().indexOf(q)>=0))return;
   const missing=grp.filter(function(x){return !x.owned;});
   const k=KM[kind];
   cards.push({pct:Math.round(ownedMembers.length/grp.length*100),name:name,html:seriesCardHTML(k,name,ownedMembers,missing,grp.length,ownedMembers.length>=grp.length)});
  });
 });
 cards.sort((a,b)=>a.name.localeCompare(b.name));
 const el=$('#collSeries');
 if(!cards.length){el.innerHTML='<div class="panel p-6 text-center text-slate-500 text-sm">'+(q?'No series match \u201c'+esc(state.collSearchQ.trim())+'\u201d.':'No multi-item series in this category yet. Own two or more from a franchise to see it grouped here.')+'</div>';return;}
 el.innerHTML='<p class="text-[11px] text-slate-500 mb-1">Your collection grouped by franchise \u2014 completion at a glance. \u25e6 marks entries in the ledger you don\u2019t yet own.</p>'+cards.map(c=>c.html).join('');
}
function renderCollection(){
 const owned=ALL.filter(x=>x.owned);
 const cs=state.collSeg||'all';
 const q=(state.collSearchQ||'').trim().toLowerCase();
 const scope=(cs==='all'?owned:owned.filter(x=>x.kind===cs)).filter(x=>!q||x.title.toLowerCase().indexOf(q)>=0);
 // stats
 const fmtCount=f=>owned.filter(x=>(x.physFormat||'')===f).length;
 const avg=scope.length?Math.round(scope.reduce((s,x)=>s+x.ovr,0)/scope.length):0;
 $('#collStats').innerHTML=[
  ['Total Owned',owned.length],['Films',owned.filter(x=>x.kind==='movie').length],
  ['Series',owned.filter(x=>x.kind==='tv').length],['Games',owned.filter(x=>x.kind==='game').length],['Books',owned.filter(x=>x.kind==='book').length],
  ['Avg Quality',avg]
 ].map(s=>'<div class="panel p-3 text-center"><div class="text-xl font-extrabold text-slate-50 tabular-nums">'+s[1]+'</div><div class="lbl mt-1">'+s[0]+'</div></div>').join('');
 // group by format -- games don't have an editable physical format (most are digital), so they
 // just get their own plain "Games" bucket rather than a fake edition label.
 const FORMAT_ORDER=['4K','Blu-ray','DVD','BD/DVD','Box Set','Deluxe','Hardcover','Softcover','Paperback','Games'];
 const groups={};scope.forEach(x=>{const f=x.kind==='game'?'Games':(x.physFormat||'Other');(groups[f]=groups[f]||[]).push(x);});
 const order=FORMAT_ORDER.filter(f=>groups[f]).concat(Object.keys(groups).filter(f=>!FORMAT_ORDER.includes(f)));
 $('#collFormats').innerHTML=order.map(f=>{
  const items=groups[f].slice().sort((a,b)=>a.title.localeCompare(b.title));const fs=fmtStyle(f);const col=fs.ac;
  return '<div><div class="flex items-center gap-2 mb-2"><span class="chip" style="color:'+fs.fg+';background:'+fs.bg+';border-color:'+fs.bd+';font-weight:700">'+esc(f)+'</span><span class="lbl">'+items.length+' title'+(items.length>1?'s':'')+'</span></div>'
   +'<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">'+items.map(x=>{const k=KM[x.kind];
     return '<div class="panel p-2.5 flex items-center gap-2.5"><div class="w-1 self-stretch rounded" style="background:'+col+'"></div>'
      +'<div class="flex-1 min-w-0"><div class="text-[12px] font-semibold text-slate-100 truncate">'+esc(x.title)+'</div>'
      +'<div class="text-[10px] text-slate-500 truncate">'+x.year+' \u00b7 '+esc(x.creator)+' \u00b7 <span style="color:'+k.c+'">'+k.label+'</span></div>'+formatPickerHTML(x)+'</div>'
      +'<div class="text-right shrink-0"><div class="text-[13px] font-bold tabular-nums" style="color:'+col+'">'+x.ovr+'</div>'+(x.goat?'<div class="text-[9px]" style="color:#fbbf24">\u2605 GOAT</div>':x.silver?'<div class="text-[9px] text-slate-400">\u2606</div>':'')+'</div></div>';}).join('')+'</div></div>';
 }).join('')||'<div class="text-center text-slate-500 text-sm py-10">'+(q?'Nothing in your collection matches \u201c'+esc(state.collSearchQ.trim())+'\u201d.':'No owned items in this category.')+'</div>';
 // gaps: top-rated NOT owned, per medium (games included now that they're part of the Collection tab)
 const gaps=ALL.filter(x=>!x.owned).sort((a,b)=>b.ovr-a.ovr).slice(0,18);
 $('#collGaps').innerHTML=gaps.map(x=>{const k=KM[x.kind];
  return '<div class="panel p-2.5 flex items-center gap-2 goatJump cursor-pointer" data-q="'+esc(x.title)+'" title="Open in Global Controller"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k.c+'"></span>'
   +'<span class="flex-1 min-w-0 truncate text-[12px] text-slate-200">'+esc(x.title)+' <span class="text-slate-500 text-[10px]">'+x.year+'</span></span>'
   +'<span class="text-[11px] font-bold tabular-nums" style="color:'+k.c+'">'+x.ovr+'</span></div>';}).join('');
}
/* ===== Shareable / bookmarkable URL state =====
   Encodes which tab you're on plus the Global Controller's active filters into the query string,
   via history.replaceState -- not pushState, since the goal is "this exact page is bookmarkable
   right now," not a back/forward trail through every slider drag. Only non-default values are
   written, so an untouched search keeps a clean URL. Hooked into refresh() (called by virtually
   every filter/view change already) rather than sprinkled across every individual handler. */
function stateToParams(){
 var p=new URLSearchParams();
 if(state.view&&state.view!=='controller')p.set('view',state.view);
 if(state.q)p.set('q',state.q);
 if(state.type&&state.type!=='all')p.set('type',state.type);
 if(state.plats&&state.plats.length)p.set('plat',state.plats.join('|'));
 if(state.genres&&state.genres.length)p.set('g',state.genres.join('|'));
 if(state.genresExclude&&state.genresExclude.length)p.set('gx',state.genresExclude.join('|'));
 if(state.ratings&&state.ratings.length)p.set('rt',state.ratings.join('|'));
 if(state.tierFilter&&state.tierFilter.length)p.set('tier',state.tierFilter.join('|'));
 if(state.ownedOnly)p.set('owned','1');
 if(state.notOwnedOnly)p.set('notowned','1');
 if(state.minGoat)p.set('goat',state.minGoat);
 if(state.idx.dread)p.set('dread',state.idx.dread);
 if(state.idx.myst)p.set('myst',state.idx.myst);
 if(state.idx.runtime)p.set('runtime',state.idx.runtime);
 if(state.struct&&state.struct!=='all')p.set('struct',state.struct);
 if(state.combine)p.set('and','1');
 if(state.yearMin!=null)p.set('ymin',state.yearMin);
 if(state.yearMax!=null)p.set('ymax',state.yearMax);
 if(state.sort&&state.sort!=='overall')p.set('sort',state.sort);
 if(state.limit&&state.limit!==100)p.set('n',state.limit);
 IDX_KEYS.forEach(function(k){if(state.idx[k]>0)p.set('i_'+k,state.idx[k]);});
 if(state.goatType&&state.goatType!=='all')p.set('goatType',state.goatType);
 if(state.goatTierFilter&&state.goatTierFilter!=='all')p.set('goatTier',state.goatTierFilter);
 if(state.goatSort&&state.goatSort!=='match')p.set('goatSort',state.goatSort);
 if(state.goatDeclaredQ)p.set('goatQ',state.goatDeclaredQ);
 if(state.portraitScope&&state.portraitScope!=='all')p.set('portScope',state.portraitScope);
 if(state.collSearchQ)p.set('collQ',state.collSearchQ);
 if(state.wlType&&state.wlType!=='all')p.set('wlType',state.wlType);
 if(state.wlSort&&state.wlSort!=='added')p.set('wlSort',state.wlSort);
 if(state.wlSearchQ)p.set('wlQ',state.wlSearchQ);
 if(state.creatorSearchScope&&state.creatorSearchScope!=='all')p.set('crScope',state.creatorSearchScope);
 if(state.creatorSort&&state.creatorSort!=='default')p.set('crSort',state.creatorSort);
 if(typeof contMedium!=='undefined'&&contMedium!=='all')p.set('contMed',contMedium);
 if(typeof contSort!=='undefined'&&contSort!=='foryou')p.set('contSort',contSort);
 if(typeof contSearchQ!=='undefined'&&contSearchQ)p.set('contQ',contSearchQ);
 if(typeof matrixOwnedOnly!=='undefined'&&matrixOwnedOnly)p.set('mxOwned','1');
 if(typeof matrixNavQ!=='undefined'&&matrixNavQ)p.set('mxQ',matrixNavQ);
 if(typeof bubbleMinScore!=='undefined'&&bubbleMinScore>0)p.set('bMin',bubbleMinScore);
 if(typeof tlMedium!=='undefined'&&tlMedium!=='all')p.set('tlMed',tlMedium);
 return p;
}
function paramsToState(){
 try{
  var p=new URLSearchParams(location.search);
  if(!Array.from(p.keys()).length)return null;
  if(p.has('q'))state.q=p.get('q');
  if(p.has('type'))state.type=p.get('type');
  if(p.has('plat'))state.plats=p.get('plat').split('|').filter(Boolean);
  if(p.has('g'))state.genres=p.get('g').split('|').filter(Boolean);
  if(p.has('gx'))state.genresExclude=p.get('gx').split('|').filter(Boolean);
  if(p.has('rt'))state.ratings=p.get('rt').split('|').filter(Boolean);
  if(p.has('tier'))state.tierFilter=p.get('tier').split('|').filter(Boolean);
  if(p.has('owned'))state.ownedOnly=p.get('owned')==='1';
  if(p.has('notowned'))state.notOwnedOnly=p.get('notowned')==='1';
  if(p.has('goat'))state.minGoat=+p.get('goat')||0;
  if(p.has('dread'))state.idx.dread=+p.get('dread')||0;
  if(p.has('myst'))state.idx.myst=+p.get('myst')||0;
  if(p.has('runtime'))state.idx.runtime=+p.get('runtime')||0;
  if(p.has('struct'))state.struct=p.get('struct');
  if(p.has('and'))state.combine=p.get('and')==='1';
  if(p.has('ymin'))state.yearMin=+p.get('ymin');
  if(p.has('ymax'))state.yearMax=+p.get('ymax');
  if(p.has('sort'))state.sort=p.get('sort');
  if(p.has('n'))state.limit=+p.get('n')||100;
  IDX_KEYS.forEach(function(k){if(p.has('i_'+k))state.idx[k]=+p.get('i_'+k)||0;});
  if(p.has('goatType'))state.goatType=p.get('goatType');
  if(p.has('goatTier'))state.goatTierFilter=p.get('goatTier');
  if(p.has('goatSort'))state.goatSort=p.get('goatSort');
  if(p.has('goatQ'))state.goatDeclaredQ=p.get('goatQ');
  if(p.has('portScope'))state.portraitScope=p.get('portScope');
  if(p.has('collQ'))state.collSearchQ=p.get('collQ');
  if(p.has('wlType'))state.wlType=p.get('wlType');
  if(p.has('wlSort'))state.wlSort=p.get('wlSort');
  if(p.has('wlQ'))state.wlSearchQ=p.get('wlQ');
  if(p.has('crScope'))state.creatorSearchScope=p.get('crScope');
  if(p.has('crSort'))state.creatorSort=p.get('crSort');
  if(p.has('contMed')&&typeof contMedium!=='undefined')contMedium=p.get('contMed');
  if(p.has('contSort')&&typeof contSort!=='undefined')contSort=p.get('contSort');
  if(p.has('contQ')&&typeof contSearchQ!=='undefined')contSearchQ=p.get('contQ');
  if(p.has('mxOwned')&&typeof matrixOwnedOnly!=='undefined')matrixOwnedOnly=p.get('mxOwned')==='1';
  if(p.has('mxQ')&&typeof matrixNavQ!=='undefined')matrixNavQ=p.get('mxQ');
  if(p.has('bMin')&&typeof bubbleMinScore!=='undefined')bubbleMinScore=+p.get('bMin')||0;
  if(p.has('tlMed')&&typeof tlMedium!=='undefined')tlMedium=p.get('tlMed');
  return p.get('view')||null;
 }catch(e){return null;}
}
var _urlSyncT=null;
function scheduleURLSync(){
 clearTimeout(_urlSyncT);
 _urlSyncT=setTimeout(function(){
  try{
   var qs=stateToParams().toString();
   history.replaceState(null,'',location.pathname+(qs?'?'+qs:'')+location.hash);
  }catch(e){}
 },250);
}
// Pushes every restored value into the controls that aren't already rebuilt fresh from `state`
// (genre/rating chips and the index sliders are -- see buildGenreChips/buildRatingChips/
// buildIndexSliders, all of which read state directly) -- the plain HTML inputs, selects and
// checkboxes need their DOM state set explicitly to match.
function applyStateToStaticControls(){
 var qi=$('#q');if(qi)qi.value=state.q;
 $$('#typeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.type===state.type);});
 var mg=$('#minGoat');if(mg){mg.value=state.minGoat;var mgv=$('#minGoatV');if(mgv)mgv.textContent=state.minGoat;}
 var ss=$('#structSel');if(ss)ss.value=state.struct;
 var cm=$('#combineMode');if(cm)cm.checked=state.combine;
 var ot=$('#ownedToggle');if(ot)ot.checked=state.ownedOnly;
 var nt=$('#notOwnedToggle');if(nt)nt.checked=state.notOwnedOnly;
 $$('.tierChk').forEach(function(c){c.checked=state.tierFilter.indexOf(c.dataset.tier)>=0;});
 var ymin=$('#yearMin');if(ymin)ymin.value=state.yearMin!=null?state.yearMin:'';
 var ymax=$('#yearMax');if(ymax)ymax.value=state.yearMax!=null?state.yearMax:'';
 var sortSel=$('#sortSel');if(sortSel)sortSel.value=state.sort;
 var limitSel=$('#limitSel');if(limitSel)limitSel.value=state.limit;
 if(typeof updatePlatLabel==='function')updatePlatLabel();
 if(typeof buildGenreChips==='function')buildGenreChips();
 if(typeof buildRatingChips==='function')buildRatingChips();
 if(typeof buildIndexSliders==='function')buildIndexSliders();
 if(typeof syncAdvCount==='function')syncAdvCount();
 // If restoring the URL turned on anything that lives inside the collapsed Advanced Filters panel,
 // open it -- otherwise a bookmark that filtered on e.g. content rating looks like it silently lost
 // that filter until you happen to expand the panel yourself.
 var advCount=$('#advCount');
 if(advCount&&advCount.style.display!=='none'){
  var pnl=$('#advPanel');if(pnl&&pnl.classList.contains('hidden')){pnl.classList.remove('hidden');var caret=$('#advCaret');if(caret)caret.style.transform='rotate(90deg)';}
 }
 // Per-tab filters restored from a bookmarked URL: push into their controls, and re-render each
 // tab's list (their own initial render already ran before the URL was parsed).
 $$('#goatTypeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.t===state.goatType);});
 $$('#goatTierSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.tf===state.goatTierFilter);});
 var goatSortSel=$('#goatSortSel');if(goatSortSel)goatSortSel.value=state.goatSort;
 var goatQ=$('#goatDeclaredSearch');if(goatQ)goatQ.value=state.goatDeclaredQ;
 $$('#portraitScopeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.ps===state.portraitScope);});
 var collQ=$('#collSearch');if(collQ)collQ.value=state.collSearchQ;
 $$('#wlTypeSeg button').forEach(function(b){b.classList.toggle('on',b.dataset.wt===state.wlType);});
 var wlSortSel=$('#wlSortSel');if(wlSortSel)wlSortSel.value=state.wlSort;
 var wlQ=$('#wlSearch');if(wlQ)wlQ.value=state.wlSearchQ;
 $$('#creatorSearchScope button').forEach(function(b){b.classList.toggle('on',b.dataset.scope===state.creatorSearchScope);});
 var crSortSel=$('#creatorSortSel');if(crSortSel)crSortSel.value=state.creatorSort;
 if(typeof contMedium!=='undefined'){$$('.contMedBtn').forEach(function(b){b.classList.toggle('on',b.dataset.med===contMedium);});}
 if(typeof contSort!=='undefined'){$$('.contSortBtn').forEach(function(b){b.classList.toggle('on',b.dataset.sort===contSort);});}
 if(typeof contSearchQ!=='undefined'){var contQEl=$('#contSearch');if(contQEl)contQEl.value=contSearchQ;}
 if(typeof matrixOwnedOnly!=='undefined'){var mxo=$('#matrixOwnedOnly');if(mxo)mxo.checked=matrixOwnedOnly;}
 if(typeof matrixNavQ!=='undefined'){var mxq=$('#matrixNavSearch');if(mxq)mxq.value=matrixNavQ;}
 if(typeof bubbleMinScore!=='undefined'){var bMinEl=$('#bubbleMin');if(bMinEl)bMinEl.value=bubbleMinScore;var bMinLbl=$('#bubbleMinLbl');if(bMinLbl)bMinLbl.textContent=bubbleMinScore>0?bubbleMinScore+'+':'Any';}
 if(typeof tlMedium!=='undefined'){$$('#tlMedium button').forEach(function(b){b.classList.toggle('on',b.dataset.tm===tlMedium);});}
 if(typeof renderGoat==='function')renderGoat();
 if(typeof renderCollection==='function')renderCollection();
 if(typeof renderWatchlist==='function')renderWatchlist();
 if(typeof renderCreators==='function')renderCreators();
 if(typeof renderContenders==='function')renderContenders();
 if(typeof renderMatrices==='function')renderMatrices();
}
function refresh(){const list=filtered();
 if(state.view==='controller')renderController(list);
 else if(state.view==='viz'){initCharts();updateCharts(list);}
 else if(state.view==='watchlist')renderWatchlist();
 else if(state.view==='collection')renderCollection();
 scheduleURLSync();
}
function switchView(v){state.view=v;
 // #nav scrolls horizontally on mobile (see the MOBILE media-query block) rather than wrapping
 // into several rows -- scrollIntoView here keeps whichever tab is now active from getting stuck
 // off to the side out of view. inline/block:'nearest' makes this a no-op wherever it isn't
 // needed (desktop's wrapping nav, or a tab that's already fully visible).
 $$('#nav .navBtn').forEach(b=>{
  const on=b.dataset.view===v;
  b.classList.toggle('active',on);
  if(on&&typeof b.scrollIntoView==='function')b.scrollIntoView({inline:'nearest',block:'nearest'});
 });
 $$('main > section').forEach(s=>s.classList.toggle('hidden',s.dataset.sec!==v));
 refresh();
 if(v==='viz'){graphChips();if(!graphCenter)renderGraph({type:'creator',key:'Christopher Nolan'},true);else renderGraph(graphCenter,true);(window.requestAnimationFrame||setTimeout)(()=>{['bubble','radar','decade'].forEach(k=>{if(CH[k])CH[k].resize();});if(graphCenter)renderGraph(graphCenter,true);});setTimeout(function(){['bubble','radar','decade'].forEach(k=>{if(CH[k])CH[k].resize();});if(graphCenter&&state.view==='viz')renderGraph(graphCenter,true);},260);}
 if(v==='portrait')renderPortrait();
 if(v==='timeline')renderTimeline();
}
on('#nav','click',e=>{const b=e.target.closest('.navBtn');if(b)switchView(b.dataset.view);});
// Clicking a card's title used to only flip a quick-summary face; clicking the rest of the head
// used to only toggle the full stats breakdown -- two separate panels, only ever one visible at a
// time, depending on exactly where you clicked. Unified per explicit feedback: either click now
// opens (or closes) both the quick summary AND the full breakdown together, as one expanded unit.
function setCardExpanded(card,open){
 const sf=card&&card.querySelector('.summaryFace'),dd=card&&card.querySelector('.detail');
 if(sf)sf.classList.toggle('hidden',!open);
 if(dd)dd.classList.toggle('hidden',!open);
}
function toggleCardExpanded(card){
 const sf=card&&card.querySelector('.summaryFace');
 setCardExpanded(card,!!(sf&&sf.classList.contains('hidden')));
}
on('#grid','click',e=>{const pc=e.target.closest('.pairingChip');if(pc){e.stopPropagation();const px=byId.get(pc.dataset.flipJump);if(px){state.q=px.title;const qinput=$('#q');if(qinput)qinput.value=px.title;refresh();}return;}const pe=e.target.closest('.profEditBtn');if(pe){e.stopPropagation();handleProfileEditClick(pe);return;}const w=e.target.closest('.wlBtn');if(w){e.stopPropagation();wlToggle(w.dataset.wl);const has=wlHas(w.dataset.wl);w.textContent=has?'\u2665':'\u2661';w.style.color=has?'#fb7185':'#475569';w.setAttribute('aria-label',has?'Remove from watchlist':'Add to watchlist');updateWlNav();if(state.view==='watchlist')renderWatchlist();return;}const fb=e.target.closest('.flipBack');if(fb){e.stopPropagation();const card=fb.closest('.panel');if(card)setCardExpanded(card,false);return;}const h=e.target.closest('.cardHead');if(!h)return;const card=h.closest('.panel');if(card)toggleCardExpanded(card);});
let qT=null;
on('#q','input',e=>{clearTimeout(qT);qT=setTimeout(()=>{state.q=e.target.value;refresh();},120);});
on('#typeSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.type=b.dataset.type;$$('#typeSeg button').forEach(x=>x.classList.toggle('on',x===b));refresh();});
on('#structSel','change',e=>{state.struct=e.target.value;refresh();});
on('#sortSel','change',e=>{state.sort=e.target.value;syncBlendPanel();refresh();});
on('#limitSel','change',e=>{state.limit=+e.target.value;refresh();});
/* ===== Surprise Me spin engine ===== */
var spinScope={medium:'any',pool:'all'};
var MOOD_DIMS={cosmic:['ch','scary','dread'],comfort:['cozy'],mind:['reality','myst'],epic:['awe'],cry:['emo'],fun:['funny'],scary:['scary'],any:null};
function spinCandidates(){
 // Start from the active-filtered set so the spin respects the controller's filters.
 var pool=filtered();
 if(spinScope.medium!=='any')pool=pool.filter(x=>x.kind===spinScope.medium);
 if(spinScope.pool==='owned')pool=pool.filter(x=>x.owned);
 else if(spinScope.pool==='discover')pool=pool.filter(x=>!x.owned);
 var timeMax=$('#spinTime')?parseInt($('#spinTime').value,10)||0:0;
 if(timeMax>0)pool=pool.filter(x=>x.kind!=='movie'||!x.mins||x.mins<=timeMax);
 var mood=$('#spinMood')?$('#spinMood').value:'any';
 var dims=MOOD_DIMS[mood];
 // weight = gm (taste match), amplified by mood dimensions when a mood is chosen.
 return pool.map(function(x){
  var w=Math.max(1,x.gm);
  if(dims){var mv=Math.max.apply(null,dims.map(function(d){return x[d]||0}));w=w*0.4+mv*1.1;if(mv<55)w*=0.25;}
  return {x:x,w:w};
 }).filter(function(o){return o.w>0});
}
function weightedPick(cands){
 var total=cands.reduce(function(s,o){return s+o.w},0);if(total<=0)return null;
 var r=Math.random()*total;for(var i=0;i<cands.length;i++){r-=cands[i].w;if(r<=0)return cands[i].x;}
 return cands[cands.length-1].x;
}
function renderSpinResult(it,cands){
 var k=KM[it.kind];var f=suggestedFormat(it);
 var badge=it.owned?'<span class="text-[10px] px-1.5 py-0.5 rounded" style="background:#14532d;color:#4ade80">\u2713 OWNED'+(it.physFormat?' \u00b7 '+esc(it.physFormat):'')+'</span>':'<span class="text-[10px] px-1.5 py-0.5 rounded" style="background:#3b0764;color:#e879f9">DISCOVER</span>';
 var whyR=whyRecommended(it);
 var el=$('#surprisePanel');
 el.classList.remove('hidden');el.dataset.mode='spin';
 el.innerHTML='<div class="panel p-5" style="border-color:'+k.c+'66;box-shadow:0 0 40px '+k.c+'22">'
  +'<div class="flex items-center justify-between gap-2 mb-2"><span class="lbl" style="color:#e879f9">\uD83C\uDFB2 Your pick</span>'
  +'<button type="button" id="spinAgain" class="text-[10px] px-2.5 py-1 rounded border border-fuchsia-500/50 text-fuchsia-300 hover:bg-fuchsia-500/10">\u21bb Spin again</button></div>'
  +'<div class="flex items-start gap-3 flex-wrap">'
  +'<div class="flex-1 min-w-0">'
  +'<div class="flex items-center gap-2 flex-wrap"><span class="lbl" style="color:'+k.c+'">'+k.label+'</span>'+badge+'</div>'
  +'<h3 class="text-xl font-extrabold text-slate-50 mt-1 leading-tight">'+esc(it.title)+' <span class="text-slate-500 text-sm font-normal">'+it.year+'</span></h3>'
  +'<p class="text-[12px] text-slate-400 mt-0.5">'+esc(it.creator||'')+(it.genres&&it.genres.length?' \u00b7 '+esc(it.genres.slice(0,3).join(', ')):'')+'</p>'
  +'<p class="text-[12.5px] text-slate-300 italic mt-2 leading-relaxed">\u201c'+esc(it.just||'')+'\u201d</p>'
  +(whyR?'<p class="text-[11px] mt-2" style="color:#7dd3fc">\u21b3 '+whyR+'</p>':'')
  +(f?'<p class="text-[11px] mt-1" style="color:#fbbf24">\u25c8 Best edition: <b>'+esc(f.fmt)+'</b> \u2014 '+f.why+'</p>':'')
  +'</div>'
  +'<div class="flex flex-col items-center gap-1 shrink-0">'
  +'<div class="relative w-16 h-16 rounded-full grid place-items-center" style="background:conic-gradient('+k.c+' '+(it.gm*3.6)+'deg,#1e293b 0)"><div class="w-12 h-12 rounded-full bg-[#0F1626] grid place-items-center"><span class="text-lg font-extrabold" style="color:'+k.c+'">'+it.gm+'</span></div></div>'
  +'<span class="text-[9px] text-slate-500">TASTE MATCH</span>'
  +'</div>'
  +'</div>'
  +'<p class="text-[10px] text-slate-500 mt-3">Picked from '+cands.length+' works in your current scope, weighted toward your taste.</p>'
  +'</div>';
 // wire spin again
 var sa=$('#spinAgain');if(sa)sa.onclick=doSpin;
 if(el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function doSpin(){
 var cands=spinCandidates();
 var panel=$('#surprisePanel');panel.dataset.mode='spin';
 if(!cands.length){panel.classList.remove('hidden');panel.innerHTML='<div class="panel p-4 text-center text-slate-400 text-sm">No works match this scope \u2014 loosen a filter and spin again.</div>';return;}
 // brief spin animation cycling titles, then settle
 panel.classList.remove('hidden');
 var frames=10,i=0;
 var timer=setInterval(function(){
  var r=cands[Math.floor(Math.random()*cands.length)].x;
  panel.innerHTML='<div class="panel p-5 text-center"><span class="lbl" style="color:#e879f9">\uD83C\uDFB2 Spinning\u2026</span><h3 class="text-lg font-bold text-slate-300 mt-2">'+esc(r.title)+'</h3></div>';
  i++;
  if(i>=frames){clearInterval(timer);renderSpinResult(weightedPick(cands),cands);}
 },70);
}
on('#densityBtn','click',()=>{var on=document.body.classList.toggle('compact');var b=$('#densityBtn');b.textContent=on?'\u25a4 Comfortable':'\u25a6 Compact';b.classList.toggle('border-teal-500',on);b.classList.toggle('text-teal-300',on);try{localStorage.setItem('omniLedgerDensity',on?'1':'0');}catch(e){}});
(function initDensity(){var v='0';try{v=localStorage.getItem('omniLedgerDensity')||'0';}catch(e){}if(v==='1'){document.body.classList.add('compact');var b=$('#densityBtn');if(b){b.textContent='\u25a4 Comfortable';b.classList.add('border-teal-500','text-teal-300');}}})();

/* ===== Quick Tips: a small "?" button next to the theme selector, opening a popup on demand =====
   Not tied to onboarding -- someone can finish onboarding and still not know cards expand, or
   that the row under each card can tier/own without opening it. Deliberately not a banner or a nav
   tab (both compete for space/attention on every visit) -- just one quiet, always-in-the-same-place
   button that's there when wanted and invisible otherwise. */
(function initQuickTips(){
 var gate=$('#tipsGate');if(!gate)return;
 on('#tipsBtn','click',function(){gate.classList.remove('hidden');});
 on('#tipsClose','click',function(){gate.classList.add('hidden');});
})();
on('#surpriseBtn','click',()=>{const sc=$('#surpriseScope');sc.classList.toggle('hidden');var opening=!sc.classList.contains('hidden');var panel=$('#surprisePanel');
 if(opening){if(panel.dataset.mode==='rabbit'){panel.classList.add('hidden');panel.innerHTML='';panel.dataset.mode='';$('#rabbitBtn').setAttribute('aria-expanded','false');}if(sc.scrollIntoView)sc.scrollIntoView({behavior:'smooth',block:'nearest'});}
 else if(panel.dataset.mode==='spin'){/* closing Surprise Me clears its result too */panel.classList.add('hidden');panel.innerHTML='';panel.dataset.mode='';}
 $('#surpriseBtn').setAttribute('aria-expanded',opening?'true':'false');});
on('#spinMedium','click',e=>{const b=e.target.closest('button');if(!b)return;spinScope.medium=b.dataset.m;$$('#spinMedium button').forEach(x=>x.classList.toggle('on',x===b));});
on('#spinPool','click',e=>{const b=e.target.closest('button');if(!b)return;spinScope.pool=b.dataset.p;$$('#spinPool button').forEach(x=>x.classList.toggle('on',x===b));});
on('#spinGo','click',doSpin);
on('#rabbitBtn','click',()=>{var panel=$('#surprisePanel');var sc=$('#surpriseScope');if(sc)sc.classList.add('hidden');var showing=!panel.classList.contains('hidden')&&panel.dataset.mode==='rabbit';if(showing){panel.classList.add('hidden');panel.innerHTML='';panel.dataset.mode='';$('#rabbitBtn').setAttribute('aria-expanded','false');return;}var pool=filtered();if(!pool.length)pool=ALL;var top=pool.slice().sort((a,b)=>b.gm-a.gm).slice(0,20);var seed=top[Math.floor(Math.random()*top.length)];renderRabbitHole(seed.id);$('#rabbitBtn').setAttribute('aria-expanded','true');});

on('#minGoat','input',e=>{state.minGoat=+e.target.value;$('#minGoatV').textContent=e.target.value;refresh();});
// Live match-count preview: a small floating bubble that tracks the thumb of whichever threshold
// slider you're dragging (mouse or keyboard), showing how many works match right now -- so you can
// feel where a threshold matters without looking away to the result count under the search bar.
// One shared bubble/listener for every such slider rather than one per slider: `input` events
// bubble, and by the time this document-level (bubble-phase, not capture) listener runs, the
// slider's own listener above has already updated `state` and called refresh() -- so filtered()
// here reflects the change this exact keystroke/drag just made.
(function initSliderCountBubble(){
 var bubble=document.createElement('div');
 bubble.id='sliderCountBubble';
 bubble.style.cssText='position:fixed;z-index:1200;pointer-events:none;left:0;top:0;transform:translate(-50%,-135%);background:#0f1626;border:1px solid #334155;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:#5eead4;box-shadow:0 4px 14px rgba(0,0,0,.45);white-space:nowrap;display:none;opacity:0;transition:opacity .12s ease';
 document.body.appendChild(bubble);
 var hideT=null;
 function isLiveSlider(t){return !!(t&&t.tagName==='INPUT'&&t.type==='range'&&(t.classList.contains('idxSlider')||t.id==='minGoat'));}
 document.addEventListener('input',function(e){
  var t=e.target;if(!isLiveSlider(t))return;
  var r=t.getBoundingClientRect();
  var min=+t.min||0,max=+t.max||100,val=+t.value;
  var frac=max>min?(val-min)/(max-min):0;
  bubble.style.left=Math.round(r.left+frac*r.width)+'px';
  bubble.style.top=Math.round(r.top)+'px';
  var n=filtered().length;
  bubble.textContent=n.toLocaleString()+' work'+(n===1?'':'s')+' match';
  bubble.style.display='block';bubble.style.opacity='1';
  clearTimeout(hideT);
  hideT=setTimeout(function(){bubble.style.opacity='0';hideT=setTimeout(function(){bubble.style.display='none';},150);},1000);
 });
})();
on('#resetBtn','click',()=>{state.sort='overall';$('#sortSel').value='overall';clearAllFilters();});
function syncBlendPanel(){var on=state.sort==='blend';var pnl=$('#blendPanel');if(pnl)pnl.classList.toggle('hidden',!on);
 var vt=$('#wTechV'),vd=$('#wDreadV'),vm=$('#wMystV');
 if(vt)vt.textContent=state.w.tech.toFixed(2);if(vd)vd.textContent=state.w.dread.toFixed(2);if(vm)vm.textContent=state.w.myst.toFixed(2);}
[['wTech','tech'],['wDread','dread'],['wMyst','myst']].forEach(p=>{
 var el=$('#'+p[0]);if(el)el.addEventListener('input',e=>{state.w[p[1]]=+e.target.value/100;var lbl=$('#'+p[0]+'V');if(lbl)lbl.textContent=state.w[p[1]].toFixed(2);refresh();});});
on('#presetRow','click',e=>{const b=e.target.closest('[data-preset]');if(!b)return;
 const p=PRESETS[b.dataset.preset];state.w={tech:p.tech,dread:p.dread,myst:p.myst};
 $('#wTech').value=Math.round(p.tech*100);$('#wDread').value=Math.round(p.dread*100);$('#wMyst').value=Math.round(p.myst*100);
 syncBlendPanel();refresh();});
// Radar searchable comboboxes (this now also governs #platCombo -- it used to be excluded here and
// run its own separate, differently-scoped "click outside" listener below, which is exactly the
// kind of two-systems-doing-the-same-job setup that produces "sometimes won't close" bugs. One
// registry (closeAllCombos), one outside-click listener, one Escape-key fallback, for every combo.
function closeAllCombos(except){$$('.radarCombo').forEach(function(c){if(c!==except){c.classList.remove('open');var pop=c.querySelector('.rcPop');if(pop)pop.classList.add('hidden');}});}
// Opening a combo focuses its search input, which can trigger the browser's own scroll-into-view
// (a field near the viewport edge, or the 30ms-delayed focus() below) -- that scroll fires AFTER
// open() already ran, and without this guard the close-on-scroll handler further down would close
// the combo immediately after it opens. Ignore scroll events in the brief window right after opening.
var lastComboOpenAt=0;
$$('.radarCombo:not(#platCombo):not(#acctMenu)').forEach(function(combo){
 var field=combo.querySelector('.rcField'),pop=combo.querySelector('.rcPop'),search=combo.querySelector('.rcSearch');
 function open(){closeAllCombos(combo);combo.classList.add('open');pop.classList.remove('hidden');lastComboOpenAt=Date.now();renderRadarList(combo,'');search.value='';setTimeout(function(){search.focus();},30);}
 function close(){combo.classList.remove('open');pop.classList.add('hidden');}
 field.addEventListener('click',function(e){e.stopPropagation();combo.classList.contains('open')?close():open();});
 field.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
 search.addEventListener('input',function(){renderRadarList(combo,this.value);});
 search.addEventListener('keydown',function(e){if(e.key==='Escape'){close();field.focus();}else if(e.key==='Enter'){var first=combo.querySelector('.rcOpt');if(first){setRadarSlot(combo.dataset.slot,first.dataset.v);close();}}});
 combo.querySelector('.rcList').addEventListener('click',function(e){var opt=e.target.closest('.rcOpt');if(!opt)return;setRadarSlot(combo.dataset.slot,opt.dataset.v);close();});
});
document.addEventListener('click',function(e){if(!e.target.closest('.radarCombo'))closeAllCombos(null);});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeAllCombos(null);});
// An open combo's popup tracks its field correctly while the page scrolls (it's absolutely
// positioned in normal flow), but that just means it keeps following the field and covering
// whatever content ends up underneath as you scroll past it. Close on scroll instead -- capture
// phase so this also fires for scrolling inside any nested scrollable container, not just window.
// Except the combo's own option list (.rcList) itself: it has its own internal scrollbar for long
// lists, and closing on every scroll tick inside it would make it impossible to ever scroll down
// to an option below the fold.
window.addEventListener('scroll',function(e){
 if(e.target&&e.target.closest&&e.target.closest('.rcList'))return;
 if(Date.now()-lastComboOpenAt<300)return;
 closeAllCombos(null);
},true);
// Bubble field medium filter
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.bubbleMedBtn');if(!b)return;bubbleMed=b.dataset.bm;$$('.bubbleMedBtn').forEach(function(x){x.classList.toggle('on',x===b);});if(typeof renderBubble==='function')renderBubble();});
on('#bubbleMin','input',e=>{bubbleMinScore=+e.target.value;const lbl=$('#bubbleMinLbl');if(lbl)lbl.textContent=bubbleMinScore>0?bubbleMinScore+'+':'Any';renderBubble();scheduleURLSync();});
// Relationship graph: node + chip clicks
document.addEventListener('click',function(e){
 var node=e.target.closest&&e.target.closest('.gnode');
 if(node){renderGraph({type:node.dataset.gtype,key:node.dataset.gkey});return;}
 var chip=e.target.closest&&e.target.closest('.graphChip');
 if(chip){renderGraph({type:chip.dataset.gtype,key:chip.dataset.gkey});return;}
 var crumb=e.target.closest&&e.target.closest('.graphCrumb');
 if(crumb){var i=+crumb.dataset.i;var target=graphTrail[i];if(target){graphTrail=graphTrail.slice(0,i);renderGraph(target,true);}return;}
 var back=e.target.closest&&e.target.closest('#graphBack');
 if(back){if(graphTrail.length){var prev=graphTrail[graphTrail.length-1];graphTrail=graphTrail.slice(0,-1);renderGraph(prev,true);}return;}
 var home=e.target.closest&&e.target.closest('#graphHome');
 if(home){if(graphTrail.length){var first=graphTrail[0];graphTrail=[];renderGraph(first,true);}return;}
});
// Graph search: resolve a creator name or work title and center on it
(function(){var gs=$('#graphSearch');if(gs)gs.addEventListener('input',function(){var v=this.value.trim().toLowerCase();if(v.length<2)return;
 var cr=null;[directorsPantheon,gamingAuteurs,(typeof authorsPantheon!=='undefined'?authorsPantheon:[])].forEach(function(arr){arr.forEach(function(c){if(!cr&&c.name.toLowerCase().indexOf(v)>=0)cr=c.name;});});
 if(!cr){var byC={};ALL.forEach(function(x){if(x.creator&&x.creator.toLowerCase().indexOf(v)>=0)byC[x.creator]=(byC[x.creator]||0)+1;});var best=Object.keys(byC).sort(function(a,b){return byC[b]-byC[a];})[0];if(best)cr=best;}
 var work=ALL.find(function(x){return x.title.toLowerCase().indexOf(v)>=0;});
 // prefer exact-ish creator match if the query looks like a name; else prefer title
 if(cr&&(!work||v.split(' ').length>=2))renderGraph({type:'creator',key:cr});
 else if(work)renderGraph({type:'work',key:work.id});
 else if(cr)renderGraph({type:'creator',key:cr});
});})();
on('#creatorSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.creatorTab=b.dataset.tab;state.creatorSearch='';var cs=$('#creatorSearch');if(cs)cs.value='';renderCreators();});
on('#creatorSearch','input',e=>{state.creatorSearch=e.target.value;renderCreators();});
on('#creatorSearchScope','click',e=>{const b=e.target.closest('button');if(!b)return;state.creatorSearchScope=b.dataset.scope;$$('#creatorSearchScope button').forEach(x=>x.classList.toggle('on',x===b));renderCreators();scheduleURLSync();});
on('#creatorSortSel','change',e=>{state.creatorSort=e.target.value;renderCreators();scheduleURLSync();});
on('#creatorGrid','click',e=>{if(e.target.closest('.goatJump'))return;const f=e.target.closest('.flip');if(f)f.classList.toggle('flipped');});
on('#collSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.collSeg=b.dataset.cs;$$('#collSeg button').forEach(x=>x.classList.toggle('on',x===b));renderCollection();if(state.collGroup==='series')renderCollectionSeries();if(state.collShelf)renderCollectionShelf();if(state.collUpgrade)renderUpgradeAudit();});
let collSearchT=null;
on('#collSearch','input',e=>{clearTimeout(collSearchT);const v=e.target.value;collSearchT=setTimeout(()=>{state.collSearchQ=v;renderCollection();if(state.collGroup==='series')renderCollectionSeries();if(state.collShelf)renderCollectionShelf();scheduleURLSync();},120);});
on('#seriesToggle','click',()=>{state.collGroup=state.collGroup==='series'?'format':'series';const on=state.collGroup==='series';const btn=$('#seriesToggle');btn.classList.toggle('border-cyan-500',on);btn.classList.toggle('text-cyan-300',on);btn.classList.toggle('bg-cyan-500/10',on);btn.textContent=on?'▤ Grouped by Series':'▤ Group by Series';$('#collSeries').classList.toggle('hidden',!on);if(on){state.collShelf=false;state.collUpgrade=false;$('#collShelf').classList.add('hidden');$('#collUpgrade').classList.add('hidden');var sb=$('#shelfToggle');sb.textContent='📚 Shelf View';sb.classList.remove('border-amber-500','text-amber-300','bg-amber-500/10');var ub=$('#upgradeToggle');ub.textContent='⬆ Upgrade Audit';ub.classList.remove('border-sky-500','text-sky-300','bg-sky-500/10');}$('#collFormats').classList.toggle('hidden',on||state.collShelf);if(on)renderCollectionSeries();});
on('#shelfToggle','click',()=>{state.collShelf=!state.collShelf;const on=state.collShelf;const btn=$('#shelfToggle');btn.classList.toggle('border-amber-500',on);btn.classList.toggle('text-amber-300',on);btn.classList.toggle('bg-amber-500/10',on);btn.textContent=on?'📚 Shelf View ✓':'📚 Shelf View';$('#collShelf').classList.toggle('hidden',!on);if(on){state.collGroup='format';$('#collSeries').classList.add('hidden');var gb=$('#seriesToggle');gb.textContent='▤ Group by Series';gb.classList.remove('border-cyan-500','text-cyan-300','bg-cyan-500/10');}if(on){state.collUpgrade=false;$('#collUpgrade').classList.add('hidden');var ub=$('#upgradeToggle');ub.textContent='⬆ Upgrade Audit';ub.classList.remove('border-sky-500','text-sky-300','bg-sky-500/10');}$('#collFormats').classList.toggle('hidden',on||state.collGroup==='series'||state.collUpgrade);if(on)renderCollectionShelf();});
on('#upgradeToggle','click',()=>{state.collUpgrade=!state.collUpgrade;const on=state.collUpgrade;const btn=$('#upgradeToggle');btn.classList.toggle('border-sky-500',on);btn.classList.toggle('text-sky-300',on);btn.classList.toggle('bg-sky-500/10',on);btn.textContent=on?'⬆ Upgrade Audit ✓':'⬆ Upgrade Audit';$('#collUpgrade').classList.toggle('hidden',!on);if(on){state.collGroup='format';state.collShelf=false;$('#collSeries').classList.add('hidden');$('#collShelf').classList.add('hidden');var gb=$('#seriesToggle');gb.textContent='▤ Group by Series';gb.classList.remove('border-cyan-500','text-cyan-300','bg-cyan-500/10');var sb=$('#shelfToggle');sb.textContent='📚 Shelf View';sb.classList.remove('border-amber-500','text-amber-300','bg-amber-500/10');}$('#collFormats').classList.toggle('hidden',on||state.collGroup==='series'||state.collShelf);if(on)renderUpgradeAudit();});
on('#exportBtn','click',()=>{try{const owned=ALL.filter(x=>x.owned).map(x=>({id:x.id,title:x.title,kind:x.kind,format:x.physFormat}));const wl=(typeof WL!=='undefined')?Object.keys(WL):[];const wlItems=wl.map(id=>{const x=byId.get(id);return x?{id:id,title:x.title,kind:x.kind}:{id:id};});const data={exported:new Date().toISOString(),app:'Omni-Media Ledger',totals:{works:ALL.length,owned:owned.length,watchlist:wl.length},watchlist:wlItems,ownedCollection:owned};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='omni-ledger-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),1000);const btn=$('#exportBtn');const t=btn.textContent;btn.textContent='✓ Downloaded';setTimeout(()=>{btn.textContent=t;},1800);}catch(err){const btn=$('#exportBtn');btn.textContent='Export failed';setTimeout(()=>{btn.textContent='⬇ Export / Backup';},1800);}});
on('#familyLens','click',e=>{var b=e.target.closest('.familyTile');if(b)focusFamily(b.dataset.fam);});
on('#gapSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.gapFilter=b.dataset.gap;$$('#gapSeg button').forEach(x=>x.classList.toggle('on',x===b));renderPortraitGaps();});
on('#portraitScopeSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.portraitScope=b.dataset.ps;$$('#portraitScopeSeg button').forEach(x=>x.classList.toggle('on',x===b));renderPortrait();scheduleURLSync();});
on('#tlScope','click',e=>{const b=e.target.closest('button');if(!b)return;tlScope=b.dataset.t;$$('#tlScope button').forEach(x=>x.classList.toggle('on',x===b));renderTimeline();});
on('#tlMedium','click',e=>{const b=e.target.closest('button');if(!b)return;tlMedium=b.dataset.tm;$$('#tlMedium button').forEach(x=>x.classList.toggle('on',x===b));renderTimeline();scheduleURLSync();});
on('#tlChart','click',e=>{
 const z=e.target.closest('.tlZoomBtn');
 if(z){e.stopPropagation();const g2=z.closest('.tlBar');if(g2){const ym=+g2.dataset.ymin;tlZoomDecade=(tlZoomDecade===ym)?null:ym;renderTimeline();var zb=$('#tlDecadeZoom');if(zb&&tlZoomDecade!=null)zb.scrollIntoView({behavior:'smooth',block:'nearest'});}return;}
 const g=e.target.closest('.tlBar');if(!g)return;
 const ymin=+g.dataset.ymin,ymax=+g.dataset.ymax,kind=g.dataset.kind;
 state.yearMin=ymin<=-9999?null:ymin;state.yearMax=ymax-1;
 const yminEl=$('#yearMin'),ymaxEl=$('#yearMax');if(yminEl)yminEl.value=state.yearMin!=null?state.yearMin:'';if(ymaxEl)ymaxEl.value=state.yearMax;
 if(kind){state.type=kind;$$('#typeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.type===kind));}
 state.q='';const qi=$('#q');if(qi)qi.value='';
 const ap=$('#advPanel');if(ap&&ap.classList.contains('hidden')){ap.classList.remove('hidden');const caret=$('#advCaret');if(caret)caret.style.transform='rotate(90deg)';}
 syncAdvCount();switchView('controller');window.scrollTo({top:0,behavior:'smooth'});
});
on('#tlDecadeZoom','click',e=>{if(e.target.closest('#tlZoomClose')){tlZoomDecade=null;renderTimeline();}});
on('#tlEras','click',e=>{var b=e.target.closest('.eraMore');if(b){var box=$('#'+b.dataset.era);if(box){var open=!box.classList.contains('hidden');box.classList.toggle('hidden');b.textContent=open?'\u2295 Show all '+(parseInt(b.dataset.n)+8):'\u2296 Show less';}return;}var t=e.target.closest('.cardTitle');if(t&&t.dataset.flip){var it=byId.get(t.dataset.flip);if(it){state.q=it.title;var qinput=$('#q');if(qinput)qinput.value=it.title;switchView('controller');refresh();}}});
/* ===== Theme system ===== */
function applyTheme(t){
 if(t){document.body.setAttribute('data-theme',t);}else{document.body.removeAttribute('data-theme');}
 try{localStorage.setItem('omniLedgerTheme',t||'');}catch(e){}
 var sel=$('#themeSel');if(sel&&sel.value!==(t||''))sel.value=t||'';
}
(function initTheme(){
 var saved='';try{saved=localStorage.getItem('omniLedgerTheme')||'';}catch(e){}
 applyTheme(saved);
})();
on('#themeSel','change',e=>{applyTheme(e.target.value);});

/* ===== Personal profile: export / import / reset (Phase 2 of the sharing roadmap) =====
   Everything the taste engine reads lives on PERSONAL_PROFILE (see the PERSONAL PROFILE comment
   near the top of this script). This is the swap point for a new person: Export hands you that
   object (plus the watchlist, theme, and density prefs, so one file is a complete snapshot of a
   person, not just their taste weights) as JSON, Import overwrites it from a file and reloads,
   Reset writes an empty object and reloads. Once a profile has been saved this way, the hardcoded
   defaults baked into this specific copy of the file never re-apply -- see PROFILE_FROM_STORAGE
   above. Import accepts both this snapshot shape ({profile, watchlist, theme, density}) and a
   bare profile object with no wrapper (what PROFILE_TEMPLATE.md documents, and what every export
   before this feature produced) -- detected by whether the parsed JSON has a `profile` key. */
function applyImportedSnapshot(parsed){
 const isSnapshot=parsed&&typeof parsed.profile==='object'&&parsed.profile!==null&&!Array.isArray(parsed.profile);
 const profile=isSnapshot?parsed.profile:parsed;
 localStorage.setItem('omniLedgerProfile',JSON.stringify(profile));
 if(isSnapshot){
  if(parsed.watchlist&&typeof parsed.watchlist==='object'&&!Array.isArray(parsed.watchlist))localStorage.setItem('omniLedgerWatchlist',JSON.stringify(parsed.watchlist));
  if(typeof parsed.theme==='string')localStorage.setItem('omniLedgerTheme',parsed.theme);
  if(typeof parsed.density==='string')localStorage.setItem('omniLedgerDensity',parsed.density);
 }
}
on('#profileExportBtn','click',()=>{try{
 let watchlist={};try{watchlist=JSON.parse(localStorage.getItem('omniLedgerWatchlist')||'{}')||{};}catch(e){}
 let theme='';try{theme=localStorage.getItem('omniLedgerTheme')||'';}catch(e){}
 let density='0';try{density=localStorage.getItem('omniLedgerDensity')||'0';}catch(e){}
 const snapshot={version:1,exported:new Date().toISOString(),profile:PERSONAL_PROFILE,watchlist:watchlist,theme:theme,density:density};
 const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='omni-ledger-profile.json';document.body.appendChild(a);a.click();document.body.removeChild(a);
}catch(e){alert('Export failed: '+e.message);}});
on('#profileImportInput','change',e=>{const file=e.target.files&&e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(typeof parsed!=='object'||parsed===null||Array.isArray(parsed))throw new Error('File is not a profile object');applyImportedSnapshot(parsed);reloadWithMediaSync(PERSONAL_PROFILE);}catch(err){alert('Could not import that file: '+err.message);}};reader.readAsText(file);e.target.value='';});
on('#profileResetBtn','click',()=>{if(typeof confirm!=='undefined'&&!confirm('Reset your profile to blank? This clears your owned collection, declared canon, taste weights and watchlist in this browser. Export first if you want to keep a copy.'))return;localStorage.setItem('omniLedgerProfile','{}');localStorage.setItem('omniLedgerWatchlist','{}');reloadWithMediaSync(PERSONAL_PROFILE);});

/* ===== Normalized gold/silver/bronze/owned sync (supabase/schema.sql media_status) =====
   Every reload site below writes a new omniLedgerProfile to localStorage and then reloads the
   page for the scoring pipeline to recompute from -- this diffs the profile just written against
   the one still live in memory (PERSONAL_PROFILE, not yet overwritten since the write goes
   straight to localStorage) and turns the change into a handful of media_status upserts/deletes,
   so the exact gold/silver/bronze/owned status driving recommendations locally is also queryable
   per title in the DB, not just locked inside the profiles.data jsonb blob. */
function computeMediaStatusMap(p){
 var m={};
 function ensure(id){return m[id]||(m[id]={tier:null,owned:false});}
 (p.declaredGoatIds||[]).forEach(function(id){ensure(id).tier='gold';});
 (p.silverTierIds||[]).forEach(function(id){var e=ensure(id);if(!e.tier)e.tier='silver';});
 (p.bronzeTierIds||[]).forEach(function(id){var e=ensure(id);if(!e.tier)e.tier='bronze';});
 Object.keys(p.ownedMedia||{}).forEach(function(id){ensure(id).owned=true;});
 (p.ownedGameIds||[]).forEach(function(id){ensure(id).owned=true;});
 Object.keys(p.ownedBooksExtra||{}).forEach(function(id){ensure(id).owned=true;});
 return m;
}
function diffMediaStatus(oldProfile,newProfile){
 var before=computeMediaStatusMap(oldProfile||{}),after=computeMediaStatusMap(newProfile||{});
 var ids={};
 Object.keys(before).forEach(function(id){ids[id]=1;});
 Object.keys(after).forEach(function(id){ids[id]=1;});
 var rows=[];
 Object.keys(ids).forEach(function(id){
  var b=before[id]||{tier:null,owned:false},a=after[id]||{tier:null,owned:false};
  if(b.tier!==a.tier||b.owned!==a.owned)rows.push({id:id,tier:a.tier,owned:a.owned});
 });
 return rows;
}
// `oldProfile` is whatever the change should be diffed against -- PERSONAL_PROFILE for a normal
// edit to the user's own already-loaded profile, or {} for a first-run/onboarding write where
// PERSONAL_PROFILE on index.html still holds Payton's hardcoded sample data rather than this
// visitor's (still-blank) actual profile. Reads the freshly written omniLedgerProfile straight
// back out of localStorage rather than taking it as a parameter, so every reload site can call
// this the same way regardless of how it built its new profile.
function reloadWithMediaSync(oldProfile){
 var newProfile={};
 try{newProfile=JSON.parse(localStorage.getItem('omniLedgerProfile')||'{}');}catch(e){}
 var rows=diffMediaStatus(oldProfile,newProfile);
 if(typeof window.__omniReloadAfterSync==='function')window.__omniReloadAfterSync(rows);
 else location.reload();
}

/* ===== In-app profile editor: declare / own / boost from any card, no JSON editing required =====
   PERSONAL_PROFILE at this point in execution already holds the fully resolved current profile,
   whether that came from defaults or from localStorage -- so mutating a clone of it and saving
   that clone is correct either way, without needing to special-case PROFILE_FROM_STORAGE. This is
   the same write-then-reload pattern Import/Reset already use, chosen for the same reason: it
   guarantees the whole scoring pipeline recomputes correctly rather than trying to patch already-
   derived scores in place. */
function mutateProfileAndReload(mutatorFn){
 let snapshot;
 try{snapshot=JSON.parse(JSON.stringify(PERSONAL_PROFILE));}catch(e){alert('Could not read current profile: '+e.message);return;}
 try{mutatorFn(snapshot);}catch(e){alert('Could not apply that change: '+e.message);return;}
 try{localStorage.setItem('omniLedgerProfile',JSON.stringify(snapshot));localStorage.setItem('omniLedgerOnboarded','1');}catch(e){alert('Could not save: '+e.message);return;}
 // Tiering/owning something reloads the whole page (the scoring pipeline needs a full recompute,
 // not a patch) -- remember which tab was open so a click from, say, the GOAT Profile tab's search
 // results doesn't bounce back to Global Controller. Read on boot, see initRoutingAndBindings.
 try{sessionStorage.setItem('omniLedgerResumeView',state.view);}catch(e){}
 reloadWithMediaSync(PERSONAL_PROFILE);
}
function toggleDeclaredFavorite(id){
 mutateProfileAndReload(p=>{
  p.declaredGoatIds=p.declaredGoatIds||[];
  const i=p.declaredGoatIds.indexOf(id);
  if(i>=0)p.declaredGoatIds.splice(i,1);else p.declaredGoatIds.push(id);
 });
}
function toggleOwned(id,kind){
 mutateProfileAndReload(p=>{
  if(kind==='movie'||kind==='tv'){
   p.ownedMedia=p.ownedMedia||{};
   if(p.ownedMedia[id])delete p.ownedMedia[id];else p.ownedMedia[id]='Owned';
  }else if(kind==='book'){
   p.ownedBooksExtra=p.ownedBooksExtra||{};
   if(p.ownedBooksExtra[id])delete p.ownedBooksExtra[id];else p.ownedBooksExtra[id]='Owned';
  }else if(kind==='game'){
   p.ownedGameIds=p.ownedGameIds||[];
   const i=p.ownedGameIds.indexOf(id);
   if(i>=0)p.ownedGameIds.splice(i,1);else p.ownedGameIds.push(id);
  }
 });
}
// Nudges a creator's weight up OR down (delta can be negative -- "the opposite of boosting"):
// bounded to [-20,20], and an entry that lands back on exactly 0 is removed rather than kept
// around as a no-op weight, so a creator you've never touched shows no boost/bury state at all.
function bumpCreatorBoost(name,kind,delta){
 mutateProfileAndReload(p=>{
  const key=kind==='book'?'bookCreatorBoost':'creatorBoost';
  p[key]=p[key]||[];
  const existing=p[key].find(e=>e[0]===name);
  if(existing){
   existing[1]=Math.max(-20,Math.min(20,existing[1]+delta));
   if(existing[1]===0)p[key]=p[key].filter(e=>e!==existing);
  }else if(delta!==0){
   p[key].push([name,Math.max(-20,Math.min(20,delta))]);
  }
 });
}
function toggleGenreBoost(genre){
 mutateProfileAndReload(p=>{
  p.genreBoost=p.genreBoost||[];
  const key=genre.toLowerCase();
  const i=p.genreBoost.findIndex(g=>g[0]===key);
  if(i>=0)p.genreBoost.splice(i,1);else p.genreBoost.push([key,5]);
 });
}
function toggleVibeBoost(vibe){
 mutateProfileAndReload(p=>{
  p.vibeBoost=p.vibeBoost||{};
  if(p.vibeBoost[vibe])delete p.vibeBoost[vibe];else p.vibeBoost[vibe]=5;
 });
}
function toggleSilverTier(id){
 mutateProfileAndReload(p=>{
  p.silverTierIds=p.silverTierIds||[];
  const i=p.silverTierIds.indexOf(id);
  if(i>=0)p.silverTierIds.splice(i,1);else p.silverTierIds.push(id);
 });
}
function toggleBronzeTier(id){
 mutateProfileAndReload(p=>{
  p.bronzeTierIds=p.bronzeTierIds||[];
  const i=p.bronzeTierIds.indexOf(id);
  if(i>=0)p.bronzeTierIds.splice(i,1);else p.bronzeTierIds.push(id);
 });
}
// Hiding a recommendation: some picks are permanently uninteresting to you (a creator you're just
// not into, an approximate hand-curated guess that missed) and re-seeing them every visit is worse
// than useless -- it's a taste signal the recs panel ignores. Identity is per-category since the
// same title could plausibly appear in two different curated lists with two different "why"s.
function recKey(cat,it){return cat+'|'+(it.q||it.n);}
function hideRec(cat,key){
 mutateProfileAndReload(p=>{
  p.hiddenRecs=p.hiddenRecs||[];
  if(p.hiddenRecs.indexOf(key)<0)p.hiddenRecs.push(key);
 });
}
function unhideAllRecsInCat(cat){
 mutateProfileAndReload(p=>{
  p.hiddenRecs=(p.hiddenRecs||[]).filter(function(k){return k.indexOf(cat+'|')!==0;});
 });
}
// Drag-and-drop re-tiering (GOAT Profile's per-medium Gold/Silver/Bronze columns): moves `id`
// cleanly into exactly `targetTier`, removing it from whichever of the three lists it was already
// in first -- the same net effect as clicking the old tier button off and the new one on, done as
// one profile mutation/reload instead of two, so the GOAT match weight lands on the target tier's
// value directly rather than passing through "untiered" in between.
function moveToTier(id,targetTier){
 var x=byId.get(id);if(!x)return;
 var currentTier=x.goat?'gold':x.silver?'silver':x.bronze?'bronze':null;
 if(currentTier===targetTier)return;
 mutateProfileAndReload(function(p){
  p.declaredGoatIds=(p.declaredGoatIds||[]).filter(function(i){return i!==id;});
  p.silverTierIds=(p.silverTierIds||[]).filter(function(i){return i!==id;});
  p.bronzeTierIds=(p.bronzeTierIds||[]).filter(function(i){return i!==id;});
  if(targetTier==='gold')p.declaredGoatIds.push(id);
  else if(targetTier==='silver')p.silverTierIds.push(id);
  else if(targetTier==='bronze')p.bronzeTierIds.push(id);
 });
}
function boostBookAffinity(id){
 mutateProfileAndReload(p=>{
  p.bookAffinity=p.bookAffinity||{};
  const cur=p.bookAffinity[id]||0;
  p.bookAffinity[id]=Math.min(99,cur?cur+5:75);
 });
}
// Owned-format tracking: which physical edition you actually have. Movies/TV pick from
// DVD/Blu-ray/4K, books from Hardcover/Softcover -- stored on the same profile keys the adapter
// layer already reads (ownedMedia for movie/tv, ownedBooksExtra for book), so this doesn't need
// any new sync plumbing: it rides the existing profile jsonb blob to Supabase and every existing
// export/import. Clicking the already-active format clears it back to a bare "owned" (no edition
// declared yet) instead of being a no-op, so a mis-click is one click to undo.
const OWNED_FORMATS={movie:['DVD','Blu-ray','4K'],tv:['DVD','Blu-ray','4K'],book:['Hardcover','Softcover']};
// Shared per-format color so the same edition always reads the same way everywhere it shows up
// (Collection format groups, the per-item picker). DVD orange, Blu-ray blue, 4K near-black --
// picked to loosely evoke each format's real-world case color, not just an arbitrary palette slot.
// ac = accent: a variant used for text/bars against the app's own dark background, where the
// near-black 4K swatch itself would be invisible.
const FMT_STYLE={
 '4K':{bg:'#0a0a0c',fg:'#e2e8f0',bd:'#475569',ac:'#94a3b8'},
 'Blu-ray':{bg:'#2563eb',fg:'#eff6ff',bd:'#2563eb',ac:'#60a5fa'},
 'DVD':{bg:'#f97316',fg:'#1a0f00',bd:'#f97316',ac:'#fb923c'},
 'BD/DVD':{bg:'#7dd3fc',fg:'#04283a',bd:'#7dd3fc',ac:'#7dd3fc'},
 'Box Set':{bg:'#22d3ee',fg:'#032b30',bd:'#22d3ee',ac:'#22d3ee'},
 'Deluxe':{bg:'#c084fc',fg:'#1e0a33',bd:'#c084fc',ac:'#c084fc'},
 'Hardcover':{bg:'#86efac',fg:'#052e12',bd:'#86efac',ac:'#86efac'},
 'Softcover':{bg:'#a3e635',fg:'#1a2e05',bd:'#a3e635',ac:'#a3e635'},
 'Paperback':{bg:'#a3e635',fg:'#1a2e05',bd:'#a3e635',ac:'#a3e635'},
 'Games':{bg:'#fbbf24',fg:'#221600',bd:'#fbbf24',ac:'#fbbf24'}
};
function fmtStyle(f){return FMT_STYLE[f]||{bg:'#94a3b8',fg:'#0B0F19',bd:'#94a3b8',ac:'#94a3b8'};}
function setPhysFormat(id,kind,fmt){
 mutateProfileAndReload(p=>{
  if(kind==='movie'||kind==='tv'){
   p.ownedMedia=p.ownedMedia||{};
   p.ownedMedia[id]=(p.ownedMedia[id]===fmt)?'Owned':fmt;
  }else if(kind==='book'){
   p.ownedBooksExtra=p.ownedBooksExtra||{};
   p.ownedBooksExtra[id]=(p.ownedBooksExtra[id]===fmt)?'Owned':fmt;
  }
 });
}
function formatPickerHTML(x){
 const opts=OWNED_FORMATS[x.kind];if(!opts||!x.owned)return '';
 return '<div class="flex items-center flex-wrap gap-1 mt-1.5" title="Which edition you own">'
  +opts.map(function(f){const active=x.physFormat===f;const fs=fmtStyle(f);
   return '<button type="button" class="profEditBtn" data-act="setformat" data-id="'+x.id+'" data-kind="'+x.kind+'" data-fmt="'+esc(f)+'" style="font-size:9.5px;padding:2px 7px;border-radius:9999px;border:1px solid '+(active?fs.bd:'var(--border-2,#334155)')+';background:'+(active?fs.bg:'transparent')+';color:'+(active?fs.fg:'#94a3b8')+'" title="'+(active?'You own this on '+f+' — click to clear':'Mark as owned on '+f+'')+'">'+(active?'✓ ':'')+f+'</button>';}).join('')
  +'</div>';
}
function handleProfileEditClick(btn){
 const act=btn.dataset.act;
 if(act==='declare')toggleDeclaredFavorite(btn.dataset.id);
 else if(act==='own')toggleOwned(btn.dataset.id,btn.dataset.kind);
 else if(act==='creatorbump')bumpCreatorBoost(btn.dataset.creator,btn.dataset.kind,parseInt(btn.dataset.delta,10)||0);
 else if(act==='genre')toggleGenreBoost(btn.dataset.genre);
 else if(act==='vibe')toggleVibeBoost(btn.dataset.vibe);
 else if(act==='silver')toggleSilverTier(btn.dataset.id);
 else if(act==='bronze')toggleBronzeTier(btn.dataset.id);
 else if(act==='bookaffinity')boostBookAffinity(btn.dataset.id);
 else if(act==='setformat')setPhysFormat(btn.dataset.id,btn.dataset.kind,btn.dataset.fmt);
}

/* ===== First-run onboarding gate (Phase 3 of the sharing roadmap) =====
   A browser that has never saved anything under omniLedgerOnboarded gets asked once, explicitly,
   rather than silently inheriting Payton's hardcoded sample profile -- this is what makes handing
   someone a copy of this file (or a link to it) actually land them somewhere they chose, whether
   that's this same browser's first visit or a friend's brand new one. The choice itself doesn't
   need to touch PERSONAL_PROFILE construction above: "sample" just marks onboarding done and
   leaves the already-computed defaults in place; "blank" and "import" write to omniLedgerProfile
   and reload so the whole app recomputes from the fresh profile, same as Reset/Import already do. */
/* ===== Version / changelog marker =====
   Lets a friend running an older copy of index.html tell they're behind just by comparing the
   number in the header -- there's no auto-update mechanism, so this is deliberately just a
   "here's what changed" readout, not a live version check against anything. Bump APP_VERSION and
   add a CHANGELOG entry whenever a change is worth a friend knowing about; cosmetic tweaks don't
   need a bump. */
const APP_VERSION='1.41.0';
const CHANGELOG=[
 {v:'1.41.0',date:'2026-09-03',summary:'Found and fixed the real cause of new accounts saving nothing: the app was uploading a near-empty snapshot that overwrote your actual picks, leaving a row containing only an empty theme.',notes:[
  'The bug, exactly: the theme system re-writes the saved theme with the value it just read on EVERY page load. On a brand-new account — where local data has just been cleared, so the theme is the only saved key that exists — that pointless write scheduled a cloud save whose entire contents were {"omniLedgerTheme":""}. That near-empty upload then raced the real save of your picks, and whichever finished last won. When the empty one won, the database row became literally {"omniLedgerTheme":""} — which is exactly what was showing up',
  'Fixed three ways so it cannot come back: re-writing a value that has not changed is no longer treated as an edit and schedules nothing; all profile saves now go through a single queue so two uploads are never in flight at once (the newest data always lands last); and a profile with nothing in it yet is never uploaded at all, so the empty placeholder row can no longer be created',
  'This is why it hit brand-new accounts hardest and left established ones mostly alone — the empty-theme-only state only exists in the moments right after an account is created',
  'Two new checks lock the behaviour in, plus an end-to-end one that creates a fresh cloud account, onboards, tiers a pick, waits for background syncing to settle, and asserts the database holds the real profile rather than a theme-only row'
 ]},
 {v:'1.40.0',date:'2026-09-03',summary:'Found why re-running the database script changed nothing — the script itself failed partway and rolled the whole thing back. Fixed that, made picks recoverable from a second copy in the database, and fixed Bronze/Gold/Silver not showing on the GOAT Profile for accounts started from scratch.',notes:[
  'The big one: supabase/schema.sql had a statement ordering bug — it granted permission on a suggestions column before that column was created. The Supabase SQL Editor runs a pasted script as ONE transaction, so that single error rolled back the ENTIRE file. Anyone who "re-ran schema.sql" to pick up a fix got none of it, with nothing obvious to show that had happened. Fixed and verified by running the whole file against a real PostgreSQL 16 twice from a clean database, with zero errors',
  'The profiles validation rule can no longer blank a profile: if filtering unknown keys would leave nothing at all, it now stores the payload as-is instead. Losing an unrecognised field beats losing somebody\'s entire account',
  'Your Gold/Silver/Bronze/Owned picks are saved to the database twice — once in the profile document and once as normal per-title rows (media_status). If the document is ever empty or damaged, the account now rebuilds itself from those rows instead of appearing brand new. That second copy is also the part that scales: it is a plain table, queryable per person and per title',
  'Fixed Bronze (and Gold/Silver) picks not appearing in the GOAT Profile on an account started from scratch. That section only rendered categories the sample profile happens to define, so on a blank profile a pick made from a card had nowhere to show up — it looked like it had not saved, even though it had',
  'Signing in now only wipes local data when a name genuinely has no account anywhere; a row that momentarily reads back empty can never clear what is on your device'
 ]},
 {v:'1.39.0',date:'2026-09-03',summary:'The app can now see when the database silently refuses a write — the specific failure that made picks vanish — and says exactly which database setting to fix. Switching accounts is no longer a dead end when that happens.',notes:[
  'Saves now ask the database to hand back the rows it actually wrote. This matters because of a real Postgres trap: for an upsert (INSERT … ON CONFLICT DO UPDATE), a row-level security UPDATE policy is applied as a FILTER, not a check — a row it excludes is skipped with NO error and a success response. A project whose INSERT policy works but whose UPDATE policy is missing or restrictive therefore saves a brand-new name once and then silently discards every later change to it, forever. Getting zero rows back is the only evidence, and the app now checks for it and names it',
  'The read-back check now retries once before complaining, so a single cached or lagging read is not mistaken for a refused write',
  'Switching accounts with unsaved changes is no longer blocked outright — it explains the real reason, defaults to staying put, recommends Export / Backup first, and lets you switch anyway if you choose to',
  'If you see "NOT saved to the cloud" in the account menu, NOTES.md → "If saving is refused" now has the exact SQL to run and two queries to confirm which policies and grants your project actually has'
 ]},
 {v:'1.38.0',date:'2026-09-03',summary:'Your picks can no longer be lost. A save that doesn\'t actually reach the server is now detected, kept safely on your device, clearly shown as unsaved, and retried — instead of being silently reverted the next time you refresh.',notes:[
  'Root cause of picks disappearing on refresh: the app treated "the save request came back without an error" as proof it saved — but that is not the same thing. If the server accepted the request without actually storing it (a validation rule rejecting the row, a project running an out-of-date copy of the schema, a request cut off in flight), the app believed it, and then the very next ordinary page load pulled the older cloud copy back down over the change. That is why tiering something looked fine, and refreshing wiped it',
  'Saves are now verified: after writing, the app reads the row straight back and compares it. A save only counts as done when the server hands the same profile back — otherwise it stays marked unsynced, with the real reason recorded',
  'Unsaved changes now always win over the cloud copy. While anything is unsynced, no page load (including a manual refresh, a reopened tab, or signing back in with the same name) is allowed to overwrite your local data — it keeps your picks and retries the save in the background instead, healing on its own once the connection or server is working',
  'The sync dot tells the truth now. It used to show green "Synced to the cloud" on every load regardless of whether anything had actually saved, which is a large part of why this went undiagnosed for so long. Unsaved changes now show red with the specific reason',
  'Schema hardening: the profiles validation rule used to reject the ENTIRE save if it saw any key it did not recognise — so a project running an older copy of schema.sql lost every save, permanently, rather than just the unknown key. It now drops unrecognised keys and stores the rest, and the app\'s own read-back check surfaces anything actually dropped as a visible error',
  'Recommended (not required): re-run supabase/schema.sql once in the Supabase SQL Editor to pick up that hardening. Even without it, your picks are now safe on your device and the app will tell you plainly if the server is refusing them'
 ]},
 {v:'1.37.0',date:'2026-09-03',summary:'Fixed the real reason typing an existing account name back in could look brand new: sign-in used a separate, unfixed 8-second timeout with no retry and a hidden error message. Plus a leftover-timer bug that could resurrect a just-deleted account, and a spacing fix for the GOAT Profile tier row.',notes:[
  'Root-cause fix: signing in (typing your handle at the account gate, or the app remembering it from before) fetches your saved data from the cloud -- that fetch was using its own hardcoded 8-second timeout, separate from (and never fixed alongside) the 15-second one the previous release fixed for saves. One slow read -- the exact same free-tier cold-start latency that\'s been the culprit all along -- meant an account with real, saved data would silently be treated as brand new, and the error explaining why used to be set and then hidden again in the very next line, so it was never actually visible',
  'Sign-in now retries automatically once on a failed read before giving up, and if it still can\'t reach the cloud, the account gate stays open with a real, visible explanation and a re-enabled Continue button to retry -- instead of silently treating an existing account as new',
  'Found and fixed a second, related bug while verifying the above: a leftover, already-cancelled sync timer\'s ID was never cleared to null, so a new safety check (flushing a pending change if the tab is closed or backgrounded before its normal 1.5s debounce fires, so a theme/watchlist/tips-dismissal change right before closing the tab isn\'t lost) could fire a stale, already-handled sync at the wrong moment -- including, in one case, re-creating a just-deleted account\'s row right after "Delete my account" removed it. Fixed at the root by actually nulling the timer everywhere it\'s cancelled, not just clearing it',
  'GOAT Profile\'s "Search & Build Your Favorites" tier row now has proper spacing above it (was pulled up too tight against the title/genre chips, especially with the previous release\'s larger roomy buttons)',
  'Testing: new regression tests for both root-cause fixes, each verified by deliberately disabling the fix and confirming the test correctly fails, then re-enabling and confirming it passes -- including catching and fixing a first version of the sign-in retry test that would have passed even with the fix disabled (it only checked that onboarding didn\'t show, which is also true when sign-in gets stuck failing) before it was corrected to check that data actually hydrated'
 ]},
 {v:'1.36.0',date:'2026-09-03',summary:'Compare is gone, the header got a real redesign with your account front and center at the top right, GOAT Profile tier buttons have real breathing room, suggestions now have Not done/Resolved tabs anyone can triage, and card clicks (title or body) now open everything together.',notes:[
  'Removed the Compare feature entirely (header button, modal, and the comparison logic behind it) -- it wasn\'t being used',
  'Redesigned the header: your account -- avatar, handle, live sync status -- is now its own prominent control at the very top right, immediately visible and unambiguous about which account you\'re signed into, separate from the Theme/Profile controls now grouped in a row below',
  'The Gold/Silver/Bronze/Owned buttons in GOAT Profile\'s "Search & Build Your Favorites" results are noticeably bigger and further apart now -- a dedicated roomier style for that one-card-at-a-time list, while every other card everywhere else keeps its original compact spacing',
  'The shared suggestion box now has Not done / Resolved tabs, styled like an inbox (amber vs. green) so you can see what\'s outstanding vs. already handled at a glance. Any suggestion can now be marked resolved or deleted by anyone, not just its original submitter -- editing text stays limited to your own, but curating the list (what\'s handled, what\'s not, what should stay) is now something anyone using the app can do together',
  'Clicking a card\'s title used to show only a quick summary, and clicking the rest of the card head used to show only the full stats breakdown -- two separate panels, never both. Either click now opens both together as one expanded unit, and either the title, the ✕, or "back to card" collapses both back down together',
  'Collection\'s gaps-and-blindspots rows (both the "what\'s missing from your shelf" list and the franchise/creator gap chips) and every Reference Matrices row are now clickable, jumping straight to that title in Global Controller -- the same pattern GOAT Profile\'s top matches already used',
  'One manual step if you have the suggestions status column already: re-run supabase/schema.sql once in the Supabase SQL Editor (idempotent) to widen the client-writable column grant from text-only to text+status, so the new resolved/not-done toggle can actually write'
 ]},
 {v:'1.35.0',date:'2026-09-03',summary:'Fixed the real, deeper cause of accounts still forgetting changes even on a brand-new handle: a slow (not dead) cloud save could get silently killed by the app\'s own reload or account switch before it ever reached the server.',notes:[
  'Root-cause fix: the app raced every cloud write against a timeout and reloaded/switched regardless of which one "won" -- but that race never actually cancelled a real request that lost, so a save merely running slow (a cold-starting free project, a weak connection) could still be in flight when the reload fired, and the browser would kill it outright. The previous 4-second cutoff was too short for this to be rare in real use. Raised to a realistic 15 seconds',
  'Switching accounts is now the safe direction by construction: it refuses to clear the current account and switch until that final save is confirmed to have actually landed (success or genuine failure), rather than assuming success once a short timer ran out. If the save genuinely fails (offline, dead connection), nothing is cleared or switched -- you get a clear message and can try again once reconnected',
  'This is a different, deeper fix than the previous release\'s: that one stopped a self-triggered reload from redundantly overwriting fresh local data with a stale cloud copy; this one stops the underlying save from being cut off mid-flight in the first place, which is what could make even a freshly-created account with no prior corruption still appear to "forget" a session\'s changes',
  'No schema changes needed for this one -- app-side timing/safety fix only'
 ]},
 {v:'1.34.0',date:'2026-09-03',summary:'Cosmic Horror is now pinnable like every other specialized index, the header\'s tagline row is gone, Quick Tips covers cloud accounts and the GOAT Profile search, and the tier row\'s active state is more visually distinct.',notes:[
  'Cosmic Horror moved from a permanently-fixed third slider in the main filter row into the same pinnable pool as the other 15 specialized indices -- pinned by default so nothing changes for an existing profile, but now genuinely unpinnable/re-pinnable with the same 📌 every other index already has, matching how the user pointed out it should behave "like all of the other sliders"',
  'Removed the "Obsidian Minimalist · Relational Omni-Data Core" tagline row above the title -- one less line taking up space for no real information',
  'Quick Tips ("New here? A few pointers") gained two entries: signing into a cloud account to sync across devices, and the GOAT Profile tab\'s dedicated search-and-declare screen -- both genuinely useful and previously undiscoverable from this banner alone',
  'The compact tier row\'s active segment now also gets a matching border, not just a filled background, so which tier is active reads clearly regardless of how a given device\'s emoji font renders the medal glyphs themselves',
  'Verified the tier row\'s actual DOM/CSS renders correctly and non-overlapping at every width from 768px to 1700px with real measurements (button positions, computed backgrounds) -- found no reproducible layout bug; a sample profile\'s items are tiered differently from each other, so which segment is highlighted and what color it is legitimately varies row to row, which can look inconsistent at a glance without being a bug'
 ]},
 {v:'1.33.0',date:'2026-09-03',summary:'Fixed a real data-loss bug where a signed-in account could silently lose recent changes on reload, cleaned up the GOAT Profile page\'s cluttered/overlapping tier badges, made Gold/Silver/Bronze pure emoji with an always-labeled Owned diamond, and added the ability to edit or delete your own suggestions.',notes:[
  'Root-cause fix for the account-forgets-your-changes bug: every reload the app triggers after its own successful (or failed) sync -- declaring something, owning something, importing, resetting, onboarding -- was ALSO, on the very next boot, unconditionally re-fetching from the cloud and overwriting local state with whatever came back. If that sync was slow, timed out, or failed for any reason, the very next reload would silently revert the change with no error shown. Fixed by having the app\'s own self-triggered reloads skip that redundant re-fetch entirely and trust the local copy they already correctly wrote',
  'Also fixed a related gap: switching accounts reloaded immediately with no wait, so an edit that doesn\'t reload the page on its own (toggling the watchlist, changing the theme, toggling density, dismissing the tips banner) could still be sitting in the 1.5s sync debounce window and get abandoned for good. Switching accounts now flushes any pending change first',
  'GOAT Profile\'s search-and-tier results no longer show a duplicate row of GOLD/SILVER/BRONZE/OWNED badge chips directly above the interactive tier row that already communicates the same thing -- this is what made the page look cluttered and "overlapping," especially on a phone',
  'The compact Gold/Silver/Bronze/Owned row on every card is now pure emoji for the three tiers, active or not (no more "🥇 Gold" text taking up space once declared) -- and the Owned diamond always shows the word "Owned" next to it, using the room that freed up, so it\'s unambiguous what the icon means at a glance',
  'Added the ability to edit or delete your own suggestions from the shared suggestion box (only ones matching your signed-in handle show the controls) -- previously submitted suggestions were permanent and could never be removed or corrected',
  'This needs the same one manual step as prior schema updates: re-run supabase/schema.sql once in the Supabase SQL Editor (idempotent) to pick up the suggestions update/delete policy and column-level privilege grant'
 ]},
 {v:'1.32.0',date:'2026-09-03',summary:'A real mobile UX pass: the 11-button nav (which wrapped into 5-6 rows on a phone, pushing everything else off-screen) is now a single swipeable row, and the header\'s profile buttons no longer wrap either. Desktop is untouched.',notes:[
  'On screens under 768px wide, #nav switches from wrapping into several rows to a single horizontally-scrollable row -- the same swipe-sideways pattern as browser tabs or an app\'s category chips. Previously you had to scroll down through 5-6 rows of nav buttons before reaching the search bar or any real content at all',
  'Switching tabs now scrolls the newly-active one into view if it was off to the side, so picking a tab from elsewhere in the app (a deep link, a card click) never leaves the highlighted tab stranded out of sight in the scrollable row',
  'The header\'s Export/Import/Reset/Compare row gets the same single-scrollable-row treatment instead of wrapping onto a second line',
  'Desktop and tablet layouts are completely unchanged -- every rule here only applies under 768px wide, confirmed by checking the nav still wraps normally (no scrolling) at desktop width'
 ]},
 {v:'1.31.0',date:'2026-09-03',summary:'"Start from the PK Sample" now actually gives you your own editable copy from the moment you pick it (live from Payton\'s real account when cloud accounts are configured, not a frozen snapshot), and Quick-rate got a genuine Back button.',notes:[
  'Fixed a real bug: picking "Look around the PK Sample" (now "Start from the PK Sample") never actually saved anything -- it just left the hardcoded default profile sitting in memory, so nobody had a real, independent copy of it unless they happened to make an edit that triggered a save on its own. It now clones a starting profile and saves it immediately, exactly like every other onboarding path -- yours to tier, own, add to, or remove from right away, without ever touching Payton\'s real account',
  'When cloud accounts are configured, that clone is fetched live from Payton\'s real "payton" account instead of the hardcoded defaults baked into this copy of the file, so the sample reflects whatever Payton\'s collection actually looks like today. Falls back to the built-in defaults if that fetch fails for any reason (cloud not configured, no network, the account doesn\'t exist yet)',
  'Added a "← Back" button to the Quick-rate screen so you can back out to the other starting options without committing anything -- previously "Skip this" was the only way out, and that commits a blank profile rather than actually going back. Search & pick your GOATs already had a working Cancel for the same purpose'
 ]},
 {v:'1.30.0',date:'2026-09-03',summary:'Database hardening pass: media_status and friends now cascade-delete with the profiles row they belong to (fixing "Delete my account" leaving tier/owned data behind forever), plus a shape check and a defensive row cap.',notes:[
  'media_status.handle and friends.handle/friend_handle now foreign-key to profiles.handle with ON DELETE CASCADE. This closes a real gap: "Delete my account" already told the user it removes "your synced profile, watchlist, and preferences," but only ever deleted the profiles row -- a handle\'s tier/owned data and follow edges were silently orphaned forever. The DB now enforces what the UI already promised, with no extra app code needed',
  'Sequenced the profiles and media_status cloud writes (previously fired in parallel) so a brand-new handle\'s very first tier action can\'t race the new foreign key -- the profiles row is guaranteed to exist before anything tries to reference it',
  'media_status.media_id now has a real length check (1-20 chars), matching every other client-supplied text column in the schema; media_status and friends each got a defensive per-handle row cap (3,000 and 1,000) in the same spirit as the existing 200KB cap on profiles.data -- a backstop against a runaway client bug, not a security boundary',
  'suggestions.handle/suggestion_votes.handle and profile_snapshots.handle were deliberately left without foreign keys: guest suggestions write handle=\'anonymous\' (not a real account), and snapshots must outlive the profiles row they back up -- both documented in supabase/schema.sql',
  'Needs the same one manual step as before: re-run the updated supabase/schema.sql in the Supabase SQL Editor (idempotent, safe to re-run)'
 ]},
 {v:'1.29.0',date:'2026-09-03',summary:'Gold/Silver/Bronze tiers and owned status now sync to a normalized media_status table in Supabase (not just the profiles.data blob), and a real race between cloud sync and the app\'s own page-reload was found and fixed along the way.',notes:[
  'New media_status table (supabase/schema.sql) holds one row per handle+title with a tier and an owned flag -- the exact signals that drive the recommendation engine -- so they\'re queryable per title in the DB instead of locked inside one opaque jsonb blob. Every tier/own/import/reset/onboarding action keeps it in sync automatically; add and remove both just work, no separate step',
  'Found and fixed a real bug while wiring this up: tiering or owning something reloads the page immediately (the scoring pipeline needs a full recompute), which was racing the existing 1.5s debounced cloud sync -- the sync almost never won that race, and the next boot\'s cloud hydrate would then silently revert the just-made change back to the last-synced (stale) copy. Fixed by flushing an immediate sync and waiting for it, bounded by a timeout, before reloading at all, instead of firing a debounced one and reloading straight past it',
  'This needs one manual step to actually take effect: re-run the updated supabase/schema.sql once in the Supabase SQL Editor (idempotent, safe on top of what\'s already there) to create the media_status table'
 ]},
 {v:'1.28.0',date:'2026-09-03',summary:'Two additional schema pieces added to the Supabase backend: suggestion voting/status and a friends/follows table, plus a rolling per-profile backup history -- DB-only, not yet wired into the app UI.',notes:[
  'suggestions gained a votes count (via a new suggestion_votes table, one vote per handle per suggestion) and a status field (open/planned/shipped/declined) settable from the SQL Editor',
  'New friends table: a directed handle-follows-friend_handle edge, meant to back a real Compare/leaderboard feature later (today\'s Compare only works against a manually exported file)',
  'New profile_snapshots table: automatically captures the last 20 versions of each handle\'s profile before any update or delete, so "Delete my account" and accidental overwrites are recoverable -- locked down so only the capturing trigger can write to it, never a client directly'
 ]},
 {v:'1.27.0',date:'2026-09-03',summary:'Account UI redesigned for clarity, an in-app "Delete my account" option was added, and a long-standing bug where several Tailwind classes had never actually been compiled into the stylesheet was found and fixed -- most visibly, it was silently breaking the cloud account gate.',notes:[
  'Redesigned the "Whose ledger is this?" cloud-account gate (icon, clearer heading and helper copy, styled Continue button, an explicit "or continue without an account" divider) and the account menu (a colored sync-status dot plus a "Signed in as X. Syncing/Synced/Sync failed" status line instead of a bare label)',
  'Added "Delete my account" to the account menu (only shown when signed into a real cloud handle): confirms, deletes the profile row from Supabase, and clears the local copy and remembered handle -- supabase/schema.sql now grants delete on profiles, so anyone who already ran an earlier copy of that file needs to re-run it once for this to work',
  'Found and fixed a real, previously-invisible bug: several Tailwind utility classes referenced in the markup (across many earlier phases) were never actually present in the compiled stylesheet, including max-w-sm/max-w-lg (three modals -- the account gate, onboarding, and suggestion box -- were rendering full-width instead of as a centered card) and z-[1000] (the account gate\'s icon and label were being painted over by the sticky header, since a missing z-index falls back to auto and loses to any explicit z-index regardless of DOM order). Regenerated the correct rules with a real Tailwind CLI build and folded in the ~20 other classes the same sweep found missing (tier-row divider, suggestion box, quick-tips banner, and more)'
 ]},
 {v:'1.26.1',date:'2026-09-03',summary:'Cloud accounts double-checked against the real Supabase client library (not just a mock) after the database schema was actually applied, and the client pin bumped to fully support the new key format.',notes:[
  'Bumped the pinned Supabase JS client (2.45.4 -> 2.114.0) to match the newer sb_publishable_ key format the project now issues',
  'Verified end-to-end against the real client library (fetched directly, not the test mock): account sign-in, cross-device hydration, and the suggestion box all fire the exact requests supabase/schema.sql expects, with no page errors'
 ]},
 {v:'1.26.0',date:'2026-09-03',summary:'Cloud accounts are now live, backed by a real Supabase project instead of a never-configured Firebase placeholder.',notes:[
  'Replaced the dormant Firebase/Firestore cloud-account code (never actually configured since Phase 11) with Supabase/Postgres -- same features (name-based accounts, cross-device sync, the shared suggestion box), same friend-group trust model, but SUPABASE_CONFIG is now filled in with real values rather than a placeholder, so this is genuinely turned on',
  'New supabase/schema.sql sets up the two tables this needs (profiles, suggestions) with Row Level Security policies mirroring the old Firestore rules\' trust model, plus a trigger that validates what gets written and stamps the update time server-side',
  'Needs one manual step to actually go live: run supabase/schema.sql once in the Supabase project\'s SQL Editor -- see NOTES.md "Cloud accounts (Supabase)"'
 ]},
 {v:'1.25.0',date:'2026-09-03',summary:'Mobile pass across every tab, plus a real bug fix: an active Gold tier button was mislabeled "Declare" instead of "Gold".',notes:[
  'Audited all 10 primary views, the results grid, expanded card detail, and every modal at a 390px mobile width -- filters, sliders, genre chips, nav, and the Visualization Suite\'s layout all already wrap and stack correctly (the discipline of testing "no horizontal overflow" throughout every earlier phase this session paid off here)',
  'Fixed a real bug found during that audit: the compact tier row\'s active-state label was derived from the raw internal action name (declare/silver/bronze/own), which happens to spell "Silver," "Bronze," and "Owned" correctly by coincidence but turned an active Gold button into "🥇 Declare" instead of "🥇 Gold" everywhere the tier row appears -- cards, GOAT Profile search results, everywhere'
 ]},
 {v:'1.24.0',date:'2026-09-03',summary:'Both first-run "build your taste" flows got more comprehensive and better looking: Quick-rate offers 16 varied picks (with a reshuffle option), and Search & Pick Your GOATs now has a type filter and richer result rows.',notes:[
  'Quick-rate now offers 16 well-regarded, genre-and-creator-diversified picks instead of 10, plus a "🔄 Show different picks" button that swaps out anything you haven\'t loved for a fresh batch (never repeating a title already shown) while keeping whatever you\'ve already hearted',
  '"Search & Pick Your GOATs" gained a Movies/TV/Games/Books type filter and a "Showing X of Y matches" count, and each result row now shows a genre and critic score alongside the title/creator/year instead of a bare single-line list -- easier to recognize something at a glance, especially when scrolling 40 search results deep'
 ]},
 {v:'1.23.0',date:'2026-09-03',summary:'Personal GOAT Profile now shows Gold/Silver/Bronze as distinct, labeled groups within Movies/Books/TV/Games -- Silver and Bronze picks were previously invisible on this page entirely.',notes:[
  'The 4 corpus-backed declared categories (Movies, Books, TV Shows, Video Game) now render live from actual tier data (Gold/Silver/Bronze), grouped and labeled separately within each category, instead of from a static list that only ever tracked Gold -- anything tiered Silver or Bronze from a card\'s compact row or the GOAT Profile search previously showed up nowhere on this page at all',
  'Non-corpus hand-curated categories (Director, Actors, Composers, Cinematographer, Artist, YouTube) are unchanged -- they have no tier concept, so they keep their original single-list display'
 ]},
 {v:'1.22.0',date:'2026-09-03',summary:'The favorite-tier row on every card is now a compact icon strip instead of 4 full-width buttons, and creators can be buried, not just boosted.',notes:[
  'Replaced the Gold/Silver/Bronze/Owned row\'s 4 full-text buttons with a compact icon strip -- same 4 actions, same one-click toggling, far less visual clutter on every single result card',
  'The old one-way "+ Boost <creator>" button is now a −/+ stepper showing the live weight, so pushing a creator DOWN ("the opposite of boosting" -- someone whose work keeps surfacing but you\'re not that into) is exactly as easy and visible as pushing one up. Weight ranges -20 to 20; landing back on exactly 0 removes the entry rather than leaving a stale no-op weight around'
 ]},
 {v:'1.21.0',date:'2026-09-03',summary:'The sample profile is now clearly labeled "PK Sample" -- Payton\'s real taste, offered as a starting example, not something you\'re editing.',notes:[
  'Renamed the onboarding option from "Use the built-in sample profile" to "Look around the PK Sample," with copy explaining it\'s Payton\'s real, lived-in collection and taste weights offered as an example -- Export it and Import it back as your own copy to actually build on it, rather than treating the original as yours to edit',
  'No technical access control changes here -- that becomes meaningful once cloud accounts are configured and the PK account is the only one with write access to that specific profile. Until then this is a labeling and clarity fix, not an enforcement mechanism'
 ]},
 {v:'1.20.0',date:'2026-09-03',summary:'Removed the Tonight tab -- Surprise Me now covers the same ground (mood + time budget) plus more.',notes:[
  'Retired the "🌙 Tonight" header button and its modal: Surprise Me already did almost the same job (medium/mood/ownership-scoped weighted pick) with a nicer result card, so it just needed a time-budget option added rather than keeping two separate pickers',
  'Surprise Me\'s scope panel gained a "Time" selector (movies-only, same reasoning as Tonight\'s always had: TV/games/books don\'t have a reliable single-sitting runtime) -- everything else about Surprise Me (medium, mood, owned/discover pool, taste-match ring, best-edition suggestion, why-recommended) is unchanged and now covers Tonight\'s use case too'
 ]},
 {v:'1.19.0',date:'2026-09-03',summary:'The 5 quick filters up top are now a more useful, well-rounded set by default: Technical Fidelity, GOAT Match, Cosmic Horror, Soundtrack, and 4K Reference.',notes:[
  'Swapped Atmospheric Dread/Immersion and Ontological/Systems Complexity out of the always-visible main filter row and into Advanced Filters (still there, still fully usable, just not two of the default 5) -- Soundtrack/Audio and 4K Reference take their place, pinned by default on a fresh profile so the initial row is more broadly useful than any 3 craft-only sliders plus GOAT Match/Cosmic Horror alone',
  'Existing pins are unaffected: this only changes what a fresh, never-customized profile starts with -- if you\'ve already pinned or unpinned anything, your own choices are exactly as you left them'
 ]},
 {v:'1.18.0',date:'2026-09-03',summary:'The README got a full rewrite aimed at anyone, not just developers -- plus Bronze tier and slider-pinning got added to the profile-format docs.',notes:[
  'README.md rewritten top to bottom for readability by a non-technical friend: plain-language feature tour, a "short version" up front, and technical detail moved to its own section at the end instead of mixed throughout',
  'PROFILE_TEMPLATE.md field reference updated to include bronzeTierIds and pinnedIdx, which were added to the app in earlier phases but missing from that document'
 ]},
 {v:'1.17.0',date:'2026-09-03',summary:'A dismissible "New here?" tips banner points out how the app actually works, for anyone opening it fresh.',notes:[
  'New: a one-time "New here? A few pointers" banner at the top of Global Controller for a fresh profile, pointing out that cards expand on click, the row under each card can tier/own without expanding, sliders can be pinned from Advanced Filters, and where to suggest a feature. Dismissible, remembered from then on (synced to your cloud account if you have one)'
 ]},
 {v:'1.16.0',date:'2026-09-03',summary:'The version history now leads with a plain-English summary per update, with full technical details one click away.',notes:[
  'What\'s Changed now shows one short, plain-language sentence per version instead of dropping straight into developer-facing bullet notes -- click "Show full details" on any entry if you want the complete list of what changed and why'
 ]},
 {v:'1.15.0',date:'2026-09-03',summary:'Added a "Suggest a feature" button so anyone can share ideas with everyone else using the app.',notes:[
  'New: a "💡 Suggest a feature" button in the header opens a shared suggestion box -- write an idea or a bug, and it\'s visible to everyone using the app, not just you. Needs cloud accounts set up (see below); without that it explains why instead of silently doing nothing'
 ]},
 {v:'1.14.0',date:'2026-09-03',summary:'"Pick Your GOATs" moved into the GOAT Profile tab, and it now remembers what tab you were on.',notes:[
  '"Pick Your GOATs" is no longer a separate header button and popup -- it\'s now a real search box built right into the top of the GOAT Profile tab. Search, then tier or mark owned directly on each result with the same buttons every card already has. Your declared canon, taste DNA, and recommendations below it update the moment you do',
  'Fixed: declaring/tiering/owning something from anywhere other than Global Controller used to bounce you back to Global Controller (the page reloads to recompute your match scores) -- it now returns you to whatever tab you were on'
 ]},
 {v:'1.13.0',date:'2026-09-03',summary:'The filters most people actually use are now always on screen, and you can pin your own favorites too.',notes:[
  'Genre, Owned/Not-owned, and Gold/Silver/Bronze filters are now always visible on the main screen -- no more opening Advanced Filters just to use the ones almost everyone reaches for',
  'New: pin any of the 15 specialized index sliders (Soundtrack, Scariest, Iconicness, etc.) to the main filter row with one click, so your own most-used filters are always one click away too. Unpin just as easily -- it moves, not copies, so there\'s never two of the same slider to keep in sync',
  'Advanced Filters is now genuinely just the less-common stuff: TV structure, content rating, unpinned specialized indices, year range, and strict-AND mode'
 ]},
 {v:'1.12.0',date:'2026-09-03',summary:'Each card now shows the 3 stats that actually matter for that work, and the detail view uses space better.',notes:[
  'Each card\'s 3 at-a-glance stats now show whatever is actually strongest for THAT specific work, out of ~19 tracked indices -- not the same fixed trio for every movie, every book, every game. A quiet character drama can lead with Emotional; a soundtrack-driven blockbuster leads with Soundtrack. Expand any card to see all of them, same as before',
  'Fixed wasted space in the expanded card detail: GOAT Match and Cosmic Horror were oddly isolated in their own rows because the whole index grid was nested inside a different grid as a single item instead of being laid out alongside it. They now share the same responsive grid as every other index'
 ]},
 {v:'1.11.0',date:'2026-09-03',summary:'Added Gold/Silver/Bronze favorite tiers, visible and toggleable right on every card.',notes:[
  'A real 3-tier favorites system: Gold (your existing declared favorites), Silver (your existing Silver tier), and a new Bronze tier -- each pulls the match score up a different amount (Gold pins 100, Silver pulls hard toward 88, Bronze nudges toward 80), so recommendations naturally favor Gold over Silver over Bronze over the rest of your owned collection',
  'Tiering is now visible and usable right on every card -- no need to expand it first. A compact row under each result lets you toggle Gold/Silver/Bronze/Owned in one click, and tiered cards get a colored badge (🥇/🥈/🥉) at a glance',
  'New "My Tiers" sort and Gold/Silver/Bronze filter checkboxes (Advanced Filters) so you can browse or isolate just your tiered favorites',
  '"Why this was recommended" reasoning now cites your highest-tier matching favorite (Gold, then Silver, then Bronze, then plain ownership) instead of only ever citing something you own',
  'Fixed a real bug (invisible until now): the "🌙 Tonight" and "★ Pick Your GOATs" header buttons shared styling with the actual view tabs, and clicking them was quietly corrupting which view was showing underneath their pop-up -- closing either could leave the page looking blank. Fixed and covered by a regression test'
 ]},
 {v:'1.10.0',date:'2026-09-02',summary:'Account switching now lives in a proper dropdown, and there\'s just one link for everyone to use.',notes:[
  'Account menu: the header\'s Account control is now a proper dropdown (click your name, top right) showing which account you\'re in and a "Switch account…" action, instead of a plain always-visible Switch button',
  'Retired share.html and scripts/make-share-copy.js -- now that cloud accounts (1.9.0) give everyone their own name-based account with zero bias from anyone else\'s data, one link (index.html) works for everybody. The onboarding gate\'s "sample profile" option (Payton\'s own taste, clearly labeled) is still there for anyone who wants to look around before building their own'
 ]},
 {v:'1.9.1',date:'2026-09-02',summary:'Fixed the platform/network/studio dropdown for real this time -- it was silently broken by a CSS bug.',notes:[
  'Real fix for the combo dropdowns (platform/network/studio filter, Structural Fingerprint Radar search boxes) not closing: a CSS specificity conflict meant the "hidden" class was being toggled correctly by JS the whole time but never actually took visual effect, since this file\'s own .rcPop{display:flex} rule came after Tailwind\'s compiled .hidden{display:none} in the document and won the cascade at equal specificity. The 1.9.0 "closes on scroll" change was real but, like every other close path (selecting an option, clicking outside, Escape), was silently not working visually -- confirmed against a screen recording of the bug',
  'Fixed a second bug found while fixing the first: scrolling inside a combo\'s own option list (to reach an item below the fold) was closing the whole combo instead of scrolling the list, and a combo could fail to reopen right after being closed by a browser auto-scroll (e.g. tabbing to a field near the viewport edge) racing with the close-on-scroll handler'
 ]},
 {v:'1.9.0',date:'2026-09-02',summary:'Added optional cloud accounts, so your data can follow you between devices.',notes:[
  'Optional cloud accounts (Firebase Firestore) -- pick a name once, get your data back on any device under that name. Off by default (zero behavior change) until FIREBASE_CONFIG is filled in; see NOTES.md "Cloud accounts" for the 5-minute setup',
  'Fixed: the platform/network/studio filter and the Structural Fingerprint Radar\'s search dropdowns stayed open while scrolling, covering content underneath -- they now close on scroll, same as they already did on outside-click and Escape'
 ]},
 {v:'1.8.0',date:'2026-09-02',summary:'A big data-accuracy pass: more real recommendations, plus 11 corrected entries.',notes:[
  'Composers and Cinematographers recommendations now 10/10 corpus-linked, matching Actors -- most averaging 2-5 real films each instead of just one',
  'A real data-quality verification campaign: 46 entries spot-checked against Rotten Tomatoes/Metacritic/Goodreads/Steam across six passes, 11 corrections applied (Titanic, Days of Being Wild, CODA, Noita, Marriage Story, Kingdom, Rififi, Hell or High Water, Ringu, Casablanca, Shōgun) -- corrections weren’t limited to this session’s own additions, some were in the original pre-session ledger too',
  'A programmatic structural audit of all 2,508 entries found zero real data bugs -- no missing fields, no broken scores, no duplicate content'
 ]},
 {v:'1.7.0',date:'2026-09-02',summary:'Movies hit exactly 1,000, and the Contenders Ledger got a refresh against real release news.',notes:[
  'Movies to exactly 1,000 (added Do the Right Thing, replacing a cross-batch duplicate gap)',
  'Contenders Ledger refresh pass: 13 more entries spot-checked against live sources (20/50 total, up from 7/50) -- 5 newly-released games (Saros, Resident Evil Requiem, Crimson Desert, Nioh 3, Forza Horizon 6) reconciled into the scored corpus with real Metacritic data, House of the Dragon and Fallout updated to reflect aired seasons, The Penguin Season 2’s actual not-renewed status corrected',
  'Actors recommendations deepened: all 10 of 10 now genuinely corpus-linked (up from 9/10), most averaging across multiple real films instead of just one',
  'Corpus now 2,508 works: 1,000 films / 250 TV / 258 games / 1,000 books -- games sits above the original 250 target because 8 real, sourced Contenders reconciliations landed there across two rounds; trimming real verified data to hit a round number would be a quality regression, not an improvement'
 ]},
 {v:'1.6.0',date:'2026-09-02',summary:'Split the huge dataset into its own files, making the app load faster and easier to update.',notes:[
  'Corpus split out of index.html into data/movies.js, data/tv.js, data/games.js, data/books.js -- loaded via classic <script src> so file:// still works with no server. Both index.html and share.html reference the same files, dropping each from ~1.58MB to ~330KB and meaning a corpus edit no longer needs a share.html regeneration',
  'Music Artists and YouTube recommendation scoring now blends vibe-weight matches alongside genre (previously genre-only) -- a real, verified improvement, though these two categories still can’t be corpus-linked the way Actors/Composers/Cinematographers now are (no music-album or video-essay category exists in the corpus)',
  'Contenders Ledger staleness is now visible instead of invisible: each entry shows a "spot-checked <date>" or "not yet spot-checked" badge, a header count, and a new "Unverified only" filter -- plus a documented refresh runbook in NOTES.md',
  'Fixed a latent bug from the corpus expansion: a dataset-integrity console.assert was silently failing on every load (checking against a stale "≤500" ceiling), and the Contenders count briefly showed a stale hardcoded value before being overwritten -- both fixed, and both now guarded by test/smoke.js so they can’t regress silently again'
 ]},
 {v:'1.5.0',date:'2026-09-02',summary:'The collection nearly doubled in size, and every taste setting became clickable -- no more JSON editing.',notes:[
  'Corpus nearly doubled: 999 films, 250 TV series, 253 games, and 1,000 books (2,502 works total, up from 1,300) — all real, researched titles spanning genres and eras, verified with zero duplicate IDs or titles anywhere in the collection',
  'Reconciled 3 released Contenders Ledger entries (Metroid Prime 4: Beyond, 007: First Light, The Blood of Dawnwalker) into the real scored corpus with actual Metacritic-sourced critical/audience scores; their ledger entries now show a green "IN LEDGER — VIEW SCORE" badge linking straight to the real entry',
  'Actors/Composers/Cinematographers recommendation picks are now genuinely computed where a real corpus work exists for them (26 of 30 items), not just genre-overlap approximated -- marked "◆ linked" per item',
  'Reached full click-editor parity: genre chips, the vibe chip, a new Silver Tier button, and a book-only affinity-boost button mean every PERSONAL_PROFILE taste-weight field except cosmicHorrorCanon is now editable with no JSON required',
  'test/smoke.js\'s baseline check now verifies the corpus total against the sum of per-kind counts instead of a hardcoded number, so it stays correct as the corpus keeps growing'
 ]},
 {v:'1.4.0',date:'2026-09-02',summary:'Added "Pick Your GOATs" search, cross-medium pairings, profile comparison, and a real test suite.',notes:[
  '"Pick Your GOATs": search the full 1,300-work corpus and declare favorites directly, either from the first-run gate (builds a genuinely blank profile for a new person, not a copy of Payton’s) or anytime after from a header button',
  'Cross-Medium Pairings on every card detail: up to 3 works of a different kind (movie/TV/game/book) that share genres or vibe, one click away',
  'Profile Comparison: load someone else’s exported profile and see shared declared favorites, what’s unique to each of you, shared creators/genres, and an overlap percentage -- read-only, nothing is saved',
  'Fixed a layout bug where max-h-[85vh]/max-h-64 utility classes were referenced in markup but never compiled into the stylesheet, so several modals could grow past the viewport with footer buttons unreachable',
  'Fixed mobile-viewport horizontal scrolling on every tab (header controls and the results action row now wrap instead of overflowing)',
  'Added a committed Playwright regression suite (test/smoke.js, `npm test`) covering onboarding, all 10 views, filters, the platform-dropdown fix, and the new GOAT Picker'
 ]},
 {v:'1.3.1',date:'2026-09-02',summary:'Fixed the platform/network/studio dropdown getting stuck open.',notes:[
  'Fixed: the platform/network/studio dropdown could get stuck open and not close on click. It ran its own separate "click outside to close" listener instead of sharing the one all other dropdowns use, which was fragile by construction. Unified onto one shared listener, and added Escape-to-close as a reliable fallback for every dropdown.'
 ]},
 {v:'1.3.0',date:'2026-09-02',summary:'Added one-click favoriting/owning from any card, a quick-start onboarding option, and the Tonight picker.',notes:[
  'Declare favorites and mark items owned right from any card -- no more hand-editing profile JSON for the basics',
  'First-run "quick-rate a few titles" option seeds real recommendations in under a minute',
  '"Tonight" picker: mood + time budget -> one specific pick (movies only for the time filter -- see NOTES.md)',
  'Directors recommendations are now genuinely computed from your profile (not a fixed list); the other five people categories are honestly labeled "approximate" instead of pretending to be personalized',
  'Export/Import now bundles your Watchlist tab, theme, and density along with your taste profile',
  'Contenders Ledger refreshed against real-world release news (a few 2026 entries had already shipped, delayed, or been cancelled)'
 ]},
 {v:'1.2.0',date:'2026-09-01',summary:'The app now works fully offline -- no internet connection needed to look right.',notes:['Tailwind CSS compiled and committed to the file -- no more CDN dependency, works fully offline']},
 {v:'1.1.0',date:'2026-09-01',summary:'Added a blank-profile version of the app, safe to hand to anyone else.',notes:['share.html: a copy of this app with no personal data baked in, safe to hand to anyone (scripts/make-share-copy.js regenerates it)','PROFILE_TEMPLATE.md documents how to hand-build a profile file']},
 {v:'1.0.0',date:'2026-08-31',summary:'Added a first-run setup screen and made 4 recommendation categories fully personalized.',notes:['First-run onboarding gate: choose sample / blank / import instead of silently inheriting the default profile','Movies/Books/TV Series/Video Games recommendations generated live from your actual profile instead of a fixed list']},
 {v:'0.9.0',date:'2026-08-31',summary:'Your profile can now be saved, exported, imported, and reset.',notes:['Personal profile is now swappable: saved to this browser, exportable/importable as JSON, resettable to blank']},
 {v:'0.8.0',date:'2026-08-30',summary:'Foundational: separated personal taste data from the shared collection data.',notes:['All personal data (owned collection, declared canon, taste weights) consolidated onto one PERSONAL_PROFILE object, separate from the shared 1,300-work corpus']}
];
(function versionMarker(){
 var vt=$('#versionText');if(vt)vt.textContent=APP_VERSION;
 var btn=$('#versionBtn'),gate=$('#versionGate');
 if(!btn||!gate)return;
 $('#versionLog').innerHTML=CHANGELOG.map(function(e,i){
  return '<div><div class="flex items-baseline gap-2"><span class="text-sm font-bold text-slate-100">v'+e.v+'</span><span class="text-[11px] text-slate-500">'+e.date+'</span></div>'
   +'<p class="text-[13px] text-slate-300 mt-1 leading-relaxed">'+esc(e.summary||e.notes[0])+'</p>'
   +(e.notes.length>1?'<button type="button" class="verDetailsBtn text-[11px] text-slate-500 hover:text-slate-300 underline decoration-dotted underline-offset-2 mt-1" data-i="'+i+'">Show full details</button>':'')
   +'<ul class="verDetails hidden mt-1 space-y-0.5" data-i="'+i+'">'+e.notes.map(function(n){return '<li class="text-[12px] text-slate-400 leading-relaxed">· '+esc(n)+'</li>';}).join('')+'</ul></div>';
 }).join('');
 on('#versionBtn','click',function(){gate.classList.remove('hidden');});
 on('#versionClose','click',function(){gate.classList.add('hidden');});
 on('#versionLog','click',function(e){
  var b=e.target.closest('.verDetailsBtn');if(!b)return;
  var ul=$('.verDetails[data-i="'+b.dataset.i+'"]');if(!ul)return;
  var nowHidden=ul.classList.toggle('hidden');
  b.textContent=nowHidden?'Show full details':'Hide details';
 });
})();

/* ===== Suggestion box: shared Supabase table, visible to everyone =====
   Writes/reads use window.__omniAcct().client directly rather than a row keyed by handle --
   suggestions aren't personal data, they're a shared feed everyone contributes to and sees,
   so they live in their own top-level 'suggestions' table instead of nested under any
   one account. If cloud accounts aren't configured, the box still opens but explains that
   suggestions need that setup rather than silently doing nothing. #suggestBtn shares the
   .navBtn class with no data-view, the same shape that caused two earlier bugs (the old
   #tonightBtn and #goatPickerBtn) where the click bubbled into #nav's delegated
   switchView(undefined) and hid the whole page -- e.stopPropagation() here is mandatory,
   not defensive style. */
(function suggestBox(){
 var btn=$('#suggestBtn'),gate=$('#suggestGate');
 if(!btn||!gate)return;
 var loaded=false;
 var allItems=[];
 var activeTab='open';
 var RESOLVED_STATUSES=['shipped','declined'];
 function acct(){return (typeof window.__omniAcct==='function')?window.__omniAcct():null;}
 function showError(msg){var e=$('#suggestError');if(!e)return;e.textContent=msg;e.classList.toggle('hidden',!msg);}
 function open(){
  gate.classList.remove('hidden');
  showError('');
  if(!loaded){loaded=true;loadSuggestions();}
 }
 function close(){gate.classList.add('hidden');}
 function esc2(s){return esc(String(s==null?'':s));}
 function timeAgo(ms){
  if(!ms)return'';
  var s=Math.max(1,Math.round((Date.now()-ms)/1000));
  if(s<60)return s+'s ago';
  var m=Math.round(s/60);if(m<60)return m+'m ago';
  var h=Math.round(m/60);if(h<24)return h+'h ago';
  var d=Math.round(h/24);return d+'d ago';
 }
 function setTab(tab){
  activeTab=tab;
  document.querySelectorAll('#suggestTabs .suggestTab').forEach(function(b){b.classList.toggle('on',b.dataset.tab===tab);});
  renderList(allItems);
 }
 // Edit stays limited to your own suggestion (editing someone else's wording doesn't make sense),
 // same honor-system trust model as everywhere else in this app -- a handle is a name someone
 // typed, not a verified identity, so this is a UI convenience, not a real security boundary.
 // Delete and the resolved/not-done toggle, though, are offered on EVERY suggestion regardless of
 // who submitted it: this is a small shared list one household curates together, not a queue with
 // separate moderators, and the RLS policies underneath already allow this (anyone can update/
 // delete any row, same as profiles' "delete my account" already does) -- the UI was just more
 // restrictive than the backend for no real reason.
 function renderList(items){
  var list=$('#suggestList');if(!list)return;
  var openCount=items.filter(function(it){return RESOLVED_STATUSES.indexOf(it.status)<0;}).length;
  var resolvedCount=items.length-openCount;
  var oc=$('#suggestTabOpenCount'),rc=$('#suggestTabResolvedCount');
  if(oc)oc.textContent=openCount;
  if(rc)rc.textContent=resolvedCount;
  var shown=items.filter(function(it){
   var isResolved=RESOLVED_STATUSES.indexOf(it.status)>=0;
   return activeTab==='resolved'?isResolved:!isResolved;
  });
  if(!shown.length){
   list.innerHTML='<div class="text-[12px] text-slate-500">'+(activeTab==='resolved'?'Nothing resolved yet.':'Nothing outstanding — be the first to suggest something.')+'</div>';
   return;
  }
  var a=acct();var myHandle=a&&a.handle;
  list.innerHTML=shown.map(function(it){
   var mine=!!(myHandle&&it.handle&&it.handle===myHandle);
   var isResolved=RESOLVED_STATUSES.indexOf(it.status)>=0;
   return '<div class="text-[12px] bg-slate-900/50 suggestItem '+(isResolved?'isResolved':'isOpen')+' rounded-lg p-2" data-suggest-id="'+it.id+'">'
    +'<div class="suggestTextView text-slate-200 leading-relaxed">'+esc2(it.text)+'</div>'
    +'<div class="flex items-center justify-between gap-2 mt-1 flex-wrap">'
    +'<div class="text-[10px] text-slate-500">'+esc2(it.handle||'anonymous')+(it.createdAtMs?' · '+timeAgo(it.createdAtMs):'')+'</div>'
    +'<div class="flex gap-2 shrink-0">'
    +(mine?'<button type="button" class="suggestEditBtn text-[10px] text-slate-500 hover:text-slate-300 underline decoration-dotted underline-offset-2" data-id="'+it.id+'">Edit</button>':'')
    +'<button type="button" class="suggestResolveBtn text-[10px] underline decoration-dotted underline-offset-2" style="color:'+(isResolved?'#94a3b8':'#34d399')+'" data-id="'+it.id+'" data-next="'+(isResolved?'open':'shipped')+'">'+(isResolved?'↩ Reopen':'✅ Mark resolved')+'</button>'
    +'<button type="button" class="suggestDeleteBtn text-[10px] text-rose-400/80 hover:text-rose-300 underline decoration-dotted underline-offset-2" data-id="'+it.id+'">Delete</button>'
    +'</div></div></div>';
  }).join('');
 }
 function loadSuggestions(){
  var a=acct();
  if(!a||!a.configured){
   allItems=[];
   $('#suggestList').innerHTML='<div class="text-[12px] text-slate-500">Cloud accounts aren\'t set up on this copy of the app yet, so suggestions can\'t be shared or saved here. See NOTES.md → "Cloud accounts".</div>';
   return;
  }
  a.client.from('suggestions').select('id,text,handle,created_at,status').order('created_at',{ascending:false}).limit(50).then(function(res){
   if(res.error)throw res.error;
   allItems=(res.data||[]).map(function(row){
    return {id:row.id,text:row.text,handle:row.handle,status:row.status||'open',createdAtMs:row.created_at?new Date(row.created_at).getTime():null};
   });
   renderList(allItems);
  }).catch(function(err){
   $('#suggestList').innerHTML='<div class="text-[12px] text-rose-400">Couldn\'t load suggestions ('+esc2(err&&err.message||err)+').</div>';
  });
 }
 function deleteSuggestion(id){
  var a=acct();if(!a||!a.configured)return;
  if(typeof confirm!=='undefined'&&!confirm('Delete this suggestion? This can\'t be undone.'))return;
  a.client.from('suggestions').delete().eq('id',id).then(function(res){
   if(res&&res.error){showError('Couldn\'t delete that ('+(res.error.message||res.error)+').');return;}
   loadSuggestions();
  });
 }
 function toggleResolved(id,nextStatus){
  var a=acct();if(!a||!a.configured)return;
  a.client.from('suggestions').update({status:nextStatus}).eq('id',id).then(function(res){
   if(res&&res.error){showError('Couldn\'t update that ('+(res.error.message||res.error)+').');return;}
   loadSuggestions();
  });
 }
 function startEdit(row){
  var text=row.querySelector('.suggestTextView');if(!text)return;
  var id=row.dataset.suggestId;
  var original=text.textContent;
  row.innerHTML='<textarea class="inp suggestEditArea" rows="3" style="resize:vertical;font-size:12px">'+esc2(original)+'</textarea>'
   +'<div class="flex justify-end gap-2 mt-1.5">'
   +'<button type="button" class="suggestEditCancel text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>'
   +'<button type="button" class="suggestEditSave text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold" data-id="'+id+'">Save</button>'
   +'</div>';
  var ta=row.querySelector('.suggestEditArea');if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
 }
 function saveEdit(id,row){
  var ta=row.querySelector('.suggestEditArea');if(!ta)return;
  var text=ta.value.trim();
  if(!text)return;
  var a=acct();if(!a||!a.configured)return;
  a.client.from('suggestions').update({text:text}).eq('id',id).then(function(res){
   if(res&&res.error){showError('Couldn\'t save that edit ('+(res.error.message||res.error)+').');return;}
   loadSuggestions();
  });
 }
 function submit(){
  var ta=$('#suggestText');
  var text=(ta&&ta.value||'').trim();
  if(!text){showError('Write something first.');return;}
  var a=acct();
  if(!a||!a.configured){showError('Cloud accounts aren\'t set up on this copy of the app, so there\'s nowhere to send this yet.');return;}
  showError('');
  var submitBtn=$('#suggestSubmit');
  if(submitBtn)submitBtn.disabled=true;
  var handle=a.handle||'anonymous';
  a.client.from('suggestions').insert({text:text,handle:handle}).then(function(res){
   if(res.error)throw res.error;
   if(ta)ta.value='';
   loaded=true;
   activeTab='open';setTab('open');
   loadSuggestions();
  }).catch(function(err){
   showError('Couldn\'t submit that ('+(err&&err.message||err)+').');
  }).finally(function(){
   if(submitBtn)submitBtn.disabled=false;
  });
 }
 on('#suggestBtn','click',function(e){e.stopPropagation();open();});
 on('#suggestClose','click',close);
 on('#suggestSubmit','click',submit);
 on('#suggestTabs','click',function(e){
  var b=e.target.closest('.suggestTab');if(!b)return;
  setTab(b.dataset.tab);
 });
 on('#suggestList','click',function(e){
  var row=e.target.closest('[data-suggest-id]');if(!row)return;
  if(e.target.closest('.suggestDeleteBtn')){deleteSuggestion(e.target.closest('.suggestDeleteBtn').dataset.id);return;}
  if(e.target.closest('.suggestResolveBtn')){var rb=e.target.closest('.suggestResolveBtn');toggleResolved(rb.dataset.id,rb.dataset.next);return;}
  if(e.target.closest('.suggestEditBtn')){startEdit(row);return;}
  if(e.target.closest('.suggestEditCancel')){renderList(allItems);return;}
  if(e.target.closest('.suggestEditSave')){saveEdit(e.target.closest('.suggestEditSave').dataset.id,row);return;}
 });
 setTab('open');
})();

/* ===== GOAT Picker modal: onboarding-only search-and-select =====
   This full-screen search/stage/finalize modal used to also be reachable anytime via a header
   "Pick Your GOATs" button. That's gone now -- the ongoing, day-to-day version of "search and
   declare favorites" lives directly in the GOAT Profile tab (#goatSearchInput/#goatSearchResults,
   further down), using the same compact tier row every card already has, so there's no separate
   popup to learn. This modal survives only for the first-run onboarding gate's "Search & pick your
   GOATs" option, where a full-screen batch-and-finalize flow (stage several picks, review, commit
   once) is a better fit than tiering one at a time before a profile even exists yet. */
(function goatPicker(){
 var gate=$('#goatPickerGate');if(!gate)return;
 var staged=new Map(); // id -> 'gold'|'silver'|'bronze'
 var fromOnboarding=false;
 var pickerType='all';
 function open(viaOnboarding){
  fromOnboarding=!!viaOnboarding;
  // Onboarding always starts from a genuinely blank slate, even on index.html where
  // PERSONAL_PROFILE.declaredGoatIds already holds Payton's own hardcoded defaults -- someone
  // building their own taste from the first-run gate should never see Payton's picks pre-staged.
  // Reopening from the persistent header button afterward seeds from ALL THREE of the live
  // profile's tier lists (not just Gold), so reopening shows exactly what's already tiered.
  staged=new Map();
  if(!fromOnboarding){
   (PERSONAL_PROFILE.declaredGoatIds||[]).forEach(function(id){staged.set(id,'gold');});
   (PERSONAL_PROFILE.silverTierIds||[]).forEach(function(id){if(!staged.has(id))staged.set(id,'silver');});
   (PERSONAL_PROFILE.bronzeTierIds||[]).forEach(function(id){if(!staged.has(id))staged.set(id,'bronze');});
  }
  var search=$('#goatPickerSearch');if(search)search.value='';
  pickerType='all';$$('#goatPickerType button').forEach(function(b){b.classList.toggle('on',b.dataset.t==='all');});
  renderResults('');
  renderStaged();
  gate.classList.remove('hidden');
  if(fromOnboarding){var cs=$('#onboardChoiceScreen');if(cs)cs.classList.add('hidden');}
 }
 function close(){
  gate.classList.add('hidden');
  if(fromOnboarding){var cs=$('#onboardChoiceScreen');if(cs)cs.classList.remove('hidden');}
 }
 function renderResults(q){
  q=(q||'').trim().toLowerCase();
  var pool=q?ALL.filter(function(x){return (x.title+' '+x.creator+' '+(x.genres||[]).join(' ')).toLowerCase().indexOf(q)>=0;})
   :ALL.slice().sort(function(a,b){return (b.crit+b.aud)-(a.crit+a.aud);});
  if(pickerType!=='all')pool=pool.filter(function(x){return x.kind===pickerType;});
  var shown=pool.slice(0,40);
  var k2=KM;
  var cnt=$('#goatPickerResultCount');
  if(cnt)cnt.textContent=pool.length?('Showing '+shown.length+' of '+pool.length+' match'+(pool.length===1?'':'es')):'';
  $('#goatPickerResults').innerHTML=shown.map(function(x){
   var t=staged.get(x.id);
   return '<div class="goatPickerItem w-full rounded-lg border p-2 transition-colors flex items-center gap-2.5" data-id="'+x.id+'" style="'+(t?'border-color:'+borderColorForTier(t)+';background:rgba(251,191,36,.06)':'border-color:var(--border-2)')+'">'
    +'<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:'+k2[x.kind].c+'"></span>'
    +'<span class="flex-1 min-w-0 truncate"><span class="text-[12.5px] text-slate-200 font-medium">'+esc(x.title)+'</span> <span class="text-[10.5px] text-slate-500">· '+x.year+' · '+esc(x.creator)+'</span>'
    +(x.genres&&x.genres.length?' <span class="text-[10px] text-slate-600">· '+esc(x.genres.slice(0,2).join(', '))+'</span>':'')+'</span>'
    +'<span class="text-[10px] tabular-nums text-slate-500 shrink-0" title="Critic score">'+x.crit+'</span>'
    +miniTierBtnsHTML(x.id,t,'goatPickerTierBtn')+'</div>';
  }).join('')||'<div class="rcEmpty">No matches'+(pickerType!=='all'?' in '+k2[pickerType].label:'')+'.</div>';
 }
 function renderStaged(){
  var ids=Array.from(staged.keys());
  $('#goatPickerCount').textContent=ids.length;
  $('#goatPickerStaged').innerHTML=ids.map(function(id){
   var x=byId.get(id);if(!x)return'';
   var t=staged.get(id);var m=MINI_TIER_ORDER.find(function(o){return o[0]===t;});
   return '<span class="chip" style="color:'+m[2]+';border-color:'+m[2]+'55">'+m[1]+' '+esc(x.title)+' <button type="button" class="goatPickerRemove" data-id="'+id+'" style="margin-left:4px;color:#f87171">✕</button></span>';
  }).join('')||'<span class="text-[11px] text-slate-600">Nothing tiered yet — search above to add some.</span>';
 }
 on('#onboardGoatPicker','click',function(){open(true);});
 on('#goatPickerClose','click',close);
 on('#goatPickerCancel','click',close);
 on('#goatPickerSearch','input',function(){renderResults(this.value);});
 on('#goatPickerType','click',function(e){
  var b=e.target.closest('button');if(!b)return;
  pickerType=b.dataset.t;
  $$('#goatPickerType button').forEach(function(x){x.classList.toggle('on',x===b);});
  renderResults($('#goatPickerSearch').value);
 });
 on('#goatPickerResults','click',function(e){
  var b=e.target.closest('.goatPickerTierBtn');if(!b)return;
  var id=b.dataset.id,t=b.dataset.tier;
  if(staged.get(id)===t)staged.delete(id);else staged.set(id,t);
  renderResults($('#goatPickerSearch').value);
  renderStaged();
 });
 on('#goatPickerStaged','click',function(e){
  var b=e.target.closest('.goatPickerRemove');if(!b)return;
  staged.delete(b.dataset.id);
  renderStaged();
  renderResults($('#goatPickerSearch').value);
 });
 on('#goatPickerClear','click',function(){staged=new Map();renderStaged();renderResults($('#goatPickerSearch').value);});
 on('#goatPickerFinalize','click',function(){
  var golds=[],silvers=[],bronzes=[];
  staged.forEach(function(t,id){(t==='gold'?golds:t==='silver'?silvers:bronzes).push(id);});
  if(fromOnboarding){
   // Mirrors the blank staged map above: build a genuinely fresh profile from just these picks
   // rather than cloning PERSONAL_PROFILE, which on index.html still holds Payton's full default
   // taste weights (creatorBoost, ownedMedia, etc.) at this point in a fresh browser. Same three
   // fields a card's tier row writes -- no separate declaredCanon bucket needed, since the GOAT
   // Profile page already renders Gold/Silver/Bronze live from these lists.
   var profile={};
   if(golds.length)profile.declaredGoatIds=golds;
   if(silvers.length)profile.silverTierIds=silvers;
   if(bronzes.length)profile.bronzeTierIds=bronzes;
   try{localStorage.setItem('omniLedgerOnboarded','1');localStorage.setItem('omniLedgerProfile',JSON.stringify(profile));}catch(e){alert('Could not save: '+e.message);return;}
   reloadWithMediaSync({});
  }else{
   mutateProfileAndReload(function(p){
    p.declaredGoatIds=golds;
    p.silverTierIds=silvers;
    p.bronzeTierIds=bronzes;
   });
  }
 });
})();

/* Shared Gold/Silver/Bronze mini tier-picker used by BOTH onboarding flows (Quick-Rate and the GOAT
   Picker search modal) so declaring taste before you're even in the app looks and behaves exactly
   like tiering something from a card afterward -- same three medals, same colors, same "click the
   active one to remove" behavior as tierRowHTML() -- just backed by a local staging map instead of
   PERSONAL_PROFILE, since no profile exists yet at this point in onboarding. */
const MINI_TIER_ORDER=[['gold','\u{1F947}','#fbbf24','Gold — your absolute favorite'],['silver','\u{1F948}','#cbd5e1','Silver — a strong favorite, one notch below Gold'],['bronze','\u{1F949}','#cd7f32','Bronze — really like it, a lighter nudge than Silver']];
function miniTierBtnsHTML(id,activeTier,cls){
 return '<div class="flex items-center gap-1 shrink-0">'+MINI_TIER_ORDER.map(function(o){
  var on=activeTier===o[0];
  return '<button type="button" class="'+cls+' tierSeg" data-id="'+id+'" data-tier="'+o[0]+'" title="'+o[3]+(on?' — click to remove':'')+'"'
   +(on?' style="background:'+o[2]+';border-color:'+o[2]+';color:#0B0F19"':' style="color:'+o[2]+';border-color:transparent"')+'>'+o[1]+'</button>';
 }).join('')+'</div>';
}
function borderColorForTier(tier){var m=MINI_TIER_ORDER.find(function(o){return o[0]===tier;});return m?m[2]+'66':'';}

/* ===== Guided seed-picker (Phase 2 of the original plan: "rate these N items to seed taste") =====
   A pool picked at runtime by pre-personalization quality (crit+aud average) so it's a "well-
   regarded, broadly varied" set rather than anything tied to one person's taste -- fair to show a
   friend as much as it is to show Payton on a fresh device. Loving one or more seeds declaredGoatIds
   and a "My Favorites" declaredCanon group; skipping entirely just falls through to a blank profile,
   same as clicking Start Blank directly.
   16 items (5 movies/5 books, 3 each TV/games) rather than the original 10 -- broad enough that
   someone unfamiliar with a few picks still likely recognizes several -- and diversified by BOTH
   creator and top genre family, not just creator, so the spread doesn't collapse into one genre's
   greatest hits. excludeIds lets "show different picks" pull a genuinely fresh batch instead of
   reshuffling the same top-quality handful. */
function pickSeedCandidates(excludeIds){
 var exclude=new Set(excludeIds||[]);
 const byKindSorted={};
 ['movie','tv','game','book'].forEach(k=>{byKindSorted[k]=ALL.filter(x=>x.kind===k&&!exclude.has(x.id)).slice().sort((a,b)=>(b.crit+b.aud)-(a.crit+a.aud));});
 const counts={movie:5,tv:3,game:3,book:5};
 const picks=[];
 Object.keys(counts).forEach(k=>{
  const seenCreator=new Set(picks.map(p=>p.creator));
  const seenFam=new Set(picks.map(p=>(p.fam&&p.fam[0])||''));
  let taken=0;
  // First pass: also require a fresh top genre family, for real variety within this kind.
  for(const x of byKindSorted[k]){
   if(taken>=counts[k])break;
   if(seenCreator.has(x.creator))continue;
   const fam=(x.fam&&x.fam[0])||'';
   if(fam&&seenFam.has(fam))continue;
   picks.push(x);seenCreator.add(x.creator);if(fam)seenFam.add(fam);taken++;
  }
  // Second pass: relax the genre-family constraint if that wasn't enough to fill the quota
  // (some kinds have fewer distinct top families than the count needs).
  if(taken<counts[k]){
   for(const x of byKindSorted[k]){
    if(taken>=counts[k])break;
    if(picks.indexOf(x)>=0)continue;
    if(seenCreator.has(x.creator))continue;
    picks.push(x);seenCreator.add(x.creator);taken++;
   }
  }
 });
 return picks;
}
(function onboardGate(){
 var onboarded=false;try{onboarded=!!localStorage.getItem('omniLedgerOnboarded');}catch(e){onboarded=true;}
 if(onboarded)return;
 var gate=$('#onboardGate');if(!gate)return;
 gate.classList.remove('hidden');
 var choiceScreen=$('#onboardChoiceScreen'),seedScreen=$('#onboardSeedScreen');
 var tiers=new Map(); // id -> 'gold'|'silver'|'bronze', set directly here so it's already accurate on arrival
 var shownIds=new Set();
 var currentPicks=[];
 function renderSeedGrid(picks){
  currentPicks=picks;
  $('#onboardSeedGrid').innerHTML=picks.map(x=>{var t=tiers.get(x.id);
   return '<div class="onboardSeedItem w-full rounded-xl border border-slate-700 p-3 transition-colors" data-id="'+x.id+'"'+(t?' style="border-color:'+borderColorForTier(t)+'"':'')+'>'
   +'<div class="flex items-start justify-between gap-2"><div class="min-w-0">'
   +'<div class="text-sm font-semibold text-slate-100 truncate">'+esc(x.title)+' <span class="text-slate-500 font-normal">· '+x.year+'</span></div>'
   +'<div class="text-[11px] text-slate-500 mt-0.5">'+esc(x.creator)+' · '+esc((x.genres||[]).slice(0,2).join(', '))+'</div>'
   +'</div>'+miniTierBtnsHTML(x.id,t,'onboardSeedTierBtn')+'</div>'
   +'</div>';}).join('');
  $('#onboardSeedCount').textContent=tiers.size+' tiered';
 }
 // "Start from the PK Sample" used to just leave PERSONAL_PROFILE's hardcoded defaults in place
 // without ever writing omniLedgerProfile -- meaning there was no actual saved copy: anyone who
 // picked it and didn't happen to tier/own anything on their very first action had nothing
 // committed at all, and even those who did were silently working from a single shared in-memory
 // object, not a real personal profile decoupled from Payton's own account. Fixed to explicitly
 // clone a starting profile and save it immediately, so it's genuinely "yours" -- editable, and
 // removable -- from the moment you pick it, same as every other onboarding path.
 // When cloud accounts are configured, fetches Payton's real, currently-live "payton" account
 // instead of the hardcoded defaults baked into this copy of the file, so the sample reflects
 // whatever Payton's account actually looks like today, not a snapshot frozen at whenever this
 // file was last regenerated. Falls back to the hardcoded defaults if that fetch fails for any
 // reason (cloud not configured, network error, the handle doesn't exist yet) -- same
 // degrade-gracefully posture as the rest of the cloud-account code.
 var SAMPLE_HANDLE='payton';
 function fetchLiveSampleProfile(){
  var a=(typeof window.__omniAcct==='function')?window.__omniAcct():null;
  if(!a||!a.configured||!a.client)return Promise.resolve(null);
  return a.client.from('profiles').select('data').eq('handle',SAMPLE_HANDLE).maybeSingle().then(function(res){
   if(res&&res.error)throw res.error;
   var raw=res&&res.data&&res.data.data&&res.data.data.omniLedgerProfile;
   return raw?JSON.parse(raw):null;
  }).catch(function(e){console.warn('Could not fetch the live PK sample, using the built-in defaults:',e&&e.message||e);return null;});
 }
 on('#onboardSample','click',function(e){
  var btn=e.currentTarget;btn.disabled=true;
  fetchLiveSampleProfile().then(function(live){
   var seed=live||JSON.parse(JSON.stringify(PERSONAL_PROFILE));
   try{localStorage.setItem('omniLedgerOnboarded','1');localStorage.setItem('omniLedgerProfile',JSON.stringify(seed));}catch(err){alert('Could not save: '+err.message);btn.disabled=false;return;}
   reloadWithMediaSync({});
  });
 });
 on('#onboardBlank','click',()=>{try{localStorage.setItem('omniLedgerOnboarded','1');localStorage.setItem('omniLedgerProfile','{}');}catch(e){}reloadWithMediaSync({});});
 on('#onboardImportInput','change',e=>{const file=e.target.files&&e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(typeof parsed!=='object'||parsed===null||Array.isArray(parsed))throw new Error('File is not a profile object');localStorage.setItem('omniLedgerOnboarded','1');applyImportedSnapshot(parsed);reloadWithMediaSync({});}catch(err){alert('Could not import that file: '+err.message);}};reader.readAsText(file);});
 on('#onboardSeed','click',()=>{
  const picks=pickSeedCandidates();
  picks.forEach(x=>shownIds.add(x.id));
  renderSeedGrid(picks);
  choiceScreen.classList.add('hidden');seedScreen.classList.remove('hidden');
 });
 // "Show different picks": keeps anything already tiered on screen (so tiering something then
 // asking for more doesn't lose your pick), fetches a genuinely fresh batch for the rest --
 // pickSeedCandidates excludes every id shown so far, so reshuffling never repeats a title.
 // Genuinely a no-op cancel, not a variant of Skip: nothing here has been saved yet (the whole
 // seed screen only ever writes localStorage on Skip/Continue), so going back to reconsider --
 // maybe Start from the PK Sample instead -- just swaps the visible screen back.
 on('#onboardSeedBack','click',()=>{seedScreen.classList.add('hidden');choiceScreen.classList.remove('hidden');});
 on('#onboardSeedMore','click',()=>{
  const keep=currentPicks.filter(x=>tiers.has(x.id));
  const fresh=pickSeedCandidates(Array.from(shownIds));
  fresh.forEach(x=>shownIds.add(x.id));
  const keepIds=new Set(keep.map(x=>x.id));
  renderSeedGrid(keep.concat(fresh.filter(x=>!keepIds.has(x.id))));
 });
 on('#onboardSeedGrid','click',e=>{
  const b=e.target.closest('.onboardSeedTierBtn');if(!b)return;
  const id=b.dataset.id,t=b.dataset.tier;
  if(tiers.get(id)===t)tiers.delete(id);else tiers.set(id,t);
  renderSeedGrid(currentPicks);
 });
 on('#onboardSeedSkip','click',()=>{try{localStorage.setItem('omniLedgerOnboarded','1');localStorage.setItem('omniLedgerProfile','{}');}catch(e){}reloadWithMediaSync({});});
 on('#onboardSeedContinue','click',()=>{
  try{
   const profile={};
   const golds=[],silvers=[],bronzes=[];
   tiers.forEach((t,id)=>{(t==='gold'?golds:t==='silver'?silvers:bronzes).push(id);});
   // Same three fields toggleDeclaredFavorite/toggleSilverTier/toggleBronzeTier write once you're
   // in the app -- no separate "My Favorites" bucket here, so a seed tiered Gold now looks and
   // scores exactly like any other Gold pick from the moment you land, not a different category.
   if(golds.length)profile.declaredGoatIds=golds;
   if(silvers.length)profile.silverTierIds=silvers;
   if(bronzes.length)profile.bronzeTierIds=bronzes;
   localStorage.setItem('omniLedgerOnboarded','1');
   localStorage.setItem('omniLedgerProfile',JSON.stringify(profile));
  }catch(e){}
  reloadWithMediaSync({});
 });
})();

on('#wlFilter','click',e=>{const b=e.target.closest('button');if(!b)return;state.wlFilter=b.dataset.wf;$$('#wlFilter button').forEach(x=>x.classList.toggle('on',x===b));renderWatchlist();});
on('#wlTypeSeg','click',e=>{const b=e.target.closest('button');if(!b)return;state.wlType=b.dataset.wt;$$('#wlTypeSeg button').forEach(x=>x.classList.toggle('on',x===b));renderWatchlist();scheduleURLSync();});
on('#wlSortSel','change',e=>{state.wlSort=e.target.value;renderWatchlist();scheduleURLSync();});
let wlSearchT=null;
on('#wlSearch','input',e=>{clearTimeout(wlSearchT);const v=e.target.value;wlSearchT=setTimeout(()=>{state.wlSearchQ=v;renderWatchlist();scheduleURLSync();},120);});
on('#wlGrid','click',e=>{const dn=e.target.closest('.wlDone'),rm=e.target.closest('.wlRemove');
 if(dn){wlSetWatched(dn.dataset.id,!WL[dn.dataset.id].watched);renderWatchlist();}
 else if(rm){wlToggle(rm.dataset.id);renderWatchlist();}});
on('#wlRecs','click',e=>{const a=e.target.closest('.wlAdd');if(a){wlToggle(a.dataset.id);renderWatchlist();}});
on('#wlClear','click',()=>{if(typeof confirm==='undefined'||confirm('Clear your entire watchlist?')){WL={};wlSave();renderWatchlist();}});
on('#wlExport','click',()=>{const items=wlItems().map(x=>({title:x.title,year:x.year,medium:KM[x.kind].label,watched:WL[x.id].watched}));
 const blob=new Blob([JSON.stringify(items,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='my-watchlist.json';a.click();});
on('#creatorGrid','keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const f=e.target.closest('.flip');if(f){e.preventDefault();f.classList.toggle('flipped');}});

/* ===================== BOOT ===================== */
// Alphabetical by label -- both Advanced Filters' unpinned list and the pinned main row (which
// filters this same array) start in a-z order, so a slider's position is predictable without
// having to scan every entry first.
const INDEX_DEFS=[['ref','4K Reference','#818cf8'],['dread','Atmospheric Dread / Immersion','#fb7185'],['aud','Audience Score','#4ade80'],['awe','Awe / Spectacle','#fbbf24'],['perf','Best Performances','#fda4af'],['cozy','Comfort / Cozy','#34d399'],['ch','Cosmic Horror','#c084fc'],['crit','Critical Score','#94a3b8'],['emo','Emotional / Sad','#f0abfc'],['funny','Funniest','#fde047'],['shock','Genuine Shock','#fb923c'],['hist','Historically Accurate','#a3e635'],['icon','Iconicness','#fcd34d'],['myst','Ontological / Systems Complexity','#2dd4bf'],['real','Realism','#86efac'],['reality','Reality-Altering','#c4b5fd'],['runtime','Runtime (movies)','#38bdf8',{max:240,step:5,cap:true,zeroLabel:'Any',unit:'m'}],['scary','Scariest','#f87171'],['sci','Scientific','#67e8f9'],['snd','Soundtrack / Audio','#7dd3fc'],['tech','Technical Craft','#a5b4fc'],['vibe2','Vibe / Atmosphere','#e879f9']];
// Per-slider options, for the one slider that is not a plain 0-100 floor. Runtime is a CAP in
// minutes whose 0 means "no limit", so it needs its own max/step and reads as "Any" or "120m"
// rather than a bare number. Everything else falls through to the defaults.
const INDEX_OPTS={};INDEX_DEFS.forEach(function(d){INDEX_OPTS[d[0]]=d[3]||{};});
function idxDisplay(k,v){
 var o=INDEX_OPTS[k]||{};
 if(!v&&o.zeroLabel)return o.zeroLabel;
 return String(v)+(o.unit||'');
}
// Alphabetical display order for genre families -- a separate sorted copy, not a reorder of
// GENRE_FAMILIES itself, since that array's order also decides which family wins as fam[0] (the
// "primary" family) for a work matching more than one regex, which pickSeedCandidates and others
// rely on. Sorting the source array would silently change that unrelated behavior.
const GENRE_FAMILIES_AZ=GENRE_FAMILIES.slice().sort((a,b)=>a[0].localeCompare(b[0]));
// Genre chips are tri-state: neutral -> included (must match) -> excluded (must NOT match) -> back
// to neutral. Included stays the existing indigo "on" look; excluded gets a distinct red/struck
// treatment so the two are never confusable at a glance.
function buildGenreChips(){
 $('#genreChips').innerHTML=GENRE_FAMILIES_AZ.map(f=>{const name=f[0],n=GENRE_COUNTS[name]||0;if(!n)return '';
  const on=state.genres.includes(name),off=state.genresExclude.includes(name);
  const style=on?'color:#0B0F19;background:#a5b4fc;border-color:#a5b4fc;font-weight:700':off?'color:#fca5a5;background:#7f1d1d33;border-color:#f8717166;text-decoration:line-through;font-weight:700':'';
  const title=on?'Included -- click to exclude instead':off?'Excluded -- click to clear':'Click to include, click again to exclude';
  return '<button type="button" class="chip genreChip" data-g="'+esc(name)+'" title="'+title+'" style="cursor:pointer;'+style+'">'+(off?'✕ ':'')+esc(name)+' <span style="opacity:.6">'+n+'</span></button>';}).join('');
}
function buildRatingChips(){
 $('#ratingChips').innerHTML=RATING_ORDER.filter(r=>RATING_COUNTS[r]).map(r=>{const on=state.ratings.includes(r);
  return '<button type="button" class="chip ratingChip" data-r="'+esc(r)+'" style="cursor:pointer;'+(on?'color:#0B0F19;background:#5eead4;border-color:#5eead4;font-weight:700':'')+'">'+esc(r)+' <span style="opacity:.6">'+RATING_COUNTS[r]+'</span></button>';}).join('');
}
// Pinning: a user can pin any of the 17 specialized index sliders to the always-visible main
// filter row instead of needing to open Advanced Filters every time to reach it. A slider lives in
// exactly one place at a time (moved, not duplicated) so there's only ever one live DOM element per
// index and no risk of two copies drifting out of sync.
function pinnedIdxSet(){return new Set(PERSONAL_PROFILE.pinnedIdx||DEFAULT_PINNED_IDX);}
// Per-index tooltip text where the label alone doesn't make the metric's meaning obvious --
// Technical Craft in particular blends different components per media type and otherwise looks
// like an unexplained duplicate of 4K Reference / Soundtrack.
const IDX_DESC={dread:'Atmospheric dread index for film & TV \u00b7 immersion / tension index for games.',myst:'Ontological complexity for film & TV \u00b7 systems complexity for games. Puzzle-boxes, recursive timelines, deep mechanics.',runtime:'Caps movie runtime -- TV, games and books are unaffected since there is no one comparable length metric across them. Slide to 240+ or leave at Any to turn it off.',tech:'A broad craft average, distinct from the more specific 4K Reference and Soundtrack sliders below. Movies & TV: mean of 4K transfer fidelity, audio soundscape and cinematography. Games: mean of engine/graphics performance and art direction. Books: mean of prose craft and idea density.'};
function sliderBlockHTML(d,pinned){
 var star='<button type="button" class="pinIdxBtn" data-k="'+d[0]+'" title="'+(pinned?'Unpin from the main filter row':'Pin to the main filter row, so it always shows without opening Advanced Filters')+'" style="cursor:pointer;background:none;border:none;padding:0;line-height:1;color:'+(pinned?d[2]:'#475569')+'">📌</button>';
 var desc=IDX_DESC[d[0]];
 var o=d[3]||{};
 // A cap ("≤ 120m") reads the opposite way round from a floor ("≥ 80"), so the operator and the
 // aria-label follow the slider's own meaning instead of being hardcoded as a minimum.
 var op=o.cap?' \u2264':' \u2265';
 var labelSpan='<span class="fieldlbl mb-0 flex items-center gap-1.5'+(desc?' cursor-help':'')+'"'+(desc?' title="'+esc(desc)+'"':'')+' style="color:'+d[2]+'">'+star+' '+d[1]+op+'</span>';
 var v=state.idx[d[0]]||0;
 return '<div><div class="flex justify-between items-baseline mb-1.5">'+labelSpan+'<span class="text-[12px] font-bold tabular-nums" style="color:'+d[2]+'" id="idxV_'+d[0]+'">'+idxDisplay(d[0],v)+'</span></div>'
  +'<input type="range" class="idxSlider" data-k="'+d[0]+'" min="0" max="'+(o.max||100)+'" step="'+(o.step||1)+'" value="'+v+'" aria-label="'+(o.cap?'Maximum ':'Minimum ')+esc(d[1])+'"/></div>';
}
function buildIndexSliders(){
 var pinned=pinnedIdxSet();
 $('#indexSliders').innerHTML=INDEX_DEFS.filter(d=>!pinned.has(d[0])).map(d=>sliderBlockHTML(d,false)).join('')
  ||'<div class="text-[11px] text-slate-500 col-span-full">All specialized indices are pinned to the main filter row above.</div>';
 buildPinnedMainSliders();
}
function buildPinnedMainSliders(){
 var pinned=pinnedIdxSet();
 var el=$('#pinnedMainSliders');if(!el)return;
 var defs=INDEX_DEFS.filter(d=>pinned.has(d[0]));
 el.classList.toggle('hidden',!defs.length);
 el.innerHTML=defs.map(d=>sliderBlockHTML(d,true)).join('');
}
function togglePinIdx(key){
 PERSONAL_PROFILE.pinnedIdx=PERSONAL_PROFILE.pinnedIdx||DEFAULT_PINNED_IDX.slice();
 var i=PERSONAL_PROFILE.pinnedIdx.indexOf(key);
 if(i>=0)PERSONAL_PROFILE.pinnedIdx.splice(i,1);else PERSONAL_PROFILE.pinnedIdx.push(key);
 try{localStorage.setItem('omniLedgerProfile',JSON.stringify(PERSONAL_PROFILE));localStorage.setItem('omniLedgerOnboarded','1');}catch(e){}
 buildIndexSliders(); // rebuilds both the advanced list and the pinned main row, preserving state.idx values
}
function syncAdvCount(){
 // Only counts filters that actually live inside the collapsed Advanced panel -- genre, owned/not-
 // owned, and tier moved to the always-visible main row, so they no longer need this badge to
 // surface them.
 let n=state.ratings.length+IDX_KEYS.filter(k=>state.idx[k]>0).length+(state.yearMin!=null||state.yearMax!=null?1:0)+(state.combine?1:0)+(state.idx.runtime>0?1:0);
 const c=$('#advCount');if(c){c.style.display=n?'inline-flex':'none';c.textContent=n+' on';}
}
on('#advToggle','click',()=>{const pnl=$('#advPanel');pnl.classList.toggle('hidden');$('#advCaret').style.transform=pnl.classList.contains('hidden')?'':'rotate(90deg)';});
on('#genreChips','click',e=>{const b=e.target.closest('.genreChip');if(!b)return;const g=b.dataset.g;
 const inI=state.genres.indexOf(g),inX=state.genresExclude.indexOf(g);
 if(inI>=0){state.genres.splice(inI,1);state.genresExclude.push(g);} // included -> excluded
 else if(inX>=0){state.genresExclude.splice(inX,1);} // excluded -> neutral
 else{state.genres.push(g);} // neutral -> included
 buildGenreChips();syncAdvCount();refresh();});
on('#genreClear','click',()=>{state.genres=[];state.genresExclude=[];buildGenreChips();syncAdvCount();refresh();});
on('#ratingChips','click',e=>{const b=e.target.closest('.ratingChip');if(!b)return;const r=b.dataset.r;const i=state.ratings.indexOf(r);if(i<0)state.ratings.push(r);else state.ratings.splice(i,1);buildRatingChips();syncAdvCount();refresh();});
on('#ratingClear','click',()=>{state.ratings=[];buildRatingChips();syncAdvCount();refresh();});
function handleIdxSliderInput(e){const sl=e.target.closest('.idxSlider');if(!sl)return;const k=sl.dataset.k;state.idx[k]=+sl.value;const v=$('#idxV_'+k);if(v)v.textContent=idxDisplay(k,+sl.value);syncAdvCount();refresh();}
on('#indexSliders','input',handleIdxSliderInput);
on('#pinnedMainSliders','input',handleIdxSliderInput);
function handlePinBtnClick(e){const b=e.target.closest('.pinIdxBtn');if(!b)return;togglePinIdx(b.dataset.k);}
on('#indexSliders','click',handlePinBtnClick);
on('#pinnedMainSliders','click',handlePinBtnClick);
on('#combineMode','change',e=>{state.combine=e.target.checked;refresh();});
on('#ownedToggle','change',e=>{state.ownedOnly=e.target.checked;if(e.target.checked){state.notOwnedOnly=false;const no=$('#notOwnedToggle');if(no)no.checked=false;}syncAdvCount();refresh();});
on('#notOwnedToggle','change',e=>{state.notOwnedOnly=e.target.checked;if(e.target.checked){state.ownedOnly=false;const o=$('#ownedToggle');if(o)o.checked=false;}syncAdvCount();refresh();});
$$('.tierChk').forEach(chk=>chk.addEventListener('change',()=>{
 state.tierFilter=$$('.tierChk').filter(c=>c.checked).map(c=>c.dataset.tier);
 syncAdvCount();refresh();
}));
on('#yearMin','input',e=>{state.yearMin=e.target.value?+e.target.value:null;syncAdvCount();refresh();});
on('#yearMax','input',e=>{state.yearMax=e.target.value?+e.target.value:null;syncAdvCount();refresh();});
on('#yearPresets','click',e=>{const b=e.target.closest('button');if(!b)return;
 state.yearMin=b.dataset.ymin?+b.dataset.ymin:null;state.yearMax=b.dataset.ymax?+b.dataset.ymax:null;
 $('#yearMin').value=state.yearMin!=null?state.yearMin:'';$('#yearMax').value=state.yearMax!=null?state.yearMax:'';
 syncAdvCount();refresh();});
on('#activeBar','click',e=>{
 if(e.target.closest('#clearAllF')){clearAllFilters();return;}
 if(e.target.closest('#activeBarToggle')){activeBarExpanded=!activeBarExpanded;renderActiveBar();return;}
 const b=e.target.closest('.activeChip');if(!b)return;const c=b.dataset.clr;
 if(c==='q'){state.q='';$('#q').value='';}
 else if(c==='type'){state.type='all';$$('#typeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.type==='all'));}
 else if(c==='struct'){state.struct='all';$('#structSel').value='all';}
 else if(c.indexOf('plat:')===0){const p=c.slice(5);state.plats=state.plats.filter(x=>x!==p);updatePlatLabel();}
 else if(c==='year'){state.yearMin=state.yearMax=null;$('#yearMin').value='';$('#yearMax').value='';}
 else if(c==='owned'){state.ownedOnly=false;const o=$('#ownedToggle');if(o)o.checked=false;}
 else if(c==='notowned'){state.notOwnedOnly=false;const no=$('#notOwnedToggle');if(no)no.checked=false;}
 else if(c.indexOf('tier:')===0){const t=c.slice(5);state.tierFilter=state.tierFilter.filter(x=>x!==t);$$('.tierChk').forEach(chk=>{if(chk.dataset.tier===t)chk.checked=false;});}
 else if(c.indexOf('genre:')===0){const g=c.slice(6);state.genres=state.genres.filter(x=>x!==g);buildGenreChips();}
 else if(c.indexOf('genreEx:')===0){const g=c.slice(8);state.genresExclude=state.genresExclude.filter(x=>x!==g);buildGenreChips();}
 else if(c.indexOf('rating:')===0){const r=c.slice(7);state.ratings=state.ratings.filter(x=>x!==r);buildRatingChips();}
 else if(c.indexOf('idx:')===0){const k=c.slice(4);state.idx[k]=0;const sl=$$('.idxSlider').find(s=>s.dataset.k===k);if(sl)sl.value=0;const vv=$('#idxV_'+k);if(vv)vv.textContent=idxDisplay(k,0);}
 else if(c==='minGoat'){state.minGoat=0;$('#minGoat').value=0;$('#minGoatV').textContent='0';}
 syncAdvCount();refresh();
});
function clearAllFilters(){
 Object.assign(state,{q:'',type:'all',struct:'all',plats:[],minGoat:0,genres:[],genresExclude:[],ratings:[],ownedOnly:false,notOwnedOnly:false,tierFilter:[],yearMin:null,yearMax:null,combine:false});
 $$('.tierChk').forEach(c=>{c.checked=false;});
 state.idx={snd:0,ref:0,ch:0,emo:0,awe:0,cozy:0,perf:0,icon:0,scary:0,real:0,reality:0,shock:0,sci:0,funny:0,hist:0,vibe2:0,crit:0,aud:0,tech:0,dread:0,myst:0,runtime:0};state.ratings=[];
 $('#q').value='';var ss=$('#structSel');if(ss)ss.value='all';updatePlatLabel();
 var mgs=$('#minGoat');if(mgs)mgs.value=0;var mgv2=$('#minGoatV');if(mgv2)mgv2.textContent='0';
 $$('#typeSeg button').forEach(x=>x.classList.toggle('on',x.dataset.type==='all'));
 $$('.idxSlider').forEach(sl=>{sl.value=0;var c=$('#idxV_'+sl.dataset.k);if(c)c.textContent=idxDisplay(sl.dataset.k,0);});
 $('#combineMode').checked=false;const _o=$('#ownedToggle');if(_o)_o.checked=false;const _no=$('#notOwnedToggle');if(_no)_no.checked=false;$('#yearMin').value='';$('#yearMax').value='';
 buildGenreChips();buildRatingChips();syncAdvCount();refresh();
}
buildGenreChips();buildRatingChips();buildIndexSliders();
var PLAT_GROUPS=null;
function buildPlatSelect(){
 var u=a=>Array.from(new Set(a.filter(Boolean))).sort();
 PLAT_GROUPS=[
  {name:'Networks & Streamers',opts:u(tvShows.map(t=>t.networkStreamer))},
  {name:'Gaming Platforms',opts:u(videoGames.flatMap(g=>g.platformAvailability))},
  {name:'Film Studios',opts:u(movies.map(m=>m.studio))},
  {name:'Book Publishers',opts:u(books.map(b=>b.publisher))}
 ];
}
// Multi-select: picking a platform/network/studio no longer replaces the previous pick or closes
// the popup -- it toggles that one option on/off in state.plats (OR-matched, same "any selected"
// semantics as genre chips), so someone can build "A24 + Warner Bros." in one open/close cycle.
function renderPlatList(q){
 if(!PLAT_GROUPS)buildPlatSelect();
 q=(q||'').trim().toLowerCase();
 var listEl=$('#platCombo .rcList');if(!listEl)return;
 var html=state.plats.length?'<div class="rcOpt" data-v="__clear__" style="color:#fca5a5">\u2715 Clear selection ('+state.plats.length+')</div>':'';
 var any=false;
 PLAT_GROUPS.forEach(function(g){
  var matches=q?g.opts.filter(function(o){return o.toLowerCase().indexOf(q)>=0;}):g.opts;
  if(!matches.length)return;
  any=true;
  html+='<div class="rcOptGroup">'+esc(g.name)+'</div>';
  html+=matches.map(function(o){var sel=state.plats.indexOf(o)>=0;return '<div class="rcOpt'+(sel?' sel':'')+'" data-v="'+esc(o)+'" title="'+esc(o)+'">'+(sel?'\u2611 ':'\u2610 ')+esc(o)+'</div>';}).join('');
 });
 if(!any&&!html)html='<div class="rcEmpty">No platform matches \u201c'+esc(q)+'\u201d</div>';
 listEl.innerHTML=html;
}
function updatePlatLabel(){
 var lbl=$('#platCombo .rcLabel');if(!lbl)return;
 lbl.textContent=!state.plats.length?'Any platform / network / studio':state.plats.length===1?state.plats[0]:state.plats.length+' selected: '+state.plats.join(', ');
}
function togglePlat(v){
 if(v==='__clear__'){state.plats=[];}
 else{var i=state.plats.indexOf(v);if(i>=0)state.plats.splice(i,1);else state.plats.push(v);}
 updatePlatLabel();renderPlatList($('#platCombo .rcSearch')?$('#platCombo .rcSearch').value:'');refresh();
}
buildPlatSelect();
(function initPlatCombo(){
 var combo=$('#platCombo');if(!combo)return;
 var field=combo.querySelector('.rcField'),pop=combo.querySelector('.rcPop'),search=combo.querySelector('.rcSearch');
 function open(){closeAllCombos(combo);combo.classList.add('open');pop.classList.remove('hidden');lastComboOpenAt=Date.now();renderPlatList('');search.value='';setTimeout(function(){search.focus();},30);}
 function close(){combo.classList.remove('open');pop.classList.add('hidden');}
 field.addEventListener('click',function(e){e.stopPropagation();combo.classList.contains('open')?close():open();});
 field.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
 search.addEventListener('input',function(){renderPlatList(this.value);});
 search.addEventListener('keydown',function(e){if(e.key==='Escape'){close();field.focus();}else if(e.key==='Enter'){var f=combo.querySelector('.rcOpt');if(f){togglePlat(f.dataset.v);}}});
 combo.querySelector('.rcList').addEventListener('click',function(e){var opt=e.target.closest('.rcOpt');if(!opt)return;
  // togglePlat() re-renders .rcList's innerHTML synchronously, which detaches the clicked node
  // before this click finishes bubbling -- the shared outside-click-close listener on `document`
  // then sees a target with no `.radarCombo` ancestor to find (it's an orphaned node) and closes
  // the popup as if this had been a click outside it. stopPropagation keeps a pick from ever
  // reaching that listener, so the popup stays open across multiple picks as intended.
  e.stopPropagation();togglePlat(opt.dataset.v);});
 // Outside-click and Escape are handled once, for every .radarCombo including this one -- see the
 // shared closeAllCombos listener registered earlier in the script. No separate listener needed here.
})();
$('#headStats').innerHTML=[['Indexed Works',ALL.length],['Contenders',contenders.length]]
 .map(s=>'<div><div class="text-lg font-extrabold text-slate-50 leading-none tabular-nums">'+s[1]+'</div><div class="lbl mt-1">'+s[0]+'</div></div>').join('');
(function(){var lc=$('#luCount');if(lc){var m=ALL.filter(function(x){return x.kind==='movie'}).length,t=ALL.filter(function(x){return x.kind==='tv'}).length,g=ALL.filter(function(x){return x.kind==='game'}).length,b=ALL.filter(function(x){return x.kind==='book'}).length;lc.textContent=ALL.length+' works · '+m+' films / '+t+' series / '+g+' games / '+b+' books';}})();
var mi=$('#matrixIntro');if(mi)mi.textContent='Elite specialized brackets computed across the full '+ALL.length.toLocaleString()+'-work corpus (Global Controller filters intentionally ignored here so brackets stay canonical). Hover rows for full credits.';
on('#matrixOwnedOnly','change',e=>{matrixOwnedOnly=e.target.checked;renderMatrices();scheduleURLSync();});
var matrixNavSearchT=null;
on('#matrixNavSearch','input',e=>{clearTimeout(matrixNavSearchT);const v=e.target.value;matrixNavSearchT=setTimeout(()=>{matrixNavQ=v;renderMatrices();scheduleURLSync();},120);});
on('#matrixNav','click',e=>{const a=e.target.closest('.matrixNavLink');if(!a)return;e.preventDefault();const el=document.getElementById(a.dataset.anchor);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});});
renderMatrices();
renderCreators();
renderContenders();
document.addEventListener('click',e=>{const b=e.target.closest('.contMedBtn');if(b){contMedium=b.dataset.med;renderContenders();scheduleURLSync();}});
on('#contUnverifiedOnly','change',e=>{contUnverifiedOnly=e.target.checked;if(contUnverifiedOnly){contVerifiedOnly=false;var vcb=$('#contVerifiedOnly');if(vcb)vcb.checked=false;}renderContenders();});
on('#contVerifiedOnly','change',e=>{contVerifiedOnly=e.target.checked;if(contVerifiedOnly){contUnverifiedOnly=false;var ucb=$('#contUnverifiedOnly');if(ucb)ucb.checked=false;}renderContenders();});
document.addEventListener('click',e=>{const b=e.target.closest('.contSortBtn');if(b){contSort=b.dataset.sort;$$('.contSortBtn').forEach(function(x){x.classList.toggle('on',x===b);});renderContenders();scheduleURLSync();}});
let contSearchT=null;
on('#contSearch','input',e=>{clearTimeout(contSearchT);const v=e.target.value;contSearchT=setTimeout(()=>{contSearchQ=v;renderContenders();scheduleURLSync();},120);});
document.addEventListener('click',e=>{const b=e.target.closest('.contMigratedBtn');if(b){state.q=b.dataset.q;const qi=$('#q');if(qi)qi.value=b.dataset.q;switchView('controller');refresh();}});
renderGoat();
renderGoatSearchResults('');
$('#integrity').textContent='Integrity check · '+movies.length+' films · '+tvShows.length+' series · '+videoGames.length+' games · '+books.length+' books · '+directorsPantheon.length+' directors · '+authorsPantheon.length+' authors · '+gamingAuteurs.length+' auteurs · '+contenders.length+' contenders';
console.assert(movies.length>0&&tvShows.length>0&&videoGames.length>0&&books.length>0&&directorsPantheon.length>=1&&authorsPantheon.length>=1&&gamingAuteurs.length>=1&&contenders.length>=1,'Dataset integrity violation');
updateWlNav();
if(typeof syncBlendPanel==='function')syncBlendPanel();
/* ===================== COMMAND PALETTE (Cmd/Ctrl-K) ===================== */
var TAB_LABELS={controller:'Global Controller',goat:'GOAT Profile',portrait:'Taste Portrait',collection:'Collection',watchlist:'Watchlist',contenders:'Contenders Ledger',creators:'Creator Archives',matrix:'Reference Matrices',viz:'Visualization Suite',timeline:'Timeline'};
function focusWork(id){
 var it=byId.get(id);if(!it)return;
 clearAllFilters();
 state.q=it.title;var qi=$('#q');if(qi)qi.value=it.title;
 switchView('controller');refresh();
}
function focusCreator(name){
 switchView('viz');
 (window.requestAnimationFrame||setTimeout)(function(){renderGraph({type:'creator',key:name});var gw=$('#graphWrap');if(gw&&gw.scrollIntoView)gw.scrollIntoView({behavior:'smooth',block:'center'});});
}
function focusFamily(fam){
 clearAllFilters();
 state.genres=[fam];
 if(typeof buildGenreChips==='function')buildGenreChips();
 if(typeof syncAdvCount==='function')syncAdvCount();
 var ap=$('#advPanel');if(ap&&ap.classList.contains('hidden')){ap.classList.remove('hidden');var caret=$('#advCaret');if(caret)caret.style.transform='rotate(90deg)';}
 switchView('controller');refresh();
}
// Reliability: re-fit charts and the relationship graph on viewport resize / device rotation.
var _rzT;window.addEventListener('resize',function(){clearTimeout(_rzT);_rzT=setTimeout(function(){
 if(state.view==='viz'){['bubble','radar','decade'].forEach(function(k){if(CH[k]&&CH[k].resize)try{CH[k].resize();}catch(e){}});if(typeof graphCenter!=='undefined'&&graphCenter&&typeof renderGraph==='function')renderGraph(graphCenter,true);}
},200);});
(function(){
 var resume=null;try{resume=sessionStorage.getItem('omniLedgerResumeView');sessionStorage.removeItem('omniLedgerResumeView');}catch(e){}
 // resume (an internal post-action reload) wins over the URL (an actual bookmark/shared link) --
 // the two shouldn't collide in practice since resume only ever exists right after this app's own
 // reload calls, never on a fresh navigation, but resume is the more specific signal either way.
 var urlView=paramsToState();
 applyStateToStaticControls();
 var target=(resume&&document.querySelector('main > section[data-sec="'+resume+'"]'))?resume
  :(urlView&&document.querySelector('main > section[data-sec="'+urlView+'"]'))?urlView
  :'controller';
 switchView(target);
})();

 // Deliberate debug surface, and the last line of initApp().
 //
 // Before this file was wrapped in initApp(), every internal here was an accidental global --
 // several hundred names on window, because that is simply what a top-level <script> does. Scoping
 // them is the right default, but devtools and the regression suite both still need a way in. So
 // rather than leaking everything by accident, these few are exported on purpose: the corpus, the
 // live filter state, and the three entry points worth poking at from a console.
 window.tierTarget=tierTarget;window.TIER_FLOOR=TIER_FLOOR;
 window.computeMatch=computeMatch;window.activeDims=activeDims;window.certify=certify;
 window.provStampOf=provStampOf;
 window.buildGeneratedRec=buildGeneratedRec;
 window.ALL=ALL;
 window.byId=byId;
 window.state=state;
 window.PERSONAL_PROFILE=PERSONAL_PROFILE;
 window.filtered=filtered;
 window.refresh=refresh;
 window.switchView=switchView;
 window.CH=CH;
}
