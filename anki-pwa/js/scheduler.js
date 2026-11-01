// Simplified SM-2 (Anki v1-style). Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.
export const MIN=6e4,DAY=864e5,STEPS=[1,10];
// Returns the changed fields for card c after rating r. Pure: does not mutate c.
export function next(c,r,now=Date.now()){
  const s={reps:c.reps+1,ft:c.ft||now,ease:c.ease||2500,ivl:c.ivl,lapses:c.lapses,step:c.step||0,type:c.type,due:c.due};
  const grad=iv=>{s.type=2;s.ivl=iv;s.step=0;s.due=now+iv*DAY;};
  if(c.type!==2){                                   // new / learning / relearning
    const re=c.type===3,st=c.type===0?0:s.step,t=re?3:1;
    if(r===1){s.type=t;s.step=0;s.due=now+STEPS[0]*MIN;}
    else if(r===2){s.type=t;s.step=st;s.due=now+STEPS[st]*MIN*(st?1:1.5);}
    else if(r===3&&st<STEPS.length-1){s.type=t;s.step=st+1;s.due=now+STEPS[st+1]*MIN;}
    else grad(r===4?4:(re?Math.max(1,c.ivl):1));
  }else{                                            // review
    const e=s.ease/1000;
    if(r===1){s.lapses++;s.ease=Math.max(1300,s.ease-200);s.type=3;s.step=1;s.ivl=Math.max(1,Math.round(c.ivl*.5));s.due=now+STEPS[1]*MIN;}
    else if(r===2){s.ease=Math.max(1300,s.ease-150);grad(Math.max(c.ivl+1,Math.round(c.ivl*1.2)));}
    else if(r===3) grad(Math.max(c.ivl+1,Math.round(c.ivl*e)));
    else{s.ease+=150;grad(Math.max(c.ivl+2,Math.round(c.ivl*e*1.3)));}
  }
  return s;
}
export const label=ms=>{
  if(ms<MIN)return'<1m';if(ms<36e5)return Math.round(ms/MIN)+'m';if(ms<DAY)return Math.round(ms/36e5)+'h';
  const d=ms/DAY;return d<30?Math.round(d)+'d':d<365?(d/30.4).toFixed(1)+'mo':(d/365).toFixed(1)+'y';};
