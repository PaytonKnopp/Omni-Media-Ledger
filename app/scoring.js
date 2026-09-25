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
/* Two indices are film/TV/game constructs with no meaning for a book: Soundtrack and 4K Reference.
   A book still carries a number in each (the formulas fall back to its prose/idea craft), which is
   why a novel could read "Soundtrack 92". Anything that SHOWS, filters or ranks by one of these asks
   here first: a book is left off the card, fails a minimum filter on it, sorts last by it, and stays
   out of its matrix. The number itself is untouched, so nothing derived from it moves. */
const IDX_NOT_FOR_BOOKS=new Set(['snd','ref']);
function idxApplies(it,k){return !(it.kind==='book'&&IDX_NOT_FOR_BOOKS.has(k));}
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

/* ===================== PERSONAL TASTE MODEL =====================
   Everything below turns "what this person has told the app" -- a 0-10 rating, a Gold/Silver/
   Bronze tier, a work on their shelf -- into weights the GOAT Match pass can apply to the ~5,000
   works they have said nothing about. It is pure: every input is a parameter, nothing reads
   PERSONAL_PROFILE/ALL/state/DOM, so it loads as an ordinary top-level script (same contract as
   lerpScore/certify above) and can be reasoned about and tested on its own.

   The model it replaces summed a fixed weight per favorite (Gold 3 / Silver 2 / Bronze 1, plus
   (rating-5)*0.6) into a per-genre bucket and clamped the total at +/-15. That has four failure
   modes, and all four get worse the MORE someone uses the app, which is exactly backwards:

   1. A fixed 5/10 midpoint assumed people rate on a symmetric scale. They do not -- you mostly
      rate things you chose to watch/read, so real rating sets cluster at 7-10. Every genre then
      scored positive and none of them discriminated. Centring on the person's OWN distribution
      (shrunk toward a neutral prior while their sample is small) is what makes a 9 read as "much
      better than my usual" for one person and "about average for me" for another.
   2. Raw counting rewarded genres for being COMMON, not for being characteristic. Drama sits on
      a third of the corpus, so it accumulated the largest bucket for almost any profile and then
      boosted a third of the corpus back. A feature only tells you something if it is
      over-represented in what you like relative to how often it turns up at all -- that is what
      the prevalence lift below measures, and it is the half of the signal that still works for
      someone who has only ever marked things owned.
   3. A hard +/-15 clamp flattened everything past ~5 favorites into one indistinguishable ceiling.
      Shrinkage (n/(n+k)) does the job the clamp was reaching for -- it holds a thin signal back
      until there is evidence behind it -- without ever capping a well-evidenced one.
   4. Only genre and vibe were learned. Tiering three Kubrick films taught the app nothing about
      Kubrick, and nothing at all about the fact that what you keep choosing is dense, dread-heavy
      and slow. Creator affinity and per-axis affinity are both learned here now.

   The shape is the same for every feature: average the signed affinity of the works carrying it,
   measure it against this person's own baseline, mix in how over-represented it is versus the
   corpus, then shrink by how much evidence there actually is. More ratings/tiers/ownership always
   means more confident weights, never noisier ones. */

const TASTE_TIER_AFFINITY={gold:1,silver:0.7,bronze:0.45,owned:0.2};
/* A fresh profile with two ratings should not have its centre yanked to those two numbers, so the
   observed mean is shrunk toward a neutral 6.8 (roughly where "I liked it" sits on a 0-10 scale
   people actually use) with the weight of 4 imaginary ratings. */
const TASTE_RATING_PRIOR_MEAN=6.8,TASTE_RATING_PRIOR_N=4,TASTE_RATING_MIN_SPREAD=1.1;
/* n/(n+k): one favorite carrying a genre earns a quarter of the weight five do. */
const TASTE_SHRINK_K=3;
/* The baseline a feature is measured against is the person's mean affinity pulled partway toward
   zero. At full pull (1.0) a library of nothing but owned-but-untiered works would have every
   genre land exactly on the baseline and score zero -- which would throw away the one signal that
   person has given. At 0.7 mere ownership still says a quiet yes, while a Gold pick says a much
   louder one. */
const TASTE_BASELINE_PULL=0.7;
/* How much of a feature's weight comes from "this is over-represented in my library" rather than
   "I rate these highly". The first still works when someone has only marked things owned; the
   second is sharper once real ratings and tiers exist. */
const TASTE_PREVALENCE_MIX=0.4;
const TASTE_GENRE_SCALE=11,TASTE_VIBE_SCALE=9,TASTE_CREATOR_SCALE=13;
/* A favorite tagged "Cosmic Horror" is also evidence about Horror, just weaker evidence -- credit
   the tag's declared ancestors too, at a discount, so specific taste generalises up the taxonomy
   instead of only ever matching its own exact tag. */
