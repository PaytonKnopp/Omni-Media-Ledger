// Pure provenance/format-normalization helpers, extracted out of initApp() in ledger-app.js.
//
// Everything here is closure-independent: it takes its inputs as plain parameters (or is itself
// a constant lookup table) and touches no state/PERSONAL_PROFILE/DOM closure variable, so it is
// safe to load as an ordinary top-level script before app/ledger-app.js -- see ARCHITECTURE.md
// "Known limits". initApp() still calls these by name; being declared at top level just makes
// them ordinary global functions that its own closure can see, same as the data/*.js globals.
'use strict';

/* Provenance is a per-record stamp, never inferred from a record's ID or from whether the shelf
   holds a copy. Owning a disc verifies that it is owned; it verifies nothing about the runtime
   printed on the back. A record whose facts have been checked against sources carries
   prov:{facts,checked,src,indices}; everything else is an unverified estimate and says so.
   See QUALITY_PASS.md decision 13. */
const PROV_FACTS=['sourced','estimated','edition-dependent','corroborated'];
const PROV_INDICES=['rubric-v1','unscored'];
function provStampOf(raw){
 const s=(raw&&typeof raw==='object')?raw:{};
 return {facts:PROV_FACTS.indexOf(s.facts)>=0?s.facts:'estimated',
         indices:PROV_INDICES.indexOf(s.indices)>=0?s.indices:'unscored',
         checked:s.checked||null,src:s.src||null};
}

/* Works removed from the corpus as duplicates of another record, and the record each one became.
   The shared-IMDb-title check (scripts/validate-corpus.js) found ten films/series entered twice
   under two ids, and a later title/creator pass nineteen games and books; each pair kept the record with the stronger fact provenance, the lower id on a
   tie. A saved profile, watchlist or cloud row can still carry a retired id, so remapRetiredIds()
   moves whatever it held onto the kept record at boot. Never reuse a retired id for a new work. */
const RETIRED_WORK_IDS={
 m1942:'m47',   // Heat (1995)                -> Heat
 m1949:'m68',   // Drive (2011)               -> Drive
 m1582:'m127',  // Twelve Angry Men           -> 12 Angry Men
 m1834:'m345',  // 12 Monkeys                 -> Twelve Monkeys
 m1944:'m747',  // The Ladykillers (1955)     -> The Ladykillers
 m1982:'m1214', // Hairspray (2007)           -> Hairspray
 m1941:'m1286', // The Italian Job (1969)     -> The Italian Job
 m1948:'m1547', // Gone in 60 Seconds (2000)  -> Gone in 60 Seconds
 m1940:'m1810', // The Color Purple (1985)    -> The Color Purple
 t140:'t357',   // Demon Slayer               -> Demon Slayer: Kimetsu no Yaiba
 // A second pass (2026-09-25) over all four media: same medium, year and creator, and the same
 // title up to a "(novel)" qualifier, an article, a numeral or a spelling variant.
 g473:'g290',    // Abzu -> ABZÛ
 g402:'g40',     // Alan Wake II -> Alan Wake 2
 b142:'b1270',   // The Martian (book) -> The Martian
 b1201:'b208',   // The Grapes of Wrath -> The Grapes of Wrath
 b1553:'b229',   // The Long Goodbye -> The Long Goodbye
 b1204:'b311',   // Station Eleven -> Station Eleven
 b1350:'b328',   // A Clockwork Orange -> A Clockwork Orange
 b1264:'b407',   // Life of Pi -> Life of Pi
 b410:'b1183',   // Gone Girl (novel) -> Gone Girl
 b1557:'b440',   // Strangers on a Train -> Strangers on a Train
 b1233:'b465',   // The Girl with the Dragon Tattoo -> The Girl with the Dragon Tattoo
 b1764:'b685',   // Adventures of Huckleberry Finn -> The Adventures of Huckleberry Finn
 b2006:'b1428',  // Purity (Franzen) -> Purity
 b2010:'b1639',  // North and South (Elizabeth Gaskell) -> North and South
 b1747:'b1386',  // George's Marvelous Medicine -> George's Marvellous Medicine
 b1819:'b1633',  // The Case-Book of Sherlock Holmes -> The Casebook of Sherlock Holmes
 b1318:'b1036',  // Quiet -> Quiet: The Power of Introverts in a World That Can't Stop Talking
 b1176:'b406',   // Howl -> Howl and Other Poems
 b214:'b1175'    // The Waste Land and Other Poems -> The Waste Land
};
/* Rewrites retired ids in a profile and a watchlist (both plain objects; neither is mutated).
   Lists are remapped and de-duplicated in place of the old entry; for keyed maps (ratings,
   ownership, watchlist entries) the kept record's own value wins when both are present, since it
   is the one the app has been showing. Returns {profile, watchlist, changed}. */
