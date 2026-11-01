import * as DB from './db.js';
import {importFile} from './importer.js';
import {next,label,MIN,DAY} from './scheduler.js';
import {renderCard,loadMedia,BASE} from './render.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const view=$('#view'),shadow=$('#host').attachShadow({mode:'open'});
let col=null,set={excluded:[],newPerDay:20},tab='decks',sess=null,urls=[],sel=new Set(),tq='';
const collapsed=new Set();

async function load(){
  col=await DB.get('kv','col');
  Object.assign(set,await DB.get('kv','settings')||{});
  if(col){const st=await DB.all('state');
    col.cards.forEach(c=>{if(st[c.id])Object.assign(c,st[c.id]);c._t=(col.notes[c.nid]?.t||'').trim().split(/\s+/).filter(Boolean);});}
}
const pick=c=>({type:c.type,due:c.due,ivl:c.ivl,ease:c.ease,reps:c.reps,lapses:c.lapses,step:c.step,ft:c.ft});
const active=c=>!c.susp&&!c._t.some(t=>set.excluded.includes(t));
const kind=(c,now,eod)=>c.type===0?'n':c.type===2?(c.due<=eod?'r':''):(c.due<=now+20*MIN?'l':'');
const shuffle=a=>{for(let i=a.length;i>1;){const j=Math.random()*i--|0;[a[i],a[j]]=[a[j],a[i]];}return a;};
const times=()=>{const eod=new Date().setHours(24,0,0,0);return{now:Date.now(),eod,sod:eod-DAY};};

// ---------- deck tree ----------
function tree(){
  const {now,eod,sod}=times(),nodes={},roots=[];
  const mk=full=>nodes[full]||(()=>{const i=full.lastIndexOf('::'),n=nodes[full]={full,name:full.slice(i<0?0:i+2),kids:[],rn:0,nt:0,l:0,r:0};
    (i<0?roots:mk(full.slice(0,i)).kids).push(n);return n;})();
  const byDid={};
  Object.values(col.decks).forEach(d=>byDid[d.id]=mk(d.name));
  col.cards.forEach(c=>{if(!active(c))return;const n=byDid[c.did];if(!n)return;const k=kind(c,now,eod);
    if(k==='n')n.rn++;else if(k==='l')n.l++;else if(k==='r')n.r++;if(c.ft>=sod)n.nt++;});
  const roll=n=>{n.kids.forEach(k=>{roll(k);n.rn+=k.rn;n.nt+=k.nt;n.l+=k.l;n.r+=k.r;});n.n=Math.min(n.rn,Math.max(0,set.newPerDay-n.nt));};
  roots.forEach(roll);
  const sort=a=>{a.sort((x,y)=>x.name.localeCompare(y.name));a.forEach(n=>sort(n.kids));};sort(roots);
  return roots.filter(n=>n.full!=='Default'||n.rn+n.l+n.r+n.kids.length);
}
function vDecks(){
  if(!col)return view.innerHTML=`<p class="empty">No collection yet.<br>Open the Import tab to add an .apkg file.</p>`;
  const z=n=>n?'':' data-z';
  const row=(n,d)=>`<div class="deck" style="padding-left:${d*18}px"><button class="chev" data-tog="${esc(n.full)}">${n.kids.length?(collapsed.has(n.full)?'▸':'▾'):''}</button>
  <button class="dn" data-study="${esc(n.full)}">${esc(n.name)}</button><span class="cnt"><b class="cn"${z(n.n)}>${n.n}</b><b class="cl"${z(n.l)}>${n.l}</b><b class="cr"${z(n.r)}>${n.r}</b></span></div>`
  +(collapsed.has(n.full)?'':n.kids.map(k=>row(k,d+1)).join(''));
  view.innerHTML=`<div class="legend">New · Learn · Due</div>`+tree().map(n=>row(n,0)).join('');
}
function startDeck(full){
  const {now,eod,sod}=times(),ids=new Set(Object.values(col.decks).filter(d=>d.name===full||d.name.startsWith(full+'::')).map(d=>d.id));
  const cs=col.cards.filter(c=>ids.has(c.did)&&active(c));
  const used=cs.filter(c=>c.ft>=sod).length,lim=Math.max(0,set.newPerDay-used);
  start(build(cs,now,eod,lim),full,false);
}
function build(cs,now,eod,lim=1e9){
  const g={n:[],l:[],r:[]};cs.forEach(c=>{const k=kind(c,now,eod);if(k)g[k].push(c);});
  const by=(a,b)=>a.due-b.due;
  return [...g.l.sort(by),...g.r.sort(by),...g.n.sort(by).slice(0,lim)];
}

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
  const s=[...sel];if(!s.length)return alert('Select one or more tags first.');
  if(a==='susp'||a==='resume'){   // suspended tags are hidden from every deck's review queue (reversible)
    set.excluded=a==='susp'?[...new Set([...set.excluded,...s])]:set.excluded.filter(t=>!s.includes(t));
    await DB.put('kv','settings',set);return vTags();}
  const cs=col.cards.filter(c=>!c.susp&&c._t.some(t=>s.includes(t))),{now,eod}=times();
  a==='cram'?start(shuffle(cs),'Cram: '+s.join(', '),true):start(build(cs,now,eod),'Tags: '+s.join(', '),false);
}

