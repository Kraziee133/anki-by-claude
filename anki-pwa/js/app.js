import * as DB from './db.js';
import {importFile} from './importer.js';
import {next,label,steps,MIN,DAY,DEF} from './scheduler.js';
import {renderCard,loadMedia,BASE} from './render.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const view=$('#view'),shadow=$('#host').attachShadow({mode:'open'});
const freshSet=()=>({excluded:[],lock:true,opts:{g:{...DEF},d:{}}});
let col=null,set=freshSet(),stats={days:{},rev:{}},tab='decks',sess=null,urls=[],sel=new Set(),tq='';
const collapsed=new Set();

async function load(){
  col=await DB.get('kv','col');
  const sv=await DB.get('kv','settings')||{};
  set=Object.assign(freshSet(),sv);
  if(!sv.opts&&sv.newPerDay!=null)set.opts.g.newPerDay=sv.newPerDay;      // migrate old single setting
  stats=await DB.get('kv','stats')||{days:{},rev:{}};
  if(col){const st=await DB.all('state');
    col.cards.forEach(c=>{if(st[c.id])Object.assign(c,st[c.id]);c._t=(col.notes[c.nid]?.t||'').trim().split(/\s+/).filter(Boolean);});}
}
const saveSet=()=>DB.put('kv','settings',set);
const pick=c=>({type:c.type,due:c.due,ivl:c.ivl,ease:c.ease,reps:c.reps,lapses:c.lapses,step:c.step,ft:c.ft});
const active=c=>!c.susp&&!c._t.some(t=>set.excluded.includes(t));
const kind=(c,now,eod)=>c.type===0?'n':c.type===2?(c.due<=eod?'r':''):(c.due<=now+20*MIN?'l':'');
const shuffle=a=>{for(let i=a.length;i>1;){const j=Math.random()*i--|0;[a[i],a[j]]=[a[j],a[i]];}return a;};
const times=()=>{const eod=new Date().setHours(24,0,0,0);return{now:Date.now(),eod,sod:eod-DAY};};
const ymd=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
// Options for a deck: its own override, else nearest parent's, else global
const optsFor=name=>{let n=name||'';for(;;){if(set.opts.d[n])return{...DEF,...set.opts.d[n]};const i=n.lastIndexOf('::');if(i<0)break;n=n.slice(0,i);}return{...DEF,...set.opts.g};};

// ---------- toast ----------
let tt;
function toast(msg,ms=3500,act){
  const t=$('#toast');
  t.innerHTML=`<span>${esc(msg)}</span>`+(act?`<button id="ta">${esc(act.label)}</button><button id="tc">Cancel</button>`:'');
  t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,ms);
  if(act){$('#ta').onclick=()=>{t.hidden=true;act.fn();};$('#tc').onclick=()=>t.hidden=true;}
}

// ---------- streak (derived from per-day review counts, so a missed day resets it automatically) ----------
function streak(){
  const d=new Date();if(!stats.days[ymd(d)])d.setDate(d.getDate()-1);     // today not studied yet: streak stays alive until midnight
  let n=0;while(stats.days[ymd(d)]>0){n++;d.setDate(d.getDate()-1);}return n;
}
async function logReview(c,wasReview){
  const k=ymd();stats.days[k]=(stats.days[k]||0)+1;
  if(stats.rev.date!==k)stats.rev={date:k,d:{}};
  if(wasReview)stats.rev.d[c.did]=(stats.rev.d[c.did]||0)+1;            // for max reviews/day
  await DB.put('kv','stats',stats);
}

