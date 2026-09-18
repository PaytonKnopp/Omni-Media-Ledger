// The "Deep Index Battery" scoring engine, extracted out of initApp() in ledger-app.js.
//
// The hand-tuned override tables (PERF/ICON/SCARY/...) are static data, and lerpScore()/certify()
// take every input as a parameter -- none of it touches state/PERSONAL_PROFILE/ALL/DOM closure
// variables, so it is safe to load as an ordinary top-level script before app/ledger-app.js -- see
// ARCHITECTURE.md "Known limits". initApp()'s own `ALL.forEach(...)` passes still live inside
// initApp() (they read/write ALL, which is local to it); they just call these by name now, same as
// they'd call a data/*.js global.
'use strict';

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

const RATING_ORDER=['G','PG','PG-13','R','NC-17 / Unrated','TV-PG','TV-14','TV-MA','E','E10+','T','M','Nonfiction','Technical','General','Mature Readers','Verse'];

/* ---- Cross-medium reception normalization ----
   RUBRIC.md "Reception fields" / QUALITY_PASS.md defect E11: metrics.criticalScore and
   audienceScore are sourced from different aggregators per medium and are not the same scale --
   movies/TV track the RT Tomatometer (percent of critics positive; 14 films sit at exactly 100),
   games track Metacritic (a weighted mean; no game in the corpus exceeds 98), and books have no
   real aggregator at all. `gm`, `ovr` and every cross-medium sort/filter add these numbers
   together as if they were identical, so a 95 on a game and a 95 on a film are not measuring the
   same thing -- games' tighter, higher-centered distribution systematically outranks film's wider
   one with no taste signal involved.
   This corrects it once, at the source, rather than in each of the dozen places that reads
   x.crit/x.aud: each kind's values are converted to a z-score against that kind's own mean and
   spread, then mapped back onto the whole corpus's mean and spread. That preserves every work's
   standing *within its own medium* exactly (the transform is monotonic, so rank order inside a
   kind never changes) while putting all four mediums on one shared, comparable scale. Run once,
   on the adapter array, before anything derives from crit/aud -- the underlying data/*.js values
   (and their sourcing/provenance) are untouched; only the runtime scoring copy is adjusted. */
function normalizeReceptionByKind(all,field){
 function mean(a){return a.reduce((s,v)=>s+v,0)/a.length;}
 function sd(a,m){return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/a.length)||1;}
 const gVals=all.map(x=>x[field]),gMean=mean(gVals),gSd=sd(gVals,gMean);
 const byKind={};
 all.forEach(x=>{(byKind[x.kind]=byKind[x.kind]||[]).push(x);});
 Object.keys(byKind).forEach(k=>{
  const items=byKind[k],vals=items.map(x=>x[field]),m=mean(vals),s=sd(vals,m);
  items.forEach(x=>{x[field]=Math.max(0,Math.min(100,Math.round(gMean+((x[field]-m)/s)*gSd)));});
 });
}
