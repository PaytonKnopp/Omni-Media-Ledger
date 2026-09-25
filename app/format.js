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

/* Where a work's two reception numbers come from, worded for the cards (RUBRIC.md "Reception
   fields"). Film and TV audience scores are IMDb's user rating x10, stamped per record as
   metrics.audienceSrc (scripts/apply-imdb-audience.js); a work IMDb has no title for carries
   src:"estimated" and the reason. Every critic score, and games' and books' audience scores, are
   still best estimates -- no licensed source has been applied to them -- and the labels say so.
   The numbers on a card are the per-medium-normalised ones (normalizeReceptionByKind), so the
   IMDb label also gives the raw /10 rating the value was derived from. */
function receptionSourceOf(kind,audSrc,audRaw){
 var medium={movie:'films',tv:'series',game:'games',book:'books'}[kind]||'this medium';
 var crit={short:'est.',title:'Critics\u2019 score \u2014 a best estimate: no licensed critic source has been applied yet, for any medium. Put on one scale across films, series, games and books.'};
 var aud;
 if(audSrc&&audSrc.src==='IMDb'){
  var r=(audRaw/10).toFixed(1);
  aud={short:'IMDb',sourced:true,phrase:'IMDb '+r+'/10',
   title:'Audience score \u2014 IMDb user rating '+r+'/10 ('+audSrc.id+', retrieved '+audSrc.checked+'), shown on the app\u2019s shared per-medium scale'};
 }else if(audSrc&&audSrc.src==='estimated'){
  aud={short:'est.',sourced:false,phrase:'estimated',title:'Audience score \u2014 a best estimate: '+audSrc.why};
 }else{
  aud={short:'est.',sourced:false,phrase:'estimated',title:'Audience score \u2014 a best estimate: no audience source has been applied to '+medium+' yet'};
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