// ---------- import / settings ----------
function vImport(){
  view.innerHTML=`<label class="drop" id="dz"><input type="file" id="fi" accept=".apkg,.colpkg,.cmv,.zip">Drop an .apkg / .colpkg / .cmv here<br>or tap to choose a file</label>
  <p id="st" style="color:var(--mut)">${col?`${col.cards.length} cards loaded. Importing replaces the current collection.`:''}</p>
  <div class="sec">New cards per deck / day</div><input type="number" id="np" min="0" value="${set.newPerDay}">
  ${col?`<div class="sec">Danger zone</div><button class="btn" id="wipe" style="background:#dc2626">Delete collection</button>`:''}`;
  const dz=$('#dz');
  ['dragover','dragenter'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('over');}));
  ['dragleave','drop'].forEach(e=>dz.addEventListener(e,()=>dz.classList.remove('over')));
  dz.addEventListener('drop',ev=>{ev.preventDefault();ev.dataTransfer.files[0]&&doImport(ev.dataTransfer.files[0]);});
  $('#fi').onchange=e=>e.target.files[0]&&doImport(e.target.files[0]);
  $('#np').onchange=async e=>{set.newPerDay=Math.max(0,+e.target.value||0);await DB.put('kv','settings',set);};
  const w=$('#wipe');if(w)w.onclick=async()=>{if(!confirm('Delete all cards, media and progress?'))return;
    await Promise.all(['kv','media','state'].map(DB.clear));col=null;set={excluded:[],newPerDay:20};render();};
}
async function doImport(file){
  const st=$('#st');
  if(col&&!confirm('Replace the current collection and progress?'))return;
  try{const r=await importFile(file,m=>st.textContent=m);await load();tab='decks';render();
    setTimeout(()=>alert(`Imported ${r.cards} cards, ${r.media} media files.`),50);}
  catch(e){console.error(e);st.textContent='Import failed: '+e.message;}
}

// ---------- review ----------
function start(q,title,cram){
  if(!q.length)return alert('Nothing to study right now.');
  sess={q,title,cram,cur:null,ans:false};
  $('#rv').hidden=false;$('#rt').textContent=title;nextCard();
}
function exitSess(){sess=null;$('#rv').hidden=true;shadow.innerHTML='';urls.splice(0).forEach(URL.revokeObjectURL);render();}
function nextCard(){
  if(!sess.q.length){alert('Session complete 🎉');return exitSess();}
  sess.cur=sess.q.shift();sess.ans=false;draw();
}
async function draw(){
  const c=sess.cur,n=col.notes[c.nid],m=n&&col.models[n.mid];
  $('#rc').textContent=sess.q.length+1;
  if(!m){return nextCard();}
  const r=renderCard(c,n,m,col.decks[c.did]?.name||'');
  urls.splice(0).forEach(URL.revokeObjectURL);
  shadow.innerHTML=`<style>${BASE}${r.css}</style><div class="card">${sess.ans?r.a:r.q}</div>`;
  $('#pane').scrollTop=0;
  $('#btns').innerHTML=sess.ans?[1,2,3,4].map(i=>`<button class="r${i}" data-r="${i}"><small>${sess.cram?'':label(next(c,i).due-Date.now())}</small>${['Again','Hard','Good','Easy'][i-1]}</button>`).join('')
    :`<button class="show" data-show>Show Answer</button>`;
  await loadMedia(shadow,urls);
}
async function answer(r){
  const c=sess.cur;
  if(sess.cram){if(r===1)sess.q.push(c);}
  else{Object.assign(c,next(c,r));await DB.put('state',c.id,pick(c));if(c.type!==2)sess.q.push(c);}
  nextCard();
}
const reveal=()=>{if(sess&&!sess.ans){sess.ans=true;draw();}};
$('#btns').onclick=e=>{const b=e.target.closest('button');if(!b)return;b.dataset.r?answer(+b.dataset.r):reveal();};
$('#pane').onclick=e=>{if(!window.getSelection().toString())reveal();};
$('#back').onclick=exitSess;
addEventListener('keydown',e=>{if(!sess)return;
  if(e.key===' '||e.key==='Enter'){e.preventDefault();sess.ans?answer(3):reveal();}
  else if(sess.ans&&'1234'.includes(e.key))answer(+e.key);else if(e.key==='Escape')exitSess();});

// ---------- shell ----------
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));
  $('#bar').textContent={decks:'Decks',tags:'Tags',imp:'Import'}[tab];
  ({decks:vDecks,tags:vTags,imp:vImport})[tab]();
}
$('#tabs').onclick=e=>{const t=e.target.dataset.t;if(t){tab=t;render();}};
view.addEventListener('click',e=>{const b=e.target.closest('[data-tog],[data-study],[data-act]');if(!b)return;const d=b.dataset;
  if(d.tog){collapsed.has(d.tog)?collapsed.delete(d.tog):collapsed.add(d.tog);vDecks();}
  else if(d.study)startDeck(d.study);else if(d.act)tagAct(d.act);});
view.addEventListener('change',e=>{const t=e.target.dataset.sel;if(t!=null)e.target.checked?sel.add(t):sel.delete(t);});
view.addEventListener('input',e=>{if(e.target.id==='tq'){tq=e.target.value.toLowerCase();$('#tl').innerHTML=tagList();}});
(async()=>{
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
  navigator.storage?.persist?.();
  await load();render();
})();