const TASTE_ANCESTOR_CREDIT=0.6;
/* The six per-work quality boosts used to be identical for everyone: a comedy lover still earned
   the atmospheric-dread bonus. Each is now scaled by how much that axis actually characterises
   the person's favorites, between 0.4x and 1.6x. Never negative, so a boost stays monotonic in
   the index it reads (more dread can never earn less). */
const TASTE_AXIS_SPAN=0.6;
const TASTE_AXIS_FIELDS=['myst','tech','dread','warmth','comedy','beauty'];
/* Shared with the corpus-side creator index so a name splits the same way in both places. */
const CREATOR_SPLIT_RE=/,| and | & /;

/* Tone fit (see step 5 of buildTasteModel): the three constructs that mean the same thing in every
   medium. Ontological/systems complexity and beauty are left to the axis multipliers above --
   "complexity" is a different rubric construct for a game than for a book, and beauty is craft. */
const TASTE_TONE_FIELDS=['warmth','comedy','dread'];
/* Points of raw taste per unit of fit (affinity x within-medium z, summed over the three). A
   strongly shared tone lands near one well-evidenced genre; z is clamped to +/-2 so one extreme
   score on one axis cannot outweigh the rest of the match. */
const TASTE_TONE_SCALE=3;

/* ---- Closeness to specific favorites ("because you liked X") ----
   Everything above learns a DIRECTION: more of this genre, more comedy, less dread. A direction is
   shared by every work that points that way, so among the six hundred comedies in the corpus the
   genre boost is the same number for all of them and critical acclaim alone decided the order --
   which is why someone whose favorites are 10 Things I Hate About You and Army of Darkness was
   handed Singin' in the Rain and The Grand Budapest Hotel. What was missing is the oldest signal in
   recommendation: how close a work is to the particular things this person liked.
   Each work is compared with every work they rated above their own centre, tiered or own, on genre
   tags (weighted overlap, ancestors at TASTE_ANCESTOR_CREDIT), tone within its own medium (warmth,
   comedy, dread, complexity, beauty as z-scores), medium, creator, era and vibe. Its closeness is
   the mean of its `k` strongest like-weighted similarities, read as a z-score against the whole
   corpus, and it only ever ADDS: being unlike your other favorites is how an eclectic taste looks,
   not evidence against a work (penalising it sank The Shining and Outer Wilds in the PK Sample to
   the bottom third). The favorite a work is nearest to is kept, so its card can name it.
   Measured with scripts/rec-quality.js, and each setting chosen from a flat region, not a peak:
     k=2      one neighbour over-trusts a single favorite; three rewards being near a dense cluster
              (every LOTR and Dune entry) over being near one eclectic favorite, and cost the PK
              Sample its horror picks.
     fade=40  scaled by fade/(fade+favorites): decisive for a stranger with six picks, where the
              genre and creator tables cannot yet tell one comedy from another, and receding for a
              library of hundreds, where those tables already can.
     scale=6  points of raw taste at z=1 -- about one well-evidenced genre. */
const TASTE_NEIGHBOR={
 k:2,
 fields:['warmth','comedy','dread','myst','beauty'],
 w:{genre:0.40,tone:0.30,kind:0.10,creator:0.08,era:0.07,vibe:0.05},
 eraYears:20,
 zMax:4,
 fade:40,
 scale:6
};
/* ---- How much acclaim should count, for this person ----
   The objective half of a match (critical, audience and craft consensus) carried the same weight
   for everyone, which silently assumes everyone's favorites are the acclaimed canon. Measured on
   the test profiles, favorites sit this many standard deviations above the average title on that
   objective score: a literary-fiction reader 1.93, the PK Sample 1.12, a family-drama viewer 1.04,
   a cosy-games player 0.59, a comedy lover 0.12 (IMDb audience scores, 2026-09-25). For the last two, acclaim is a poor guide to what
   they love -- and it was the tie-breaker among every comedy or cosy game their taste made equal,
   so their lists led with Singin' in the Rain and Animal Crossing's most-reviewed neighbours rather
   than with anything like their own favorites.
   So the objective score's spread is scaled by where this person's evidence actually sits on it:
   the like-weighted mean z of their rated/tiered/owned works, shrunk toward `prior` (today's
   behaviour) with the weight of `k` imaginary works, then clamped to [min, max]. A blank profile
   and any profile whose favorites are as acclaimed as the canon keep today's weighting exactly;
   max is 1, so no profile ever leans on acclaim MORE than before. Rank within the objective score
   is untouched (a positive linear map), so only its pull against the personal half changes. */