// ---------- deck tree ----------
function tree(){
  const {now,eod,sod}=times(),nodes={},roots=[];
  const mk=full=>nodes[full]||(()=>{const i=full.lastIndexOf('::'),n=nodes[full]={full,name:full.slice(i<0?0:i+2),kids:[],rn:0,nt:0,l:0,rr:0,rt:0};
    (i<0?roots:mk(full.slice(0,i)).kids).push(n);return n;})();
  const byDid={};
  Object.values(col.decks).forEach(d=>byDid[d.id]=mk(d.name));
  if(stats.rev.date===ymd())for(const [did,n] of Object.entries(stats.rev.d))if(byDid[did])byDid[did].rt+=n;
  col.cards.forEach(c=>{if(!active(c))return;const n=byDid[c.did];if(!n)return;const k=kind(c,now,eod);
    if(k==='n')n.rn++;else if(k==='l')n.l++;else if(k==='r')n.rr++;if(c.ft>=sod)n.nt++;});
  const roll=n=>{n.kids.forEach(k=>{roll(k);n.rn+=k.rn;n.nt+=k.nt;n.l+=k.l;n.rr+=k.rr;n.rt+=k.rt;});
    const o=optsFor(n.full);n.n=Math.min(n.rn,Math.max(0,o.newPerDay-n.nt));n.r=Math.min(n.rr,Math.max(0,o.maxRev-n.rt));};
  roots.forEach(roll);
  const sort=a=>{a.sort((x,y)=>x.name.localeCompare(y.name));a.forEach(n=>sort(n.kids));};sort(roots);
  return roots.filter(n=>n.full!=='Default'||n.rn+n.l+n.rr+n.kids.length);
}
function vDecks(){
  if(!col)return view.innerHTML=`<p class="empty">No collection yet.<br>Open the Import tab to add an .apkg file.</p>`;
  const z=n=>n?'':' data-z';
  const row=(n,d)=>`<div class="deck" style="padding-left:${d*18}px"><button class="chev" data-tog="${esc(n.full)}">${n.kids.length?(collapsed.has(n.full)?'▸':'▾'):''}</button>
  <button class="dn" data-study="${esc(n.full)}">${esc(n.name)}</button><span class="cnt"><b class="cn"${z(n.n)}>${n.n}</b><b class="cl"${z(n.l)}>${n.l}</b><b class="cr"${z(n.r)}>${n.r}</b></span><button class="og" data-opt="${esc(n.full)}" aria-label="Deck options">⚙︎</button></div>`
  +(collapsed.has(n.full)?'':n.kids.map(k=>row(k,d+1)).join(''));
  view.innerHTML=`<div class="legend">New · Learn · Due</div>`+tree().map(n=>row(n,0)).join('');
}
function startDeck(full){
  const {now,eod,sod}=times(),ids=new Set(Object.values(col.decks).filter(d=>d.name===full||d.name.startsWith(full+'::')).map(d=>d.id));
  const cs=col.cards.filter(c=>ids.has(c.did)&&active(c)),o=optsFor(full);
  const newLeft=Math.max(0,o.newPerDay-cs.filter(c=>c.ft>=sod).length);
  const revDone=stats.rev.date===ymd()?[...ids].reduce((a,d)=>a+(stats.rev.d[d]||0),0):0;
  start(build(cs,now,eod,newLeft,Math.max(0,o.maxRev-revDone)),full,false);
}
function build(cs,now,eod,limN=1e9,limR=1e9){
  const g={n:[],l:[],r:[]};cs.forEach(c=>{const k=kind(c,now,eod);if(k)g[k].push(c);});
  const by=(a,b)=>a.due-b.due;
  return [...g.l.sort(by),...g.r.sort(by).slice(0,limR),...g.n.sort(by).slice(0,limN)];
}

// ---------- Deck Options modal ----------
const FIELDS=[['learn','Learning steps'],['relearn','Relearning steps'],['grad','Graduating interval (days)'],['easyIvl','Easy interval (days)'],
  ['startEase','Starting ease (%)'],['easyBonus','Easy bonus (%)'],['ivlMod','Interval modifier (%)'],['maxIvl','Maximum interval (days)'],
  ['newPerDay','New cards / day'],['maxRev','Maximum reviews / day']];
const MINV={grad:1,easyIvl:1,startEase:130,easyBonus:100,ivlMod:10,maxIvl:1,newPerDay:0,maxRev:0};
function openOpts(scope){                       // scope: null = global, else deck full name
  const m=$('#modal'),o=scope?optsFor(scope):{...DEF,...set.opts.g};
  m.innerHTML=`<div class="sheet"><h2>${scope?'Options: '+esc(scope):'Scheduler options (all decks)'}</h2>`
   +FIELDS.map(([k,l])=>`<label class="fld"><span>${l}</span><input data-k="${k}" ${typeof DEF[k]==='string'?'type="text" autocapitalize="off"':'type="number" inputmode="decimal" step="any"'} value="${esc(o[k])}"></label>`).join('')
   +`<p class="hint">Steps like <code>1m 10m 1h 1d</code>. ${scope?'Applies to this deck and its subdecks.':'Decks without their own options use these.'}</p>
   <div class="actions2"><button data-m="cancel">Cancel</button>${scope?'<button data-m="reset">Use global</button>':'<button data-m="def">Defaults</button>'}<button class="pri" data-m="save">Save</button></div></div>`;
  m.hidden=false;
  m.onclick=async e=>{
    const a=e.target.dataset.m;
    if(e.target===m||a==='cancel'){m.hidden=true;return;}
    if(a==='def'){m.querySelectorAll('input').forEach(i=>i.value=DEF[i.dataset.k]);return;}
    if(a==='reset'){delete set.opts.d[scope];await saveSet();m.hidden=true;render();return;}
    if(a!=='save')return;
    const v={};let bad='';
    m.querySelectorAll('input').forEach(i=>{const k=i.dataset.k,l=FIELDS.find(f=>f[0]===k)[1];
      if(typeof DEF[k]==='string'){if(steps(i.value).some(isNaN))bad=bad||`Invalid ${l.toLowerCase()} (use e.g. 1m 10m 1d)`;v[k]=i.value.trim();}
      else{const n=i.value===''?NaN:+i.value;if(!isFinite(n)||n<MINV[k])bad=bad||`${l} must be at least ${MINV[k]}`;v[k]=n;}});
    if(bad)return toast(bad);
    scope?set.opts.d[scope]=v:set.opts.g=v;
    await saveSet();m.hidden=true;render();toast('Options saved');
  };
}
$('#gear').onclick=()=>openOpts(null);

