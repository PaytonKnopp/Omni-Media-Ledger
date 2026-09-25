// Title search, as a pure module: nothing here reads state, the DOM or the corpus globals. The
// caller hands in the works and a function naming each one's searchable fields -- the same
// contract as app/scoring.js -- so test/search.js can hold it to real queries without a browser.
//
// It replaces one lowercase substring test against every field glued together, which could not
// find "Amélie" from "amelie" (147 titles and creators carry accents or other non-ASCII letters),
// found nothing for "godfater", nothing for "zelda breath" (the two words are not adjacent in
// "The Legend of Zelda: Breath of the Wild") and nothing for "kubrick 1968" (director and year
// are different fields). Now:
//   - accents, case and punctuation are folded away on both sides ("Tár" is "tar"),
//   - every word of the query must match, in any order and any field,
//   - a word matches whole, as the start of a word ("godf"), or -- from four letters -- inside one,
//   - a word that matches nothing at all gets one more chance as a typo (see searchQuery),
//   - and each hit carries a relevance bucket, so an exact title outranks a title that merely
//     contains the words, which outranks a creator, which outranks a genre or a year.
'use strict';

/* Letters NFKD does not split into a base letter plus a combining mark. */
const SEARCH_LETTER_MAP={'ł':'l','Ł':'l','ø':'o','Ø':'o','æ':'ae','Æ':'ae','œ':'oe','Œ':'oe','ß':'ss','đ':'d','Đ':'d','ð':'d','Ð':'d','þ':'th','Þ':'th','ı':'i'};
const SEARCH_LETTER_RE=/[łŁøØæÆœŒßđĐðÐþÞı]/g;

/* Lowercase, accents and punctuation gone, single spaces between words. Apostrophes join rather
   than split ("Cuckoo's" -> "cuckoos"), "&" reads as "and", and letters of any script survive, so a
   title written in one can never fold away to nothing. */
