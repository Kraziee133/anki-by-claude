import {clear,put,putMany,get,keys} from './db.js';
const SQLJS='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
const FZSTD='https://cdn.jsdelivr.net/npm/fzstd@0.1.1/esm/index.mjs';   // lazy-loaded, only for new-format packages
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',
 mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'};
let SQL,fz;
const td=new TextDecoder(),s=v=>v?td.decode(v):'';
const isZ=b=>b.length>3&&b[0]===0x28&&b[1]===0xB5&&b[2]===0x2F&&b[3]===0xFD;       // zstd magic number
const unz=async b=>{if(!isZ(b))return b;
  try{fz??=await import(FZSTD);}catch{throw new Error('Could not load the zstd decoder. Connect to the internet once for this import.');}
  return fz.decompress(b);};
// Minimal protobuf reader → [[fieldNo, varint | Uint8Array]]
export function pb(b){
  const out=[];let i=0;
  const vi=()=>{let r=0,m=1,x;do{x=b[i++];r+=(x&127)*m;m*=128;}while(x&128);return r;};
  while(i<b.length){const k=vi(),f=Math.floor(k/8),w=k&7;
    if(w===0)out.push([f,vi()]);
    else if(w===2){const n=vi();out.push([f,b.subarray(i,i+n)]);i+=n;}
    else if(w===1)i+=8;else if(w===5)i+=4;else break;}
  return out;
}
const g=(a,f)=>a.find(x=>x[0]===f)?.[1];