// ---------- tags ----------
function tagList(){
  const m={};col.cards.forEach(c=>{if(!c.susp)c._t.forEach(t=>m[t]=(m[t]||0)+1);});
  const ts=Object.keys(m).filter(t=>t.toLowerCase().includes(tq)).sort();
  return ts.map(t=>`<label class="trow"><input type="checkbox" data-sel="${esc(t)}" ${sel.has(t)?'checked':''}><span class="tn">${esc(t)}</span>${set.excluded.includes(t)?'<em>suspended</em>':''}<span class="cnt">${m[t]}</span></label>`).join('')||'<p class="empty">No tags</p>';
}
function vTags(){
  if(!col)return view.innerHTML=`<p class="empty">Import a deck first.</p>`;
  view.innerHTML=`<input type="search" id="tq" placeholder="Search tags" value="${esc(tq)}"><div id="tl">${tagList()}</div>
  <div class="actions"><button data-act="study">Study due</button><button data-act="cram">Cram all</button><button data-act="susp">Suspend</button><button data-act="resume">Resume</button></div>`;
}
async function tagAct(a){
  const s=[...sel];if(!s.length)return toast('Select one or more tags first.');
  if(a==='susp'||a==='resume'){   // suspended tags are hidden from every deck's review queue (reversible)
    set.excluded=a==='susp'?[...new Set([...set.excluded,...s])]:set.excluded.filter(t=>!s.includes(t));
    await saveSet();return vTags();}
  const cs=col.cards.filter(c=>!c.susp&&c._t.some(t=>s.includes(t))),{now,eod}=times();
  a==='cram'?start(shuffle(cs),'Cram: '+s.join(', '),true):start(build(cs,now,eod),'Tags: '+s.join(', '),false);
}

// ---------- import (merges into the existing collection) ----------
function vImport(){
  view.innerHTML=`<label class="drop" id="dz"><input type="file" id="fi" multiple accept=".apkg,.colpkg,.cmv,.zip">Drop .apkg / .colpkg / .cmv files here<br>or tap to choose</label>
  <p id="st" style="color:var(--mut)">${col?`${col.cards.length} cards in your collection. New imports are merged in; existing progress is kept.`:''}</p>
  <div class="sec">Scheduler</div><button class="btn" id="so" style="width:100%">Scheduler options…</button>
  ${col?`<div class="sec">Danger zone</div><button class="btn" id="wipe" style="background:#dc2626;width:100%">Delete collection &amp; card progress</button>`:''}`;
  const dz=$('#dz');
  ['dragover','dragenter'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('over');}));
  ['dragleave','drop'].forEach(e=>dz.addEventListener(e,()=>dz.classList.remove('over')));
  dz.addEventListener('drop',ev=>{ev.preventDefault();doImport([...ev.dataTransfer.files]);});
  $('#fi').onchange=e=>doImport([...e.target.files]);
  $('#so').onclick=()=>openOpts(null);
  const w=$('#wipe');if(w)w.onclick=async()=>{if(!confirm('Delete all decks, media and card progress? (Streak and options are kept.)'))return;
    await Promise.all([DB.clear('media'),DB.clear('state'),DB.put('kv','col',null)]);await load();render();};
}
async function doImport(files){
  const st=$('#st'),T={merged:false,decks:0,cards:0,dups:0};
  try{
    for(const f of files){const r=await importFile(f,m=>st.textContent=(files.length>1?f.name+': ':'')+m);
      T.merged=T.merged||r.merged;T.decks+=r.decks;T.cards+=r.cards;T.dups+=r.dups;await load();}
    tab='decks';render();
    toast(`${T.merged?'Merged':'Imported'} ${T.decks} new deck${T.decks===1?'':'s'}: ${T.cards} new cards added, ${T.dups} duplicate notes skipped`,9000);
  }catch(e){console.error(e);st.textContent='Import failed: '+e.message;}
}

// ---------- review ----------
const syncLock=()=>{$('#lock').textContent='Lock Links: '+(set.lock?'ON':'OFF');};
$('#lock').onclick=async()=>{set.lock=!set.lock;syncLock();await saveSet();
  toast(set.lock?'Links locked: taps flip the card':'Links unlocked: tapping a link will ask first');};
