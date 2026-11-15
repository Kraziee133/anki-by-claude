// SM-2 style scheduler driven by user options (mirrors Anki's Deck Options). Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.
export const MIN=6e4,DAY=864e5;
export const DEF={learn:'1m 10m',relearn:'10m',grad:1,easyIvl:4,startEase:250,easyBonus:130,ivlMod:100,maxIvl:36500,newPerDay:20,maxRev:200};
// "1m 10m 1h 1d" → minutes [1,10,60,1440] (bare numbers = minutes; invalid tokens → NaN)
export const steps=str=>String(str||'').trim().split(/[\s,]+/).filter(Boolean).map(t=>{
  const m=/^(\d+(?:\.\d+)?)([smhd])?$/i.exec(t);if(!m)return NaN;
  const v=+m[1],u=(m[2]||'m').toLowerCase();return u==='s'?v/60:u==='h'?v*60:u==='d'?v*1440:v;});
// Returns the changed fields for card c after rating r under options o. Pure: does not mutate c.
export function next(c,r,o=DEF,now=Date.now()){
  o={...DEF,...o};
  const s={reps:c.reps+1,ft:c.ft||now,ease:c.ease||2500,ivl:c.ivl,lapses:c.lapses,step:c.step||0,type:c.type,due:c.due};
  const cl=x=>Math.min(Math.max(1,o.maxIvl),Math.max(1,Math.round(x)));
  const grad=iv=>{s.type=2;s.ivl=cl(iv);s.step=0;s.due=now+s.ivl*DAY;};
  if(c.type===0)s.ease=Math.round(o.startEase*10);
  if(c.type!==2){                                               // new / learning / relearning
    const re=c.type===3,L=steps(re?o.relearn:o.learn).filter(x=>x>=0),t=re?3:1;
    const st=c.type===0?0:Math.min(s.step,Math.max(0,L.length-1)),gi=re?Math.max(1,c.ivl):o.grad;
    if(!L.length||r===4)grad(r===4?(re?c.ivl+1:o.easyIvl):gi);
    else if(r===1){s.type=t;s.step=0;s.due=now+L[0]*MIN;}
    else if(r===2){s.type=t;s.step=st;s.due=now+(st===0?(L.length>1?(L[0]+L[1])/2:L[0]*1.5):L[st])*MIN;}
    else if(st<L.length-1){s.type=t;s.step=st+1;s.due=now+L[st+1]*MIN;}
    else grad(gi);
  }else{                                                        // review
    const e=s.ease/1000,im=o.ivlMod/100,eb=o.easyBonus/100;
    if(r===1){
      s.lapses++;s.ease=Math.max(1300,s.ease-200);s.ivl=cl(c.ivl*.5);
      const R=steps(o.relearn).filter(x=>x>=0);
      if(R.length){s.type=3;s.step=0;s.due=now+R[0]*MIN;}else s.due=now+s.ivl*DAY;
    }else{
      const h=cl(Math.max(c.ivl+1,c.ivl*1.2*im)),g=cl(Math.max(h+1,c.ivl*e*im)),z=cl(Math.max(g+1,c.ivl*e*eb*im));
      if(r===2){s.ease=Math.max(1300,s.ease-150);grad(h);}else if(r===3)grad(g);else{s.ease+=150;grad(z);}
    }
  }
  return s;
}
export const label=ms=>{
  if(ms<MIN)return'<1m';if(ms<36e5)return Math.round(ms/MIN)+'m';if(ms<DAY)return Math.round(ms/36e5)+'h';
  const d=ms/DAY;return d<30?Math.round(d)+'d':d<365?(d/30.4).toFixed(1)+'mo':(d/365).toFixed(1)+'y';};
