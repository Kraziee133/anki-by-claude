import {clear,put,putMany} from './db.js';
const SQLJS='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',
 mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm'};
let SQL;
// Imports a .apkg/.colpkg/.cmv (all are zips). Replaces the current collection.
export async function importFile(file,say=()=>{}){
  say('Unzipping…');
  const zip=await JSZip.loadAsync(file);
  const name=['collection.anki21','collection.anki2'].find(n=>zip.file(n));
  if(!name) throw new Error(zip.file('collection.anki21b')
    ?'This package uses the new Anki format. Re-export with “Support older Anki versions” ticked.':'No collection database found in this file.');
  say('Opening database…');
  SQL??=await initSqlJs({locateFile:f=>SQLJS+f});
  const db=new SQL.Database(await zip.file(name).async('uint8array'));
  const q=s=>{const r=db.exec(s)[0];return r?r.values:[]};
  const [crt,decksJ,modelsJ]=q('select crt,decks,models from col')[0];
  const decks={},models={};
  for(const [id,d] of Object.entries(JSON.parse(decksJ))) decks[id]={id:+id,name:d.name.replace(/\x1f/g,'::')};
  for(const [id,m] of Object.entries(JSON.parse(modelsJ))) models[id]={name:m.name,type:m.type,css:m.css||'',
    flds:m.flds.map(f=>({name:f.name,ord:f.ord})),tmpls:m.tmpls.map(t=>({name:t.name,ord:t.ord,qfmt:t.qfmt,afmt:t.afmt}))};
  const notes={};
  for(const [id,mid,tags,flds] of q('select id,mid,tags,flds from notes')) notes[id]={mid:String(mid),t:tags,f:flds.split('\x1f')};
  const cards=q('select id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses from cards').map(([id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses])=>({
    id,nid,did,ord,type,susp:queue===-1,
    due:type===0?due:(queue===1?due*1000:(crt+due*86400)*1000),   // new=ordinal, learn=ms, review=ms (day start)
    ivl:ivl<0?1:ivl,ease:factor||2500,reps,lapses,step:0,ft:0}));
  db.close();
  say('Saving collection…');
  await Promise.all([clear('state'),clear('media')]);
  await put('kv','col',{decks,models,notes,cards});
  let media={};
  try{const m=zip.file('media');if(m) media=JSON.parse(await m.async('string'));}catch{ /* new-format media list: unsupported */ }
  const keys=Object.keys(media);
  for(let i=0;i<keys.length;i+=100){
    say(`Media ${Math.min(i+100,keys.length)}/${keys.length}…`);
    const batch=await Promise.all(keys.slice(i,i+100).filter(k=>zip.file(k)).map(async k=>{
      const ext=media[k].split('.').pop().toLowerCase();
      return [media[k],new Blob([await zip.file(k).async('uint8array')],{type:MIME[ext]||''})];}));
    await putMany('media',batch);
  }
  return {cards:cards.length,media:keys.length};
}