const TASTE_ACCLAIM={prior:1,k:3,min:0.35,max:1};
function acclaimWeight(values,affinity){
 const n=values.length;
 if(!n||!affinity||!affinity.length)return 1;
 let m=0;for(let i=0;i<n;i++)m+=values[i];m/=n;
 let v=0;for(let i=0;i<n;i++)v+=(values[i]-m)*(values[i]-m);
 const sd=Math.sqrt(v/n)||1;
 let num=0,den=0;
 affinity.forEach(function(e){num+=e[1]*(values[e[0]]-m)/sd;den+=Math.abs(e[1]);});
 if(!(den>0))return 1;
 const z=(num+TASTE_ACCLAIM.prior*TASTE_ACCLAIM.k)/(den+TASTE_ACCLAIM.k);
 return z<TASTE_ACCLAIM.min?TASTE_ACCLAIM.min:z>TASTE_ACCLAIM.max?TASTE_ACCLAIM.max:z;
}
/* ---- Critics or crowds ----
   The objective score read critics at 0.5 and audiences at 0.2 for everyone. Some people's
   favorites are the critics' darlings; others' are crowd-pleasers the critics were cool on (10
   Things I Hate About You: audience 86, critics 69). How far this person's evidence leans one way
   is measured the same way as everything else -- the like-weighted mean z of (audience - critics),
   shrunk toward no lean -- and moves up to `span` of the 0.7 reception weight between the two.
   No evidence, or no lean, leaves 0.5/0.2 exactly. */
const TASTE_RECEPTION={crit:0.5,aud:0.2,span:0.2,k:3};
function receptionMix(all,affinity){
 const base={crit:TASTE_RECEPTION.crit,aud:TASTE_RECEPTION.aud};
 if(!affinity||!affinity.length)return base;
 const gap=all.map(function(x){return (x.aud||0)-(x.crit||0);});
 let m=0;gap.forEach(function(v){m+=v;});m/=gap.length;
 let v=0;gap.forEach(function(g){v+=(g-m)*(g-m);});
 const sd=Math.sqrt(v/gap.length)||1;
 let num=0,den=0;
 affinity.forEach(function(e){num+=e[1]*tasteClamp1((gap[e[0]]-m)/sd/2)*2;den+=Math.abs(e[1]);});
 if(!(den>0))return base;
 const lean=tasteClamp1(num/(den+TASTE_RECEPTION.k));
 const shift=lean*TASTE_RECEPTION.span;
 return {crit:base.crit-shift,aud:base.aud+shift};
}
/* The objective scores with their spread around the corpus mean scaled by acclaimWeight(). */
function weightAcclaim(values,w){
 if(w===1||!values.length)return values;
 let m=0;values.forEach(function(v){m+=v;});m/=values.length;
 return values.map(function(v){return m+(v-m)*w;});
}
/* Per-work features for neighborSim(), integer-coded so the comparison is a few tight loops:
   sorted genre-key ids with weights, sorted creator ids, tone z-scores (NaN where unscored), kind,
   vibe and year. None of it depends on the person, so it is built once per corpus and reused by
   every recompute (a tier click must stay fast: this compares every work with every liked one). */
