// Merging two copies of one person's saved data, title by title, as a pure module: nothing here
// touches the page, storage or the network. account-sync (index.html) hands it the stored strings
// and gets strings back, and test/sync-merge.js holds it to the cases that used to lose data.
//
// Why it exists: the cloud copy used to be replaced wholesale by whichever device wrote last, and
// a device holding unsynced edits won outright on its next load. So one edit made on an offline
// phone silently erased everything done on the laptop in the meantime, and two open tabs erased
// each other's changes. Now every edit records WHEN each title (or setting) changed -- the edits
// map, kept under its own synced key -- and two copies merge path by path: the newer edit of a
// title wins, and edits to different titles both survive.
//
// Loaded before account-sync in index.html (its storage hook calls in here from the first write).
'use strict';

const SYNC_EDITS_KEY='omniLedgerEdits';
/* How long an edit's timestamp is kept. It only matters while two copies might still disagree about
   that title; past this, a device that has been offline the whole time falls back to the tie rule
   (see syncMergeSnapshots), which is what every edit got before timestamps existed. Keeps the map --
   which travels inside the size-capped profiles row -- from growing forever. */
const SYNC_EDIT_TTL_S=45*24*3600;

/* The profile's fields, by how they merge. A path is one mergeable unit: "r|m01" is the rating of
   m01, "s|t17" is t17's place in the Silver tier. Anything not listed merges as one whole value
   ("P|pinnedIdx"), which is right for fields that are an ordered choice or a one-off record. */
const SYNC_SET_FIELDS={declaredGoatIds:'g',silverTierIds:'s',bronzeTierIds:'b',ownedGameIds:'og',cosmicHorrorDeclaredIds:'cd',hiddenRecs:'h'};
const SYNC_MAP_FIELDS={ownedMedia:'om',ownedBooksExtra:'ob',ratings:'r',notInterested:'n',vibeBoost:'vb',cosmicHorrorCanon:'cc',watchlist:'cw'};
const SYNC_PAIR_FIELDS={creatorBoost:'cb',bookCreatorBoost:'bb',genreBoost:'gb'};
const SYNC_FIELD_OF_CODE=(function(){
 const m={};
 [SYNC_SET_FIELDS,SYNC_MAP_FIELDS,SYNC_PAIR_FIELDS].forEach(function(t){Object.keys(t).forEach(function(f){m[t[f]]=f;});});
 return m;
})();

function syncParseObject(raw){
 if(raw==null)return null;
 try{const v=JSON.parse(raw);return (v&&typeof v==='object'&&!Array.isArray(v))?v:null;}catch(e){return null;}
}

/* One stored value -> Map of path -> canonical JSON of that path's value. An absent path means the
   thing is not there (no rating, not in the tier, key unset). A value that cannot be read as the
   shape its key should have merges as one opaque whole, rather than being thrown away. */
function syncPaths(key,raw){
 const out=new Map();
 if(raw==null)return out;
 if(key==='omniLedgerProfile'){
  const p=syncParseObject(raw);
  if(!p){out.set('P|*',JSON.stringify(raw));return out;}
  Object.keys(p).forEach(function(f){
   const v=p[f];
   if(SYNC_SET_FIELDS[f]&&Array.isArray(v))v.forEach(function(id){out.set(SYNC_SET_FIELDS[f]+'|'+id,'1');});
   else if(SYNC_MAP_FIELDS[f]&&v&&typeof v==='object'&&!Array.isArray(v))Object.keys(v).forEach(function(k){out.set(SYNC_MAP_FIELDS[f]+'|'+k,JSON.stringify(v[k]));});
   else if(SYNC_PAIR_FIELDS[f]&&Array.isArray(v))v.forEach(function(e){if(Array.isArray(e))out.set(SYNC_PAIR_FIELDS[f]+'|'+e[0],JSON.stringify(e[1]));});
   else out.set('P|'+f,JSON.stringify(v));
  });
  return out;
 }
 if(key==='omniLedgerWatchlist'){
  const w=syncParseObject(raw);
  if(!w){out.set('w|*',JSON.stringify(raw));return out;}
  Object.keys(w).forEach(function(id){out.set('w|'+id,JSON.stringify(w[id]));});
  return out;
 }
 out.set('k|'+key,JSON.stringify(String(raw)));
 return out;
}

