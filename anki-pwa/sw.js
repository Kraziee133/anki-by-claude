// Bump V on every deploy so clients pick up new files.
const V='anki-v3';
const SHELL=['./','index.html','manifest.json','css/app.css','js/app.js','js/db.js','js/importer.js','js/scheduler.js','js/render.js','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];
const CDN=['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',
'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm',
'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/esm/index.mjs'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const c=await caches.open(V);await c.addAll(SHELL);
  await Promise.allSettled(CDN.map(u=>c.add(u)));self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{
    if(res.ok){const cp=res.clone();caches.open(V).then(c=>c.put(e.request,cp));}return res;
  }).catch(()=>caches.match('./'))));
});