let _nbFeatCache=null;
function neighborFeatures(all,tax){
 if(_nbFeatCache&&_nbFeatCache.all===all&&_nbFeatCache.n===all.length&&_nbFeatCache.tax===tax)return _nbFeatCache.feats;
 const F=TASTE_NEIGHBOR.fields;
 const stats=Object.create(null);
 all.forEach(function(x){
  const s=stats[x.kind]||(stats[x.kind]=Object.create(null));
  F.forEach(function(f){
   const v=x[f];if(typeof v!=='number'||!isFinite(v))return;
   const a=s[f]||(s[f]={n:0,s:0,q:0});a.n++;a.s+=v;a.q+=v*v;
  });
 });
 Object.keys(stats).forEach(function(k){
  F.forEach(function(f){
   const a=stats[k][f];if(!a||a.n<12){stats[k][f]=null;return;}
   const m=a.s/a.n;stats[k][f]={m:m,sd:Math.sqrt(Math.max(0,a.q/a.n-m*m))||1};
  });
 });
 const ids=new Map();
 const code=function(key){let c=ids.get(key);if(c===undefined){c=ids.size;ids.set(key,c);}return c;};
 const feats=all.map(function(x){
  const g=[];genreLearnKeys(x,tax).forEach(function(w,k){g.push([code('g:'+k),w]);});
  g.sort(function(p,q){return p[0]-q[0];});
  const gk=new Int32Array(g.length),gw=new Float64Array(g.length);let gTotal=0;
  g.forEach(function(e,i){gk[i]=e[0];gw[i]=e[1];gTotal+=e[1];});
  const cr=Int32Array.from(new Set(creatorTokens(x).map(function(n){return code('c:'+n);}))).sort();
  const tz=new Float64Array(F.length);
  F.forEach(function(f,i){
   const st=stats[x.kind]&&stats[x.kind][f],v=x[f];
   if(!st||typeof v!=='number'||!isFinite(v)){tz[i]=NaN;return;}
   const z=(v-st.m)/st.sd;tz[i]=z<-2?-2:z>2?2:z;
  });
  return {id:x.id,kind:code('k:'+x.kind),year:x.year||0,vibe:x.vibe?code('v:'+x.vibe):-1,gk:gk,gw:gw,gTotal:gTotal,cr:cr,tz:tz};
 });
 _nbFeatCache={all:all,n:all.length,tax:tax,feats:feats};
 return feats;
}
function neighborSim(a,b){
 const W=TASTE_NEIGHBOR.w;
 // Weighted Jaccard over genre keywords (both lists sorted): shared weight over combined weight.
 let inter=0;
 for(let i=0,j=0;i<a.gk.length&&j<b.gk.length;){
  const p=a.gk[i],q=b.gk[j];
  if(p===q){inter+=a.gw[i]<b.gw[j]?a.gw[i]:b.gw[j];i++;j++;}
  else if(p<q)i++;else j++;
 }
 const union=a.gTotal+b.gTotal-inter;
 let d2=0,n=0;
 for(let i=0;i<a.tz.length;i++){const d=a.tz[i]-b.tz[i];if(d===d){d2+=d*d;n++;}}
 let creator=0;
 for(let i=0,j=0;i<a.cr.length&&j<b.cr.length;){
  const p=a.cr[i],q=b.cr[j];
  if(p===q){creator=1;break;}
  if(p<q)i++;else j++;
 }
 const dy=a.year>b.year?a.year-b.year:b.year-a.year;
 return W.genre*(union>0?inter/union:0)+W.tone*(n?1/(1+d2/n):0)+W.kind*(a.kind===b.kind?1:0)
  +W.creator*creator+W.era*(dy<ERA_DECAY.length?ERA_DECAY[dy]:0)+W.vibe*(a.vibe>=0&&a.vibe===b.vibe?1:0);
}
/* exp(-years/eraYears) for 0..400 years apart; beyond that the era term is nil anyway. */
const ERA_DECAY=(function(){const t=new Float64Array(401);for(let i=0;i<t.length;i++)t[i]=Math.exp(-i/TASTE_NEIGHBOR.eraYears);return t;})();
/* id -> {fit, near, nearSim, nearSame}: fit in raw taste points (never negative); near = the liked work
   it is closest to, nearSim how alike they are (0-1), nearSame whether it is the same medium. */
function buildNeighborFit(all,ev,tax){
 const out=new Map();
 // Strongest evidence first, so the scan below can stop as soon as no remaining work could enter
 // the top K (similarity is at most 1, so aff is an upper bound on what a work can contribute).
 const pos=ev.filter(function(e){return e.aff>0;}).sort(function(p,q){return q.aff-p.aff;});
 if(!pos.length)return out;
 const feats=neighborFeatures(all,tax);
 const fById=new Map(feats.map(function(f){return [f.id,f];}));
 const pf=pos.map(function(e){return fById.get(e.x.id);});
 const pa=pos.map(function(e){return e.aff;}),pid=pos.map(function(e){return e.x.id;});
 const K=TASTE_NEIGHBOR.k,P=pf.length;
 const raw=new Float64Array(feats.length),near=new Array(feats.length);
 const top=new Float64Array(K),topAt=new Int32Array(K);
 feats.forEach(function(f,i){
  // The K largest like-weighted similarities, kept in descending order without sorting.
  for(let t=0;t<K;t++){top[t]=0;topAt[t]=-1;}
  for(let j=0;j<P;j++){
   if(pa[j]<=top[K-1])break; // exact: nothing further down can beat what is already held
   const pj=pf[j];
   if(pj===f)continue; // never its own neighbour: a favorite is measured against the others
   const v=pa[j]*neighborSim(f,pj);
   if(v<=top[K-1])continue;
   let t=K-1;
   while(t>0&&v>top[t-1]){top[t]=top[t-1];topAt[t]=topAt[t-1];t--;}
   top[t]=v;topAt[t]=j;
  }
  let sum=0;for(let t=0;t<K;t++)sum+=top[t];
  raw[i]=sum/K;
  // The favorite to name on the card: the strongest neighbour, with how alike the two actually are
  // (unweighted by affinity) and whether it is the same medium -- a card saying a horse-racing book
  // "is a lot like Super Mario 64" would be a claim no reader believes, even where the cross-medium
  // pull on the score is real.
  near[i]=topAt[0]>=0?{id:pid[topAt[0]],sim:neighborSim(f,pf[topAt[0]]),same:pf[topAt[0]].kind===f.kind}:null;
 });
 let m=0;for(let i=0;i<raw.length;i++)m+=raw[i];m/=raw.length;
 let v=0;for(let i=0;i<raw.length;i++)v+=(raw[i]-m)*(raw[i]-m);
 const sd=Math.sqrt(v/raw.length)||1;
 const n=pos.length;
 const weight=n/(n+TASTE_SHRINK_K)*TASTE_NEIGHBOR.fade/(TASTE_NEIGHBOR.fade+n)*TASTE_NEIGHBOR.scale;
 feats.forEach(function(f,i){
  const z=Math.min(TASTE_NEIGHBOR.zMax,Math.max(0,(raw[i]-m)/sd));
  out.set(f.id,{fit:z*weight,near:near[i]&&near[i].id,nearSim:near[i]?near[i].sim:0,nearSame:!!(near[i]&&near[i].same)});
 });
 return out;
}