/* The paths that differ between two stored values of one key: what an edit actually changed. */
function syncChangedPaths(key,oldRaw,newRaw){
 const a=syncPaths(key,oldRaw),b=syncPaths(key,newRaw),out=[];
 a.forEach(function(v,p){if(b.get(p)!==v)out.push(p);});
 b.forEach(function(v,p){if(!a.has(p))out.push(p);});
 return out;
}

function syncSameMap(a,b){
 if(a.size!==b.size)return false;
 for(const [k,v] of a)if(b.get(k)!==v)return false;
 return true;
}

/* Paths back into the stored string. Order follows the inputs, first `sources[0]` then the rest,
   so a merge that changes one title does not reshuffle everything else in the file. */
function syncBuild(key,paths,sources){
 if(key==='omniLedgerProfile'||key==='omniLedgerWatchlist'){
  if(paths.has('P|*'))return JSON.parse(paths.get('P|*'));
  if(paths.has('w|*'))return JSON.parse(paths.get('w|*'));
 }
 if(key==='omniLedgerWatchlist'){
  const srcs=sources.map(syncParseObject).filter(Boolean),out={};
  srcs.forEach(function(s){Object.keys(s).forEach(function(id){const v=paths.get('w|'+id);if(v!==undefined&&!(id in out))out[id]=JSON.parse(v);});});
  paths.forEach(function(v,p){const id=p.slice(2);if(!(id in out))out[id]=JSON.parse(v);});
  return JSON.stringify(out);
 }
 if(key!=='omniLedgerProfile'){
  const v=paths.get('k|'+key);
  return v===undefined?null:JSON.parse(v);
 }
 const srcs=sources.map(syncParseObject).filter(Boolean);
 const byField=new Map();
 paths.forEach(function(v,p){
  const bar=p.indexOf('|'),code=p.slice(0,bar),sub=p.slice(bar+1);
  const f=code==='P'?sub:SYNC_FIELD_OF_CODE[code];
  if(!f)return;
  let e=byField.get(f);if(!e)byField.set(f,e=new Map());
  e.set(sub,v);
 });
 const order=[],seen=new Set();
 srcs.forEach(function(s){Object.keys(s).forEach(function(f){if(!seen.has(f)){seen.add(f);order.push(f);}});});
 byField.forEach(function(_v,f){if(!seen.has(f)){seen.add(f);order.push(f);}});
 const had=function(f){return srcs.some(function(s){return Object.prototype.hasOwnProperty.call(s,f);});};
 const out={};
 order.forEach(function(f){
  const e=byField.get(f)||new Map();
  if(SYNC_SET_FIELDS[f]){
   const arr=[],done=new Set();
   srcs.forEach(function(s){if(Array.isArray(s[f]))s[f].forEach(function(id){if(e.has(String(id))&&!done.has(String(id))){arr.push(id);done.add(String(id));}});});
   e.forEach(function(_v,id){if(!done.has(id)){arr.push(id);done.add(id);}});
   if(arr.length||had(f))out[f]=arr;
  }else if(SYNC_MAP_FIELDS[f]){
   const obj={};
   srcs.forEach(function(s){const m=s[f];if(m&&typeof m==='object'&&!Array.isArray(m))Object.keys(m).forEach(function(k){if(e.has(k)&&!(k in obj))obj[k]=JSON.parse(e.get(k));});});
   e.forEach(function(v,k){if(!(k in obj))obj[k]=JSON.parse(v);});
   if(Object.keys(obj).length||had(f))out[f]=obj;
  }else if(SYNC_PAIR_FIELDS[f]){
   const arr=[],done=new Set();
   srcs.forEach(function(s){if(Array.isArray(s[f]))s[f].forEach(function(pr){const nm=Array.isArray(pr)?String(pr[0]):null;if(nm!=null&&e.has(nm)&&!done.has(nm)){arr.push([pr[0],JSON.parse(e.get(nm))]);done.add(nm);}});});
   e.forEach(function(v,nm){if(!done.has(nm)){arr.push([nm,JSON.parse(v)]);done.add(nm);}});
   if(arr.length||had(f))out[f]=arr;
  }else if(e.has(f)){
   out[f]=JSON.parse(e.get(f));
  }
 });
 return JSON.stringify(out);
}