// Imports .apkg/.colpkg/.cmv (zips) in the legacy (anki2/anki21) AND latest (anki21b, zstd+protobuf) formats.
export async function importFile(file,say=()=>{}){
  say('Unzipping…');
  const zip=await JSZip.loadAsync(file);
  const name=['collection.anki21b','collection.anki21','collection.anki2'].find(n=>zip.file(n));
  if(!name) throw new Error('No collection database found in this file.');
  say('Opening database…');
  SQL??=await initSqlJs({locateFile:f=>SQLJS+f});
  const db=new SQL.Database(await unz(await zip.file(name).async('uint8array')));
  const q=x=>{const r=db.exec(x)[0];return r?r.values:[]};
  // Anki's new tables use a custom "unicase" collation sql.js doesn't have; "not indexed" forces a plain table scan.
  const qt=(cols,tbl,tail='')=>{let err;for(const ni of [' not indexed','']){try{return q(`select ${cols} from ${tbl}${ni} ${tail}`);}catch(e){err=e;}}throw err;};
  const decks={},models={};
  let crt;
  if(q("select count(*) from sqlite_master where name='notetypes'")[0][0]>0){        // schema 18 (latest)
    say('Reading new-format collection…');
    crt=q('select crt from col')[0][0];
    for(const [id,nm,cfg] of qt('id,name,config','notetypes')){const c=pb(cfg);
      models[id]={name:nm,type:g(c,1)||0,css:s(g(c,3)),flds:[],tmpls:[]};}               // kind 1 = cloze
    for(const [nt,ord,nm] of qt('ntid,ord,name','fields','order by ntid,ord')) models[nt]?.flds.push({name:nm,ord});
    for(const [nt,ord,nm,cfg] of qt('ntid,ord,name,config','templates','order by ntid,ord')){const c=pb(cfg);
      models[nt]?.tmpls.push({name:nm,ord,qfmt:s(g(c,1)),afmt:s(g(c,2))});}
    for(const [id,nm] of qt('id,name','decks')) decks[id]={id:+id,name:nm.replace(/\x1f/g,'::')};
  }else{                                                                                 // schema 11 (legacy)
    const [c0,decksJ,modelsJ]=q('select crt,decks,models from col')[0];crt=c0;
    for(const [id,d] of Object.entries(JSON.parse(decksJ))) decks[id]={id:+id,name:d.name.replace(/\x1f/g,'::')};
    for(const [id,m] of Object.entries(JSON.parse(modelsJ))) models[id]={name:m.name,type:m.type,css:m.css||'',
      flds:m.flds.map(f=>({name:f.name,ord:f.ord})),tmpls:m.tmpls.map(t=>({name:t.name,ord:t.ord,qfmt:t.qfmt,afmt:t.afmt}))};
  }
  const nrows=q('select id,guid,mid,tags,flds from notes').map(([id,guid,mid,tags,flds])=>({id,guid,mid:String(mid),t:tags,f:flds.split('\x1f')}));
  if(name==='collection.anki2'&&nrows.length===1&&/latest Anki/i.test(nrows[0].f.join(' ')))
    throw new Error('This file only contains Anki’s “please update” placeholder. Re-export it from Anki.');
  const crows=q('select id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses from cards').map(([id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses])=>({
    id,nid,did,ord,type,susp:queue===-1,
    due:type===0?due:(queue===1?due*1000:(crt+due*86400)*1000),   // new=ordinal, learn=ms, review=ms (day start)
    ivl:ivl<0?1:ivl,ease:factor||2500,reps,lapses,step:0,ft:0}));
  db.close();

  // ---- MERGE into the existing collection (review progress lives in the separate 'state' store and is never touched) ----
  say('Merging…');
  const old=await get('kv','col'),base=old||{decks:{},models:{},notes:{},cards:[]};
  if(!old)await Promise.all([clear('state'),clear('media')]);
  const nk=(m,f)=>'f:'+(m?.name||'')+'\x1f'+f.join('\x1f');              // fallback duplicate key: model + field text
  const seen=new Set();
  for(const n of Object.values(base.notes)){if(n.g)seen.add('g:'+n.g);seen.add(nk(base.models[n.mid],n.f));}
  const ids={n:new Set(Object.keys(base.notes).map(Number)),c:new Set(base.cards.map(c=>c.id)),
    d:new Set(Object.values(base.decks).map(d=>d.id)),m:new Set(Object.keys(base.models))};
  let seq=Date.now();
  const fresh=st=>{let i;do{i=++seq;}while(st.has(i)||st.has(String(i)));st.add(i);return i;};   // collision-free remap
  // models: reuse an identical existing model, else add (remapping the id if it clashes with a different model)
  const msig=m=>JSON.stringify([m.name,m.type,m.css,m.flds.map(f=>f.name),m.tmpls.map(t=>[t.name,t.qfmt,t.afmt])]);
  const bySig=new Map(Object.entries(base.models).map(([id,m])=>[msig(m),id])),mmap={};
  const useModel=mid=>{
    if(mmap[mid]!==undefined)return mmap[mid];const m=models[mid];if(!m)return mmap[mid]=mid;
    const sg=msig(m);let f;
    if(bySig.has(sg))f=bySig.get(sg);
    else{f=ids.m.has(mid)?String(fresh(ids.m)):mid;ids.m.add(f);base.models[f]=m;bySig.set(sg,f);}
    return mmap[mid]=f;};
  // decks: same-named deck → merge into it; otherwise add (new id if clashing)
  const byName=new Map(Object.values(base.decks).map(d=>[d.name,d.id])),dmap={},made=new Set(),used=new Set();
  for(const d of Object.values(decks)){
    if(byName.has(d.name)){dmap[d.id]=byName.get(d.name);continue;}
    const id=ids.d.has(d.id)?fresh(ids.d):d.id;ids.d.add(id);
    base.decks[id]={id,name:d.name};byName.set(d.name,id);dmap[d.id]=id;made.add(id);}
  // notes: skip duplicates (same guid, or same model + fields); remap clashing ids
  const nmap={};let dups=0,added=0;
  for(const n of nrows){
    if(seen.has('g:'+n.guid)||seen.has(nk(models[n.mid],n.f))){dups++;continue;}
    const id=ids.n.has(n.id)?fresh(ids.n):n.id;ids.n.add(id);nmap[n.id]=id;
    base.notes[id]={mid:useModel(n.mid),t:n.t,f:n.f,g:n.guid};}
  for(const c of crows){
    const nid=nmap[c.nid],did=dmap[c.did];if(nid===undefined||did===undefined)continue;
    const id=ids.c.has(c.id)?fresh(ids.c):c.id;ids.c.add(id);
    base.cards.push({...c,id,nid,did});used.add(did);added++;}
  for(const id of made)if(!used.has(id))delete base.decks[id];                         // don't keep empty new decks
  say('Saving collection…');
  await put('kv','col',base);
  // media map: legacy = JSON {"0":"a.jpg"}; latest = zstd-compressed protobuf MediaEntries (zip member = index)
  const media={},mf=zip.file('media');
  if(mf){const raw=await unz(await mf.async('uint8array'));
    try{Object.assign(media,JSON.parse(td.decode(raw)));}
    catch{pb(raw).filter(x=>x[0]===1).forEach((x,i)=>{const e=pb(x[1]);media[g(e,255)??i]=s(g(e,1));});}}
  const mk=Object.keys(media),have=new Set(await keys('media'));let mAdded=0;
  for(let i=0;i<mk.length;i+=100){
    say(`Media ${Math.min(i+100,mk.length)}/${mk.length}…`);
    const batch=await Promise.all(mk.slice(i,i+100).filter(k=>zip.file(k)&&media[k]&&!have.has(media[k])).map(async k=>{
      const ext=media[k].split('.').pop().toLowerCase();
      return [media[k],new Blob([await unz(await zip.file(k).async('uint8array'))],{type:MIME[ext]||''})];}));
    batch.forEach(b=>have.add(b[0]));mAdded+=batch.length;await putMany('media',batch);
  }
  return {merged:!!old,decks:[...made].filter(id=>used.has(id)).length,cards:added,dups,media:mAdded};
}