function tasteClamp1(v){return v<-1?-1:v>1?1:v;}
function toneZ(x,f,stats){
 const s=stats[x.kind]&&stats[x.kind][f],v=x[f];
 if(!s||typeof v!=='number'||!isFinite(v))return null;
 const z=(v-s.m)/s.sd;
 return z<-2?-2:z>2?2:z;
}
/* One work's tone fit against a model from buildTasteModel(): signed, 0 with no evidence. */
function toneFit(x,model){
 let t=0;
 TASTE_TONE_FIELDS.forEach(function(f){
  const a=model.tone[f];if(!a)return;
  const z=toneZ(x,f,model.toneStats);if(z!=null)t+=a*z;
 });
 return t*TASTE_TONE_SCALE;
}
function creatorTokens(x){
 return String((x&&x.creator)||'').split(CREATOR_SPLIT_RE).map(function(s){return s.trim();}).filter(function(s){return s.length>2;});
}
/* Every genre keyword a work matches, lowercased: its own tags plus everything they declare they
   inherit from. Exactly the set genreMatches() tests one keyword at a time, precomputed once so
   the per-work scoring pass can look boosts up instead of re-walking the taxonomy for each of
   them (275 possible keywords x 5,000 works is not a loop to run on every tier click). */
function genreMatchKeys(x,tax){
 const out=new Set();
 (x.genres||[]).forEach(function(tag){
  const inh=(tax&&tax[tag])||[tag];
  inh.forEach(function(p){out.add(String(p).toLowerCase());});
 });
 return out;
}
/* The same keywords, but weighted for LEARNING rather than matching: a work's own tag counts
   fully, an ancestor it merely inherits counts at TASTE_ANCESTOR_CREDIT. Keyed by the taxonomy's
   own spelling so the weights it produces read as "Cosmic Horror", not "cosmic horror", wherever
   the UI shows them back. */
function genreLearnKeys(x,tax){
 const m=new Map();
 (x.genres||[]).forEach(function(tag){
  const inh=(tax&&tax[tag])||[tag];
  inh.forEach(function(p){if(!(m.get(p)>=TASTE_ANCESTOR_CREDIT))m.set(p,TASTE_ANCESTOR_CREDIT);});
  m.set(tag,1);
 });
 return m;
}
function creatorLearnKeys(x){
 const m=new Map();
 creatorTokens(x).forEach(function(nm){m.set(nm,1);});
 return m;
}
function vibeLearnKeys(x){
 const m=new Map();
 if(x&&x.vibe)m.set(x.vibe,1);
 return m;
}

/* Builds the whole model in one pass over the corpus.
     all      -- the adapter array (reads .id/.genres/.vibe/.creator/.owned and the axis fields)
     ratings  -- {id: 0-10}
     gold/silver/bronze -- Sets of ids
     taxonomy -- GENRE_TAXONOMY
   Returns plain data: {genre, vibe, creator} keyword->weight maps in the same units as the
   hand-set PERSONAL_PROFILE.genreBoost entries (a strong, well-evidenced genre lands near +9,
   a hand-set one is 3-6), an axisMul map, and the evidence count. */
