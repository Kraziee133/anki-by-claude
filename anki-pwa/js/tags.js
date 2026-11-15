// Pure helpers for hierarchical Anki tags ("A::B::C"). Paths are lower-cased keys (Anki tags are case-insensitive).
export const prefixes=t=>{const p=t.split('::'),o=[];for(let i=1;i<=p.length;i++)o.push(p.slice(0,i).join('::'));return o;};

// Tree of every tag path (parents are created implicitly). n = number of distinct cards at or below the node.
export function buildTree(cards,disp={}){
  const nodes={},roots=[];
  const mk=path=>nodes[path]||(()=>{
    const i=path.lastIndexOf('::'),n=nodes[path]={path,name:(disp[path]||path).split('::').pop(),kids:[],n:0};
    (i<0?roots:mk(path.slice(0,i)).kids).push(n);return n;})();
  for(const c of cards){
    if(c.susp)continue;const seen=new Set();
    for(const t of c._t)for(const p of prefixes(t))seen.add(p);
    for(const p of seen)mk(p).n++;
  }
  const sort=a=>{a.sort((x,y)=>x.name.localeCompare(y.name,undefined,{numeric:true,sensitivity:'base'}));a.forEach(n=>sort(n.kids));};
  sort(roots);return {roots,nodes};
}
// A node's path plus every descendant path
export const subPaths=(nodes,p)=>{const out=[],walk=n=>{out.push(n.path);n.kids.forEach(walk);};nodes[p]?walk(nodes[p]):out.push(p);return out;};

// Excluded-tag list entries: "tag" (exact) or "tag::*" (tag and all subtags, including ones imported later)
export function excluder(list){
  const l=list.map(e=>e.toLowerCase()),ex=new Set(l.filter(e=>!e.endsWith('::*'))),pre=l.filter(e=>e.endsWith('::*')).map(e=>e.slice(0,-3));
  return t=>ex.has(t)||pre.some(p=>t===p||t.startsWith(p+'::'));
}
// Selection (a Set of paths; picking a parent adds all its descendants) → compact exclusion entries
export function suspendEntries(nodes,sel){
  const memo=new Map(),full=p=>{if(!memo.has(p))memo.set(p,subPaths(nodes,p).every(x=>sel.has(x)));return memo.get(p);};
  const out=[];
  for(const p of sel){
    if(!nodes[p]||prefixes(p).slice(0,-1).some(a=>nodes[a]&&full(a)))continue;   // covered by a fully-selected ancestor
    out.push(full(p)?p+'::*':p);
  }
  return out;
}
// Remove the selected paths from the exclusion list (wildcards that are partly selected are expanded to exact tags)
export function resumeEntries(nodes,excluded,sel){
  const out=[];
  for(const e of excluded.map(x=>x.toLowerCase())){
    if(!e.endsWith('::*')){if(!sel.has(e))out.push(e);continue;}
    const all=subPaths(nodes,e.slice(0,-3));
    if(all.every(p=>!sel.has(p)))out.push(e);else all.forEach(p=>{if(!sel.has(p))out.push(p);});
  }
  return [...new Set(out)];
}