function foldSearchText(s){
 return String(s==null?'':s)
  .replace(SEARCH_LETTER_RE,function(c){return SEARCH_LETTER_MAP[c];})
  .normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .toLowerCase()
  .replace(/&/g,' and ')
  .replace(/['‘’ʼ`´]/g,'')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .trim();
}
function searchWords(s){const f=foldSearchText(s);return f?f.split(' '):[];}

/* Damerau-Levenshtein (optimal string alignment) distance <= max, bailing out as soon as a whole
   row exceeds it. Only ever asked about a query word that matched nothing, so it runs rarely. */
function withinEdits(a,b,max){
 const la=a.length,lb=b.length;
 if(Math.abs(la-lb)>max)return false;
 let pp=new Array(lb+1).fill(0),p=new Array(lb+1),c=new Array(lb+1);
 for(let j=0;j<=lb;j++)p[j]=j;
 for(let i=1;i<=la;i++){
  const ai=a.charCodeAt(i-1);
  c[0]=i;let rowMin=i;
  for(let j=1;j<=lb;j++){
   const bj=b.charCodeAt(j-1);
   let v=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(ai===bj?0:1));
   if(i>1&&j>1&&ai===b.charCodeAt(j-2)&&a.charCodeAt(i-2)===bj&&pp[j-2]+1<v)v=pp[j-2]+1;
   c[j]=v;if(v<rowMin)rowMin=v;
  }
  if(rowMin>max)return false;
  const t=pp;pp=p;p=c;c=t;
 }
 return p[lb]<=max;
}
/* How many typos a word of this length may carry: none under four letters (too many real words sit
   one edit apart), one up to seven, two from eight ("villanueve" -> "villeneuve"). */
function searchTypoBudget(len){return len>=8?2:len>=4?1:0;}

/* fieldsOf(item) -> {title, creator, other:[strings]}. Field rank: 0 title, 1 creator, 2 other.
   Adjacent title and creator words are indexed joined as well, so "spiderman" finds "Spider-Man". */
function buildSearchIndex(items,fieldsOf){
 const vocab=new Map(),docs=new Array(items.length);
 function add(word,d,rank){
  let m=vocab.get(word);if(!m)vocab.set(word,m=new Map());
  const cur=m.get(d);if(cur===undefined||rank<cur)m.set(d,rank);
 }
 items.forEach(function(x,d){
  const f=fieldsOf(x)||{};
  const tw=searchWords(f.title),cw=searchWords(f.creator);
  tw.forEach(function(w){add(w,d,0);});
  for(let i=0;i+1<tw.length;i++)add(tw[i]+tw[i+1],d,0);
  cw.forEach(function(w){add(w,d,1);});
  for(let i=0;i+1<cw.length;i++)add(cw[i]+cw[i+1],d,1);
  const other=(f.other||[]).map(foldSearchText).filter(Boolean);
  other.forEach(function(s){s.split(' ').forEach(function(w){add(w,d,2);});});
  docs[d]={title:tw.join(' '),creator:cw.join(' '),other:other};
 });
 return {vocab:vocab,words:Array.from(vocab.keys()),docs:docs,cache:new Map()};
}
/* `phrase` occurs in folded field text starting at a word boundary; its last word may be
   unfinished, since people search as they type. */
function hasSearchPhrase(field,phrase){return !!field&&(' '+field).indexOf(' '+phrase)>=0;}

/* Every item matching every word of `query`, as a Map of item index -> relevance bucket (lower is
   better), or null when the query has no words at all (no search):
     0  the title is exactly the query
     1  the title starts with the query
     2  the title holds the query as a phrase, or every word whole or as the start of a word
     3  every word is in the title, some only inside a word or through a typo
     4  the creator holds the query as a phrase, or every word whole or as the start of a word
     5  another field holds the query as a phrase -- a genre, vibe, studio, platform or year
     6  some words are in the title, the rest elsewhere
     7  anything else: the words are all there, scattered across fields
   Callers sort by bucket first and keep their own order inside a bucket, so a broad query ("sci-fi",
   "1999", "A24") that lands everything in one bucket still reads in the order the person chose.
   Words joined by a hyphen in the query ("sci-fi", "spider-man", "late-night") are one phrase and
   must appear together: "sci-fi" is the genre, not a Céline Sciamma film with "Fire" in its title. */
function searchQuery(ix,query){
 const qf=foldSearchText(query);
 if(!qf)return null;
 const key=String(query).toLowerCase().replace(/\s+/g,' ').trim();
 const cached=ix.cache.get(key);
 if(cached)return cached;
 const phrases=(String(query).match(/[\p{L}\p{N}]+(?:[-\u2010\u2011\u2013][\p{L}\p{N}]+)+/gu)||[])
  .map(foldSearchText).filter(function(p){return p.indexOf(' ')>0;});
 const perToken=Array.from(new Set(qf.split(' '))).map(function(t){return searchTokenHits(ix,t);});
 let out=collectSearchHits(ix,qf,perToken,phrases);
 // A typo inside a hyphenated word ("spidr-man") can never appear as a phrase; rather than answer
 // nothing, fall back to the words alone.
 if(!out.size&&phrases.length)out=collectSearchHits(ix,qf,perToken,[]);
 if(ix.cache.size>=64)ix.cache.delete(ix.cache.keys().next().value);
 ix.cache.set(key,out);
 return out;
}
/* One query word -> Map of item index -> [best field rank, match kind], kind 0 whole word, 1 start
   of a word, 2 inside a word (four letters and up), 3 typo. */
function searchTokenHits(ix,t){
 const hits=new Map();
 function take(word,kind){
  ix.vocab.get(word).forEach(function(rank,d){
   const h=hits.get(d);
   if(!h||rank<h[0]||(rank===h[0]&&kind<h[1]))hits.set(d,[rank,kind]);
  });
 }
 if(ix.vocab.has(t))take(t,0);
 ix.words.forEach(function(w){
  if(w===t)return;
  if(w.startsWith(t))take(w,1);
  else if(t.length>=4&&w.indexOf(t)>0)take(w,2);
 });
 // A typo is only considered for a word that matched nothing any other way -- otherwise "dune"
 // would drag in "done", "tune" and "june" beside every real Dune.
 if(!hits.size){
  const max=searchTypoBudget(t.length);
  if(max)ix.words.forEach(function(w){if(withinEdits(t,w,max))take(w,3);});
 }
 return hits;
}
/* The items every word matched (and, when given, holding every hyphenated phrase), bucketed. */
function collectSearchHits(ix,qf,perToken,phrases){
 let smallest=perToken[0];
 perToken.forEach(function(h){if(h.size<smallest.size)smallest=h;});
 const out=new Map();
 smallest.forEach(function(_v,d){
  const info=[];
  for(const h of perToken){const v=h.get(d);if(!v)return;info.push(v);}
  const doc=ix.docs[d];
  const fields=[doc.title,doc.creator].concat(doc.other);
  if(!phrases.every(function(p){const joined=p.replace(/ /g,'');return fields.some(function(f){return hasSearchPhrase(f,p)||hasSearchPhrase(f,joined);});}))return;
  out.set(d,searchBucket(doc,qf,info));
 });
 return out;
}
function searchBucket(doc,qf,info){
 const whole=function(v){return v[1]<=1;};
 if(doc.title===qf)return 0;
 if(doc.title.startsWith(qf))return 1;
 if(hasSearchPhrase(doc.title,qf)||info.every(function(v){return v[0]===0&&whole(v);}))return 2;
 if(info.every(function(v){return v[0]===0;}))return 3;
 if(hasSearchPhrase(doc.creator,qf)||info.every(function(v){return v[0]===1&&whole(v);}))return 4;
 if(doc.other.some(function(f){return hasSearchPhrase(f,qf);}))return 5;
 if(info.some(function(v){return v[0]===0;}))return 6;
 return 7;
}

/* For the small lists that match a query against one piece of text (a series name): every query
   word, folded, must start or sit inside a word of the text. */
function textMatchesQuery(text,query){
 const words=searchWords(text),q=searchWords(query);
 return q.every(function(t){return words.some(function(w){return w.startsWith(t)||(t.length>=4&&w.indexOf(t)>0);});});
}