function buildTasteModel(all,opts){
 opts=opts||{};
 const ratings=opts.ratings||{};
 const gold=opts.gold||new Set(),silver=opts.silver||new Set(),bronze=opts.bronze||new Set();
 const tax=opts.taxonomy||{};

 /* --- 1. Where this person's ratings actually sit --- */
 const rv=[];
 Object.keys(ratings).forEach(function(id){const v=ratings[id];if(typeof v==='number'&&isFinite(v))rv.push(v);});
 const rn=rv.length;
 const rawMean=rn?rv.reduce(function(s,v){return s+v;},0)/rn:TASTE_RATING_PRIOR_MEAN;
 const centre=(rawMean*rn+TASTE_RATING_PRIOR_MEAN*TASTE_RATING_PRIOR_N)/(rn+TASTE_RATING_PRIOR_N);
 const variance=rn>1?rv.reduce(function(s,v){return s+(v-rawMean)*(v-rawMean);},0)/(rn-1):0;
 const spread=Math.max(TASTE_RATING_MIN_SPREAD,Math.sqrt(variance));

 /* --- 2. One signed affinity per evidenced work, in [-1,+1] ---
    A rating is read two ways at once and blended: RELATIVE to this person's own centre (which is
    what makes an 8 mean different things to a generous and a stingy rater) and ABSOLUTE against a
    fixed 6/10 midpoint (which is what keeps "I rated all forty of these a 9" reading as a wall of
    yes rather than as forty works of merely average interest). A tier on the same work nudges the
    result; a rating always outweighs it, because typing a number is the more deliberate act. */
 const ev=[];
 all.forEach(function(x,i){
  const r=ratings[x.id];
  const rated=typeof r==='number'&&isFinite(r);
  const tier=gold.has(x.id)?'gold':silver.has(x.id)?'silver':bronze.has(x.id)?'bronze':(x.owned?'owned':null);
  if(!rated&&!tier)return;
  let aff;
  if(rated){
   aff=tasteClamp1(((r-centre)/(spread*1.4))*0.55+((r-6)/3)*0.45);
   if(tier)aff=aff*0.65+TASTE_TIER_AFFINITY[tier]*0.35;
  }else aff=TASTE_TIER_AFFINITY[tier];
  ev.push({x:x,aff:tasteClamp1(aff),i:i});
 });

 const N=ev.length;
 const meanAff=N?ev.reduce(function(s,e){return s+e.aff;},0)/N:0;
 const baseline=meanAff*TASTE_BASELINE_PULL;
 const posTotal=ev.reduce(function(s,e){return s+Math.max(0,e.aff);},0)||1;
 const corpusN=all.length||1;

 /* --- 3. One table per feature kind --- */
 function buildTable(keysOf,scale){
  const corpusCount=Object.create(null);
  all.forEach(function(x){keysOf(x,tax).forEach(function(w,k){corpusCount[k]=(corpusCount[k]||0)+1;});});
  const acc=Object.create(null);
  ev.forEach(function(e){
   keysOf(e.x,tax).forEach(function(w,k){
    const a=acc[k]||(acc[k]={n:0,s:0,p:0});
    a.n+=w;a.s+=w*e.aff;a.p+=w*Math.max(0,e.aff);
   });
  });
  const out=Object.create(null);
  Object.keys(acc).forEach(function(k){
   const a=acc[k];
   if(a.n<=0)return;
   // How much better than this person's own baseline the works carrying this feature score.
   const liftAff=a.s/a.n-baseline;
   // How over-represented the feature is in what they like, versus the corpus at large. log2 of
   // the ratio, halved and clamped, so "four times as common as usual" saturates at +1 instead of
   // letting one rare tag on two favorites outrun everything.
   const mine=a.p/posTotal,theirs=(corpusCount[k]||0)/corpusN;
   const liftPrev=theirs>0?tasteClamp1(Math.log(( mine+1e-4)/(theirs+1e-4))/Math.LN2/2):0;
   const shrink=a.n/(a.n+TASTE_SHRINK_K);
   out[k]=(liftAff*(1-TASTE_PREVALENCE_MIX)+liftPrev*TASTE_PREVALENCE_MIX)*shrink*scale;
  });
  return out;
 }

 /* --- 4. Per-axis affinity ---
    How far the person's favorites sit from the corpus mean on each scored construct, in standard
    deviations, weighted by how much they liked each one and shrunk by how much evidence there is.
    z is clamped to +/-1 before shrinking, so one extraordinary outlier cannot swing an axis. */
 const axis=Object.create(null),axisMul=Object.create(null);
 TASTE_AXIS_FIELDS.forEach(function(f){
  const vals=[];
  all.forEach(function(x){const v=x[f];if(typeof v==='number'&&isFinite(v))vals.push(v);});
  if(vals.length<10){axis[f]=0;axisMul[f]=1;return;}
  const m=vals.reduce(function(s,v){return s+v;},0)/vals.length;
  const sd=Math.sqrt(vals.reduce(function(s,v){return s+(v-m)*(v-m);},0)/vals.length)||1;
  let num=0,den=0;
  ev.forEach(function(e){
   const v=e.x[f];
   if(typeof v!=='number'||!isFinite(v))return;
   num+=e.aff*((v-m)/sd);den+=Math.abs(e.aff);
  });
  const z=den>0?tasteClamp1(num/den):0;
  axis[f]=z*(den/(den+TASTE_SHRINK_K));
  axisMul[f]=1+TASTE_AXIS_SPAN*axis[f];
 });

 /* --- 5. Tone: how warm, how funny, how dark ---
    The axis multipliers above can only ever scale a bonus UP from zero, so a person whose
    favorites are all gentle still hands every dread-soaked work a (smaller) dread bonus, and
    nothing about tone ever reaches a medium they have not tiered in: a cosy-games player's Books
    list was Blood Meridian. Tone is the one thing RUBRIC.md scores the same way in every medium,
    so it is what should carry taste across them. Each work is placed within its OWN medium
    (a z-score against that medium's mean and spread, since games and books sit on different
    parts of every scale), the person's affinity per construct is the like-weighted mean of their
    evidence's placement, shrunk like every other weight, and the fit is signed: a work pointing
    the way their favorites point gains, one pointing the other way loses. */
 const toneStats=Object.create(null);
 all.forEach(function(x){
  const s=toneStats[x.kind]||(toneStats[x.kind]=Object.create(null));
  TASTE_TONE_FIELDS.forEach(function(f){
   const v=x[f];if(typeof v!=='number'||!isFinite(v))return;
   const a=s[f]||(s[f]={n:0,s:0,q:0});a.n++;a.s+=v;a.q+=v*v;
  });
 });
 Object.keys(toneStats).forEach(function(k){
  TASTE_TONE_FIELDS.forEach(function(f){
   const a=toneStats[k][f];if(!a)return;
   if(a.n<12){toneStats[k][f]=null;return;}
   const m=a.s/a.n;
   toneStats[k][f]={m:m,sd:Math.sqrt(Math.max(0,a.q/a.n-m*m))||1};
  });
 });
 const tone=Object.create(null);
 TASTE_TONE_FIELDS.forEach(function(f){
  let num=0,den=0;
  ev.forEach(function(e){
   const z=toneZ(e.x,f,toneStats);
   if(z==null)return;
   num+=e.aff*z;den+=Math.abs(e.aff);
  });
  tone[f]=den>0?tasteClamp1(num/den)*(den/(den+TASTE_SHRINK_K)):0;
 });

 return {
  tone:tone,toneStats:toneStats,
  neighbor:buildNeighborFit(all,ev,tax),
  // [index into `all`, signed affinity] per evidenced work, for acclaimWeight().
  affinity:ev.map(function(e){return [e.i,e.aff];}),
  evidence:N,ratingCentre:centre,ratingSpread:spread,
  genre:buildTable(genreLearnKeys,TASTE_GENRE_SCALE),
  vibe:buildTable(vibeLearnKeys,TASTE_VIBE_SCALE),
  creator:buildTable(creatorLearnKeys,TASTE_CREATOR_SCALE),
  axis:axis,axisMul:axisMul
 };
}

