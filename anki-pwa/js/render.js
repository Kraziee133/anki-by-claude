import {get} from './db.js';
const strip=h=>(h||'').replace(/<[^>]*>|&nbsp;/g,'').trim();
const cloze=(t,n,ans)=>t.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
  (m,k,x,h)=>+k===n?`<span class="cloze">${ans?x:'['+(h||'…')+']'}</span>`:x);
const snd=h=>h.replace(/\[sound:([^\]]+)\]/g,(m,n)=>`<audio controls data-m="${n.replace(/"/g,'&quot;')}"></audio>`);
export const BASE=`*{box-sizing:border-box}.card{font:20px/1.45 -apple-system,system-ui,sans-serif;text-align:center;padding:18px;overflow-wrap:anywhere}
img,video,canvas,svg{max-width:100%!important;height:auto!important}table{max-width:100%}audio{max-width:100%}.cloze{font-weight:700;color:#2563eb}
hr{border:0;border-top:1px solid #8884}pre,code{white-space:pre-wrap}`;
// Renders question/answer HTML for a card from its Anki model templates.
export function renderCard(c,note,model,deck){
  const isC=model.type===1,t=isC?model.tmpls[0]:(model.tmpls.find(x=>x.ord===c.ord)||model.tmpls[0]);
  const f={Tags:note.t.trim(),Deck:deck,Type:model.name,Card:t.name};
  model.flds.forEach((x,i)=>f[x.name]=note.f[i]||'');
  const sub=(tpl,front,ans)=>{
    for(let i=0;i<6;i++){const o=tpl;
      tpl=tpl.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g,(m,k,n,b)=>(!!strip(f[n])===(k==='#'))?b:'');
      if(tpl===o)break;}
    return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g,(m,key)=>{
      const p=key.split(':').map(s=>s.trim()),name=p.pop();
      if(name==='FrontSide')return front;
      let v=f[name]??'';
      if(p.includes('type'))return'';
      if(p.includes('cloze'))v=cloze(v,c.ord+1,ans);
      if(p.includes('text'))v=strip(v);
      if(p.includes('hint'))v=`<details><summary>Hint</summary>${v}</details>`;
      return v;});
  };
  return {q:snd(sub(t.qfmt,'',false)),a:snd(sub(t.afmt,sub(t.qfmt,'',true),true)),css:model.css};
}
// Swaps <img src>, <audio data-m> etc. for object URLs of blobs stored in IndexedDB.
export async function loadMedia(root,urls){
  for(const el of root.querySelectorAll('[src],[data-m]')){
    const raw=el.dataset.m||el.getAttribute('src');
    if(!raw||/^(https?:|data:|blob:)/i.test(raw))continue;
    let b=await get('media',raw);
    if(!b){try{b=await get('media',decodeURIComponent(raw));}catch{}}
    if(b){const u=URL.createObjectURL(b);urls.push(u);el.src=u;}
  }
}