function start(q,title,cram){
  if(!q.length)return toast('Nothing to study right now.');
  sess={q,title,cram,cur:null,ans:false};syncLock();
  $('#rv').hidden=false;$('#rt').textContent=title;nextCard();
}
function exitSess(){sess=null;$('#rv').hidden=true;shadow.innerHTML='';urls.splice(0).forEach(URL.revokeObjectURL);render();}
function nextCard(){
  if(!sess.q.length){toast('Session complete 🎉',4000);return exitSess();}
  sess.cur=sess.q.shift();sess.ans=false;draw();
}
async function draw(){
  const c=sess.cur,n=col.notes[c.nid],m=n&&col.models[n.mid],dn=col.decks[c.did]?.name||'';
  $('#rc').textContent=sess.q.length+1;
  if(!m)return nextCard();
  const r=renderCard(c,n,m,dn),o=optsFor(dn);
  urls.splice(0).forEach(URL.revokeObjectURL);
  shadow.innerHTML=`<style>${BASE}${r.css}</style><div class="card">${sess.ans?r.a:r.q}</div>`;
  shadow.querySelectorAll('a[href]').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
  $('#pane').scrollTop=0;
  $('#btns').innerHTML=sess.ans?[1,2,3,4].map(i=>`<button class="r${i}" data-r="${i}"><small>${sess.cram?'':label(next(c,i,o).due-Date.now())}</small>${['Again','Hard','Good','Easy'][i-1]}</button>`).join('')
    :`<button class="show" data-show>Show Answer</button>`;
  await loadMedia(shadow,urls);
}
async function answer(r){
  const c=sess.cur,was=c.type===2;
  if(sess.cram){if(r===1)sess.q.push(c);}
  else{Object.assign(c,next(c,r,optsFor(col.decks[c.did]?.name)));await DB.put('state',c.id,pick(c));if(c.type!==2)sess.q.push(c);}
  await logReview(c,was&&!sess.cram);
  nextCard();
}
const reveal=()=>{if(sess&&!sess.ans){sess.ans=true;draw();}};
// Links inside cards never navigate on their own. Locked: the tap falls through and flips the card.
// Unlocked: the tap asks "Open external link?" and only then opens it in a new tab (noopener).
shadow.addEventListener('click',e=>{
  const a=e.composedPath().find(n=>n.tagName==='A');if(!a)return;
  e.preventDefault();
  if(set.lock)return;
  e.stopPropagation();
  const raw=a.getAttribute('href')||'',href=a.href;
  if(raw.startsWith('#')||!/^https?:/i.test(href))return;
  toast('Open external link? '+new URL(href).host,8000,{label:'Open',fn:()=>window.open(href,'_blank','noopener,noreferrer')});
});
$('#btns').onclick=e=>{const b=e.target.closest('button');if(!b)return;b.dataset.r?answer(+b.dataset.r):reveal();};
$('#pane').onclick=e=>{
  if(e.composedPath().some(n=>/^(AUDIO|VIDEO|SUMMARY|INPUT|BUTTON)$/.test(n.tagName)))return;   // don't flip when using media/hints
  if(!window.getSelection().toString())reveal();};
$('#back').onclick=exitSess;
addEventListener('keydown',e=>{if(!sess||!$('#modal').hidden)return;
  if(e.key===' '||e.key==='Enter'){e.preventDefault();sess.ans?answer(3):reveal();}
  else if(sess.ans&&'1234'.includes(e.key))answer(+e.key);else if(e.key==='Escape')exitSess();});

// ---------- shell ----------
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));
  $('#bt').textContent={decks:'Decks',tags:'Tags',imp:'Import'}[tab];
  $('#badge').innerHTML=tab==='decks'&&col?`<span>🔥 ${streak()} Day Streak · ${stats.days[ymd()]||0} reviewed today</span>`:'';
  ({decks:vDecks,tags:vTags,imp:vImport})[tab]();
}
$('#tabs').onclick=e=>{const t=e.target.dataset.t;if(t){tab=t;render();}};
view.addEventListener('click',e=>{const b=e.target.closest('[data-tog],[data-study],[data-act],[data-opt]');if(!b)return;const d=b.dataset;
  if(d.tog){collapsed.has(d.tog)?collapsed.delete(d.tog):collapsed.add(d.tog);vDecks();}
  else if(d.study)startDeck(d.study);else if(d.act)tagAct(d.act);else if(d.opt)openOpts(d.opt);});
view.addEventListener('change',e=>{const t=e.target.dataset.sel;if(t!=null)e.target.checked?sel.add(t):sel.delete(t);});
view.addEventListener('input',e=>{if(e.target.id==='tq'){tq=e.target.value.toLowerCase();$('#tl').innerHTML=tagList();}});
(async()=>{
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
  navigator.storage?.persist?.();
  await load();render();
})();