/* ---- Cross-medium fairness for the OBJECTIVE half of GOAT Match ----
   normalizeReceptionByKind() above already puts criticalScore/audienceScore on one scale, for
   exactly the reason restated here: a 95 sourced from Metacritic and a 95 sourced from the
   Tomatometer are not the same claim. The same is true of everything else the objective half of
   the match score is built from -- `tech` is disc transfer/audio/cinematography for a film,
   engine-and-art-direction for a game and prose-craft/idea-density for a book, and the rubric
   indices (ontological complexity, aesthetic beauty, dread) are scored within each medium's own
   conventions too. Left alone, books swept the top of every cross-medium recommendation list on
   any profile, because "objectively excellent book" and "objectively excellent game" were being
   compared as if the numbers meant the same thing.
   Rather than rewrite the displayed fields (a film's Technical Craft has to keep agreeing with
   the Transfer/Audio/Cinematography figures printed beside it), the fix is applied once to the
   combined objective SCORE, which nothing displays on its own: each medium's objective scores are
   mapped onto the corpus-wide mean and spread. Rank inside a medium is untouched -- the transform
   is monotonic -- so what changes is only which medium's works are eligible to sit at the top of a
   shared list, and that is then decided by the personal-taste half instead of by which aggregator
   a number came from. */
function normalizeObjectiveByKind(all,values){
 function mean(a){return a.reduce(function(s,v){return s+v;},0)/a.length;}
 function sd(a,m){return Math.sqrt(a.reduce(function(s,v){return s+(v-m)*(v-m);},0)/a.length)||1;}
 if(!values.length)return values;
 const gMean=mean(values),gSd=sd(values,gMean);
 const idxByKind={};
 all.forEach(function(x,i){(idxByKind[x.kind]=idxByKind[x.kind]||[]).push(i);});
 const out=values.slice();
 Object.keys(idxByKind).forEach(function(k){
  const idx=idxByKind[k];
  if(idx.length<12)return; // too few to estimate a distribution from; leave them on the raw scale
  const vals=idx.map(function(i){return values[i];});
  const m=mean(vals),s=sd(vals,m);
  idx.forEach(function(i){out[i]=gMean+((values[i]-m)/s)*gSd;});
 });
 return out;
}