function remapRetiredIds(profile,watchlist,retired){
 retired=retired||RETIRED_WORK_IDS;
 var changed=false;
 function list(a){
  if(!Array.isArray(a))return a;
  var out=[],seen={};
  a.forEach(function(id){
   var to=Object.prototype.hasOwnProperty.call(retired,id)?retired[id]:id;
   if(to!==id)changed=true;
   if(seen[to])return;
   seen[to]=1;out.push(to);
  });
  return out;
 }
 function keyed(o){
  if(!o||typeof o!=='object'||Array.isArray(o))return o;
  var out={};
  Object.keys(o).forEach(function(id){if(!Object.prototype.hasOwnProperty.call(retired,id))out[id]=o[id];});
  Object.keys(o).forEach(function(id){
   if(!Object.prototype.hasOwnProperty.call(retired,id))return;
   changed=true;
   if(!Object.prototype.hasOwnProperty.call(out,retired[id]))out[retired[id]]=o[id];
  });
  return out;
 }
 var p=profile&&typeof profile==='object'?Object.assign({},profile):profile;
 if(p&&typeof p==='object'){
  ['declaredGoatIds','silverTierIds','bronzeTierIds','ownedGameIds','cosmicHorrorDeclaredIds'].forEach(function(k){if(k in p)p[k]=list(p[k]);});
  ['ratings','ownedMedia','ownedBooksExtra'].forEach(function(k){if(k in p)p[k]=keyed(p[k]);});
 }
 var wl=keyed(watchlist);
 return {profile:p,watchlist:wl,changed:changed};
}

/* Where a work's two reception numbers come from, worded for the cards (RUBRIC.md "Reception
   fields"). Film and TV audience scores are IMDb's user rating x10, stamped per record as
   metrics.audienceSrc (scripts/apply-imdb-audience.js); a work IMDb has no title for carries
   src:"estimated" and the reason. Every critic score, and games' and books' audience scores, are
   still best estimates -- no licensed source has been applied to them -- and the labels say so.
   The numbers on a card are the per-medium-normalised ones (normalizeReceptionByKind), so the
   IMDb label also gives the raw /10 rating the value was derived from. */
function receptionSourceOf(kind,audSrc,audRaw){
 var medium={movie:'films',tv:'series',game:'games',book:'books'}[kind]||'this medium';
 var crit={title:'Critics\u2019 score \u2014 a best estimate: no licensed critic source has been applied yet, for any medium. Put on one scale across films, series, games and books.'};
 var aud;
 if(audSrc&&audSrc.src==='IMDb'){
  var r=(audRaw/10).toFixed(1);
  aud={sourced:true,phrase:'IMDb '+r+'/10',
   title:'Audience score \u2014 IMDb user rating '+r+'/10 ('+audSrc.id+', retrieved '+audSrc.checked+'), shown on the app\u2019s shared per-medium scale'};
 }else if(audSrc&&audSrc.src==='estimated'){
  aud={sourced:false,phrase:'estimated',title:'Audience score \u2014 a best estimate: '+audSrc.why};
 }else{
  aud={sourced:false,phrase:'estimated',title:'Audience score \u2014 a best estimate: no audience source has been applied to '+medium+' yet'};
 }
 return {crit:crit,aud:aud};
}

/* One canonical vocabulary for physical editions, applied once at load so every downstream
   reader (Collection groups, the per-item picker, the Upgrade Audit, Series cards, export)
   sees the same spellings no matter which era of the profile format wrote them:
     Softcover  -> Paperback   (the word actually meant)
     Boxed Set  -> Box Set
     BD/DVD     -> Blu-ray     (there is no combo edition; a combo pack is a Blu-ray)
     Deluxe     -> Hardcover on a book, Box Set on a disc (retired as an edition of its own)
   The default profile below no longer writes any of these -- not BD/DVD, Deluxe, Boxed Set or
   Softcover -- so a fresh account never picks one up; the aliases exist purely for profiles
   saved before this change. Normalizing on read rather
   than rewriting stored profiles keeps old exports and cloud rows loading correctly forever. */
const PHYS_FORMAT_ALIASES={'softcover':'Paperback','soft cover':'Paperback','boxed set':'Box Set','boxset':'Box Set','box-set':'Box Set','bd/dvd':'Blu-ray','blu-ray/dvd':'Blu-ray','blu ray':'Blu-ray','bluray':'Blu-ray','uhd':'4K','4k uhd':'4K','deluxe':'Deluxe','deluxe / illustrated':'Deluxe','collector\'s edition':'Deluxe','owned':null};
function normPhysFormat(kind,f){
 if(!f)return null;
 var key=String(f).trim().toLowerCase();
 var mapped=Object.prototype.hasOwnProperty.call(PHYS_FORMAT_ALIASES,key)?PHYS_FORMAT_ALIASES[key]:String(f).trim();
 if(!mapped)return null;
 // Deluxe is not an edition you can own any more, in any medium. A saved profile that still
 // says so resolves to the nearest edition that IS pickable: the durable copy for a book, the
 // boxed edition for a disc. Nothing renders the word.
 if(mapped==='Deluxe')return (kind==='book')?'Hardcover':'Box Set';
 return mapped;
}
