// The live "Match" scoring pass, extracted out of initApp() in ledger-app.js.
//
// Unlike app/scoring.js (the hand-tuned override tables, which take every input as a parameter and
// never touched the closure), these three read `state` -- the live filter/slider state that lives
// inside initApp(). They are otherwise self-contained: no DOM, no ALL, no PERSONAL_PROFILE. Making
// that one dependency an explicit parameter is what makes them safe to load as an ordinary
// top-level script before app/ledger-app.js -- see ARCHITECTURE.md "Known limits". initApp() calls
// these by name now, passing its own `state`, same as it calls into app/scoring.js.
'use strict';

function activeDims(state){
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
function computeMatch(list,state){
 const dims=activeDims(state);
 const wsum=dims.reduce((s,d)=>s+d[2],0);
 list.forEach(it=>{
  if(!dims.length||wsum<=0){it._m=it.ovr;return;}
  let sum=0;dims.forEach(d=>{sum+=it[d[0]]*d[2];});
  it._m=Math.round((sum/wsum)*0.8+it.ovr*0.2);
 });
}
function bespokeScore(it,state){const w=state.w,s=w.tech+w.dread+w.myst;if(s<=0)return 0;return (it.tech*w.tech+it.dread*w.dread+it.myst*w.myst)/s;}
