/** Bounded document rendering and file identity for the project code workspace. */
export const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|ino|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|sql|css|scss|less|html?|jsonc?|ya?ml|toml|ini|cfg|xml|sh|bash|zsh|vue|svelte|swift|kt|kts|r|lua|cs)$/i;
export function isCodeFile(name) { return CODE_RE.test(name) || /(?:^|\/)(Dockerfile|Makefile|CMakeLists\.txt|requirements\.txt|Pipfile|Gemfile)$/.test(name); }
export function documentKind(name) {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.(csv|tsv)$/i.test(name)) return 'csv';
  if (/\.xlsx?$/i.test(name)) return 'spreadsheet';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(name)) return 'image';
  if (isCodeFile(name) || /\.(txt|md|markdown|log|gitignore|dockerignore)$/i.test(name)) return 'code';
  return 'file';
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const basename = name => String(name).split('/').pop();
export function parentFolder(name) { return String(name).split('/').slice(0,-1).join('/') || 'references'; }
export function codeFolderFor(entry) {
  if (entry?.folder) return String(entry.folder).startsWith('references/') ? entry.folder : `references/${entry.folder}`;
  const path = entry?.url || entry?.filename || entry?.name || '';
  return parentFolder(path);
}
export function selectRoboticsExplorerProject(projects, currentId, requestedId='') {
  const rows=Array.isArray(projects)?projects:[];
  const current=rows.find(row=>String(row?.id)===String(currentId));
  const requested=rows.find(row=>String(row?.id)===String(requestedId));
  const isOpenArm=row=>/open\s*arm/i.test(String(row?.name||''))&&/(mujoco|demo)/i.test(String(row?.name||''));
  const newest=rows.filter(isOpenArm).sort((a,b)=>(Date.parse(b?.updated_at||'')||0)-(Date.parse(a?.updated_at||'')||0))[0];
  return (isOpenArm(requested)?requested:isOpenArm(current)?current:newest)?.id||currentId;
}
export function projectExplorerOptions(projects, selectedId='') {
  const unique=new Map();
  for(const row of Array.isArray(projects)?projects:[]) if(row?.id&&!unique.has(String(row.id))) unique.set(String(row.id),row);
  return [...unique.values()]
    .map(row=>({id:String(row.id),label:String(row.name||row.id),selected:String(row.id)===String(selectedId)}))
    .sort((a,b)=>Number(b.selected)-Number(a.selected)||a.label.localeCompare(b.label));
}
export function buildFileTree(entries, root='references') {
  const tree = {name:root==='project'?'Project':basename(root),path:root,children:[],folder:true};
  for (const entry of entries) {
    const entryPath=String(entry?.path||'');
    const relative=root==='project'?entryPath:(entryPath.startsWith(root+'/')?entryPath.slice(root.length+1):'');
    if (!relative) continue;
    const parts=relative.split('/'); let node=tree;
    for (let i=0;i<parts.length;i++) {
      const part=parts[i]; const path=node.path+'/'+part;
      if (i===parts.length-1&&!entry.folder&&entry.type!=='directory') node.children.push({...entry,name:part,path:entryPath});
      else { let next=node.children.find(c=>c.folder&&c.path===path); if(!next){next={name:part,path,folder:true,children:[]};node.children.push(next);} node=next; }
    }
  }
  const sort=n=>{n.children.sort((a,b)=>Number(!!b.folder)-Number(!!a.folder)||a.name.localeCompare(b.name));n.children.filter(c=>c.folder).forEach(sort);};sort(tree);return tree;
}
export function searchMatches(text, query, limit=2000) {
  if(!query) return [];
  const src=String(text).toLowerCase(), needle=query.toLowerCase(), hits=[];let pos=0;
  while(hits.length<limit && (pos=src.indexOf(needle,pos))>=0){hits.push(pos);pos+=Math.max(1,needle.length);}return hits;
}
export function highlightCode(text, json=false) {
  // Tokenize before escaping; never apply another replacement to generated HTML.
  const tokens=/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|class|new|int|float|double|void|for|while|if|else|return|def|import|from|export|default|async|await|try|catch|finally|switch|case|break|continue|public|private|static|struct|enum|interface|true|false|null|None|True|False|HIGH|LOW|OUTPUT)\b|\b\d+(?:\.\d+)?\b)/g;
  let out='',at=0;
  for(const match of String(text).matchAll(tokens)) {
    out+=escapeHtml(text.slice(at,match.index));const token=match[0];
    const kind=/^(\/\/|\/\*|#)/.test(token)?'comment':/^["'`]/.test(token)?(json&&/^\s*:/.test(text.slice(match.index+token.length))?'key':'string'):/^\d/.test(token)?'number':'keyword';
    out+=`<span class="code-tok-${kind}">${escapeHtml(token)}</span>`;at=match.index+token.length;
  }
  return out+escapeHtml(text.slice(at));
}
export function mountJsonTree(host, text, query='') {
  host.replaceChildren();let value;
  try{value=JSON.parse(text);}catch(error){host.textContent=`Invalid JSON: ${error.message}. Switch to Raw code to edit.`;return;}
  let budget=2000;
  const q=query.toLowerCase();
  function add(parent,key,val,depth=0){
    if(--budget<0)return;
    const object=val!==null&&typeof val==='object';
    const label=object?`${key} ${Array.isArray(val)?'[':'{'}${Object.keys(val).length}${Array.isArray(val)?']':'}'}`:`${key}: ${JSON.stringify(val)}`;
    if(q&&!label.toLowerCase().includes(q)&&!JSON.stringify(val).toLowerCase().includes(q))return;
    if(object){
      const el=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;el.append(summary);parent.append(el);
      let built=false;const expand=()=>{if(built)return;built=true;for(const [k,v]of Object.entries(val)){if(budget<=0){const note=document.createElement('p');note.textContent='Tree preview limited to 2,000 entries. Search or use Raw code for the full file.';el.append(note);break;}add(el,k,v,depth+1);}};
      el.addEventListener('toggle',()=>{if(el.open)expand();});if(depth<1||q){el.open=true;expand();}
    }else{const el=document.createElement('div');el.className='code-json-leaf';el.innerHTML=highlightCode(label,true);if(q)el.classList.add('is-hit');parent.append(el);}
  }
  add(host,Array.isArray(value)?'Array':'Object',value);
}
export function parseDelimited(text, delimiter=',') {
  const rows=[];let row=[],cell='',quoted=false;const src=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<src.length;i++){
    const c=src[i];if(quoted){if(c==='"'){if(src[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;continue;}
    if(c==='"'&&!cell){quoted=true;continue;}
    if(c===delimiter){row.push(cell);cell='';continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&src[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';if(rows.length>=500)return{rows,truncated:true};continue;}cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}return{rows,truncated:false};
}
export function mountTable(host, rows, query='') {
  const table=document.createElement('table');const body=document.createElement('tbody');table.append(body);host.replaceChildren(table);
  const q=query.toLowerCase();
  rows.forEach((row,index)=>{if(q&&!row.some(c=>String(c).toLowerCase().includes(q)))return;const tr=document.createElement('tr');const number=document.createElement('th');number.textContent=index+1;tr.append(number);for(const cell of row.slice(0,100)){const td=document.createElement('td');td.textContent=String(cell??'');if(q&&td.textContent.toLowerCase().includes(q))td.className='is-hit';tr.append(td);}body.append(tr);});
}