/* ---- GOAT Match calibration ----
   "Anything in the nineties has to be a strong, strong match, then it goes down logically."
   That is a statement about the DISTRIBUTION of the score, and it cannot be guaranteed by an
   additive formula with a clamp: raise the weight of the personal-taste term (which is the whole
   point of a personal match score) and works pile up against the 99 ceiling, losing exactly the
   differentiation at the top that the number exists to provide; leave it low and the top of
   everyone's list is just the corpus's best-reviewed works in the same order.
   So the raw score is mapped through a monotone curve anchored on the corpus's own quantiles:
   the median lands near 68, the top decile clears 85, the top 3% reach the nineties and the top
   half-percent the high nineties. Order is preserved exactly (it is a monotone remap, so nothing
   overtakes anything), but the bands now MEAN something, and they keep meaning it as works are
   added -- a quantile is scale-free, so a corpus of 5,000 and one of 50,000 both put "in the
   nineties" at the same place: the top few percent of matches for that person. */
const GM_FLOOR=40,GM_CEIL=99;
const GM_MEDIAN_TARGET=68;
const GM_ANCHORS=[[0,40],[0.25,58],[0.5,GM_MEDIAN_TARGET],[0.75,78],[0.9,85],[0.97,91],[0.995,96],[1,99]];
/* How much evidence it takes before the top of the scale is allowed to mean its full strength.
   A quantile curve is relative, so on its own it would stretch ANY profile's best raw scores to
   the high nineties -- including a profile that has rated nothing, tiered nothing and owns
   nothing, where "99" would be a claim about a person the app has never been told anything about.
   The band above the median is compressed toward it while evidence is thin and relaxes to its
   full range as ratings, tiers and shelved works accumulate: a brand-new profile's best
   suggestions top out in the low nineties (still the best guess available, honestly labelled as a
   guess), and a well-fed one reaches the high nineties it has earned. Below the median nothing is
   compressed -- "this is not for you" needs no evidence to be worth saying. */
const GM_CONFIDENCE_HALF=60,GM_MIN_TOP_SPAN=0.82;
function buildScoreCurve(raws,evidence){
 const flat=function(v){return Math.max(GM_FLOOR,Math.min(GM_CEIL,Math.round(v)));};
 const s=raws.filter(function(v){return typeof v==='number'&&isFinite(v);}).sort(function(a,b){return a-b;});
 if(s.length<40)return flat; // too small a sample to read quantiles off; leave the raw scale alone
 const n=(typeof evidence==='number'&&evidence>0)?evidence:0;
 const span=GM_MIN_TOP_SPAN+(1-GM_MIN_TOP_SPAN)*(n/(n+GM_CONFIDENCE_HALF));
 const q=function(p){
  const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return s[lo]+(s[hi]-s[lo])*(i-lo);
 };
 const pts=[];
 GM_ANCHORS.forEach(function(a){
  const x=q(a[0]);
  const t=a[1]>GM_MEDIAN_TARGET?GM_MEDIAN_TARGET+(a[1]-GM_MEDIAN_TARGET)*span:a[1];
  if(!pts.length||x>pts[pts.length-1][0]+1e-9)pts.push([x,t]);
 });
 if(pts.length<2)return flat;
 // Linear between anchors, and linear along the end segments' slope outside them -- so a
 // hypothetical score below the corpus minimum (the boost-free baseline shown in a card's "why
 // this match" breakdown is one) still lands somewhere sensible instead of collapsing onto 40.
 function at(v){
  if(!isFinite(v))return GM_FLOOR;
  if(v<=pts[0][0]){
   const a=pts[0],b=pts[1];
   return a[1]+(v-a[0])*(b[1]-a[1])/(b[0]-a[0]);
  }
  for(let i=1;i<pts.length;i++){
   if(v<=pts[i][0]){
    const a=pts[i-1],b=pts[i];
    return a[1]+(v-a[0])*(b[1]-a[1])/(b[0]-a[0]);
   }
  }
  const a=pts[pts.length-2],b=pts[pts.length-1];
  return b[1]+(v-b[0])*(b[1]-a[1])/(b[0]-a[0]);
 }
 return function(v){return Math.max(GM_FLOOR,Math.min(GM_CEIL,Math.round(at(v))));};
}