function syncParseEdits(raw){
 const o=syncParseObject(raw);
 const out={};
 if(o)Object.keys(o).forEach(function(p){const t=+o[p];if(isFinite(t)&&t>0)out[p]=t;});
 return out;
}

/* Stamps `paths` as edited at `nowS` (seconds), dropping stamps past SYNC_EDIT_TTL_S. */
function syncRecordEdits(editsRaw,paths,nowS){
 const e=syncParseEdits(editsRaw),cutoff=nowS-SYNC_EDIT_TTL_S;
 paths.forEach(function(p){e[p]=nowS;});
 Object.keys(e).forEach(function(p){if(e[p]<cutoff)delete e[p];});
 return JSON.stringify(e);
}

/* Merges two snapshots ({storage key: stored string}, the edits map among them) over `keys`.
   Per path, the side that edited it more recently wins -- including a removal, so a rating deleted
   on one device is not brought back by the other. A path neither side has a stamp for (edited
   before timestamps existed, or so long ago its stamp expired) is a tie: if only one side has a
   value it is kept, since nothing may be deleted without a record of deleting it; if both have
   different values, `local` wins when opts.localWinsTies -- the rule every edit followed before,
   where unsynced local work always won -- and `remote` otherwise.
   Returns {snapshot, dataChangedLocal, changedRemote}: the merged snapshot, whether anything the
   app shows differs from `local` (so the screen must catch up), and whether anything at all differs
   from `remote` (so it must be written back). */
function syncMergeSnapshots(local,remote,keys,opts){
 opts=opts||{};
 local=local||{};remote=remote||{};
 const el=syncParseEdits(local[SYNC_EDITS_KEY]),er=syncParseEdits(remote[SYNC_EDITS_KEY]);
 const snapshot={};
 let dataChangedLocal=false,changedRemote=false;
 keys.forEach(function(key){
  if(key===SYNC_EDITS_KEY)return;
  const lr=local[key],rr=remote[key];
  const pl=syncPaths(key,lr),pr=syncPaths(key,rr);
  const merged=new Map();
  new Set(Array.from(pl.keys()).concat(Array.from(pr.keys()))).forEach(function(p){
   const tl=el[p]||0,tr=er[p]||0,vl=pl.get(p),vr=pr.get(p);
   let v;
   if(tl!==tr)v=tl>tr?vl:vr;
   else if(vl===undefined||vr===undefined)v=vl===undefined?vr:vl;
   else v=opts.localWinsTies?vl:vr;
   if(v!==undefined)merged.set(p,v);
  });
  const sameL=syncSameMap(merged,pl),sameR=syncSameMap(merged,pr);
  // Equal in meaning to both ("{}" on one side, nothing on the other): keep whichever is stored.
  const raw=(sameL&&sameR)?(lr!=null?lr:rr):sameL?lr:sameR?rr:syncBuild(key,merged,[lr,rr]);
  if(raw!=null)snapshot[key]=raw;
  if(!sameL)dataChangedLocal=true;
  if(!sameR)changedRemote=true;
 });
 if(keys.indexOf(SYNC_EDITS_KEY)>=0){
  const e=Object.assign({},er);
  Object.keys(el).forEach(function(p){if(!(e[p]>=el[p]))e[p]=el[p];});
  const any=Object.keys(e).length>0;
  if(any||local[SYNC_EDITS_KEY]!=null||remote[SYNC_EDITS_KEY]!=null)snapshot[SYNC_EDITS_KEY]=JSON.stringify(e);
  if(any&&!syncSameMap(new Map(Object.entries(e)),new Map(Object.entries(er))))changedRemote=true;
 }
 return {snapshot:snapshot,dataChangedLocal:dataChangedLocal,changedRemote:changedRemote};
}
