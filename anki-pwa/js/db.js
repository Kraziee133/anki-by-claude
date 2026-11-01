// Tiny promise wrapper over IndexedDB. Stores: kv (collection+settings), media (Blobs), state (per-card scheduling)
const S=['kv','media','state'];let _db;
const open=()=>_db||(_db=new Promise((res,rej)=>{const r=indexedDB.open('anki-reviewer',1);
  r.onupgradeneeded=()=>S.forEach(s=>r.result.createObjectStore(s));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}));
const tx=async(s,m,f)=>{const d=await open();return new Promise((res,rej)=>{const t=d.transaction(s,m),o=f(t.objectStore(s));
  t.oncomplete=()=>res(o&&o.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);});};
export const get=(s,k)=>tx(s,'readonly',o=>o.get(k));
export const put=(s,k,v)=>tx(s,'readwrite',o=>o.put(v,k));
export const clear=s=>tx(s,'readwrite',o=>o.clear());
export const putMany=(s,e)=>tx(s,'readwrite',o=>{e.forEach(([k,v])=>o.put(v,k));});
export const all=async s=>{const d=await open();return new Promise(res=>{const out={},r=d.transaction(s).objectStore(s).openCursor();
  r.onsuccess=()=>{const c=r.result;if(c){out[c.key]=c.value;c.continue();}else res(out);};});};
