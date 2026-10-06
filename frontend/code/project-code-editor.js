import { basename, parentFolder, buildFileTree, documentKind, isCodeFile, escapeHtml, highlightCode, mountJsonTree, mountTable, parseDelimited, searchMatches, projectExplorerOptions } from './code-documents.js?v=20260923-project-explorer1';
import { isModelFilename, isExecutableFilename } from '../components/project-code.js?v=foldcode1-code1';

export const CODE_WORKSPACE_TAB = '__project_code__';
export const CODE_NEW_FILES_TAB = '__code_new_files__';
const SIM_TAB='__wiring_simulation__';
const cssUrl=new URL('./project-code-editor.css?v=20260923-project-explorer1',import.meta.url).href;

export function createProjectCodeEditor({host,docTabs,api,rawFetch,getProjectId,getProjects=()=>[],getAiFields=()=>({}),onRefresh=()=>{},onStatus=()=>{},onShare=null,onAskAgent=null,onOpenModel=null,onOpenImage=null,onNewFile=null,allowSimulate=true,baseUrl=null,shareMode='edit'}){
  if(!document.querySelector('link[data-code-workspace]')){const link=document.createElement('link');link.rel='stylesheet';link.href=cssUrl;link.dataset.codeWorkspace='1';document.head.append(link);}
  const shell=document.createElement('section');shell.className='project-code hidden';shell.setAttribute('aria-label','Project code editor');host.append(shell);
  shell.innerHTML=`<header class="code-head"><div><strong data-workspace-title>Project Code</strong><small data-root-label>Reference files</small></div><div class="code-actions"><label class="code-project-picker">Project <select data-project-select aria-label="Select project"></select></label><button data-hide-tree title="Hide project tree">Hide tree</button><button data-new-folder>New folder</button><button data-ask-agent>Render Agent</button><button data-share>Share</button><button data-upload-files>Upload files / ZIP</button><button data-upload-folder>Upload folder</button><button data-refresh>Refresh tree</button></div><input hidden type="file" multiple data-file-input><input hidden type="file" multiple webkitdirectory data-folder-input></header>
    <div class="code-workbench"><button type="button" class="code-tree-expand hidden" data-show-tree title="Show project tree">Tree</button><aside class="code-explorer"><div class="code-explorer-title">EXPLORER</div><input type="search" data-tree-search placeholder="Find a file…" aria-label="Filter file tree"><div data-file-tree></div></aside>
    <main class="code-main"><div class="code-file-tabs" role="tablist" aria-label="Code editor files"></div>
    <div class="code-toolbar"><input type="search" data-code-search placeholder="Search in file…" aria-label="Search in code"><span data-match-count></span><button data-search-prev title="Previous match" aria-label="Previous match">↑</button><button data-search-next title="Next match" aria-label="Next match">↓</button><div data-view-options></div><button data-save>Save</button><button data-download>Download</button></div>
    <div class="code-simulation-bar" hidden><select data-wiring-select aria-label="Electronics wiring project"><option value="">Select electronics wiring…</option></select><button data-run>▶ Run simulation</button><button data-stop>■ Stop</button><small>AI behavioral preview</small></div>
    <div class="code-document" data-document></div><div class="code-sim-view hidden"><div data-sim-canvas></div><details class="code-sim-instructions"><summary>Simulation instructions</summary><pre data-sim-instructions>No simulation has been generated.</pre></details></div>
    <footer class="code-status" role="status"><span data-status>Open a file from the explorer.</span><span data-file-info></span></footer></main></div>`;
  const $=s=>shell.querySelector(s), surface=$('[data-document]'),treeEl=$('[data-file-tree]'),tabsEl=$('.code-file-tabs');
  let pid=null,root='references',files=[],entries=[],projectMeta=null,active=null,visible=false,generation=0,loadSequence=0,filesQuery='',query='',hitIndex=-1,workspaceTitle='Project Code',workspaceTabLabel='Project Code';
  let tabs=new Map(),wiringProjects=[],wiringId='',preview=null,simPlan=null,busy=false,planStale=false,treeHidden=false,created=[];
  const canEdit=()=>shareMode==='edit';
  const expanded=new Set();const draftsKey=id=>`render3d:code-drafts:${id}`;
  let disposeDocument=null;
  const base=()=> (typeof baseUrl==='function'?baseUrl(pid):baseUrl) || `/api/projects/${encodeURIComponent(pid)}/code`;
  const status=(message,error=false)=>{const el=$('[data-status]');el.textContent=message;el.classList.toggle('is-error',error);};
  function renderProjectPicker(){const select=$('[data-project-select]');const options=projectExplorerOptions(getProjects(),pid);select.replaceChildren();for(const row of options)select.append(new Option(row.label,row.id,row.selected,row.selected));select.closest('.code-project-picker').hidden=options.length<2;}
  const persist=(discard=null)=>{if(!pid)return;try{const parked=new Map(JSON.parse(sessionStorage.getItem(draftsKey(pid))||'[]').map(t=>[t.path,t]));for(const tab of tabs.values()){if(tab.dirty)parked.set(tab.path,{path:tab.path,text:tab.text,revision:tab.revision});else if(!tab.loading&&!tab.error)parked.delete(tab.path);}if(discard)parked.delete(discard);sessionStorage.setItem(draftsKey(pid),JSON.stringify([...parked.values()]));}catch{status('Draft storage is full. Save your files before leaving.',true);}};
  function parkedDraft(path){try{return JSON.parse(sessionStorage.getItem(draftsKey(pid))||'[]').find(t=>t.path===path);}catch{return null;}}
  function dirtyChanged(){persist();docTabs.setDirty(CODE_WORKSPACE_TAB,[...tabs.values()].some(t=>t.dirty));renderTabs();}
  function invalidatePlan(){if(simPlan){planStale=true;preview?.stop();status('Code changed. Run simulation again to regenerate instructions.');}}
  function renderTabs(){
    tabsEl.replaceChildren();
    for(const tab of tabs.values()){
      const btn=document.createElement('button');btn.type='button';btn.className='code-file-tab'+(active===tab.path?' active':'');btn.setAttribute('role','tab');btn.setAttribute('aria-selected',String(active===tab.path));btn.title=tab.path;btn.innerHTML=`<span class="code-file-badge">${escapeHtml(tab.kind==='code'?(tab.path.split('.').pop()||'code'):tab.kind)}</span><span>${escapeHtml(basename(tab.path))}${tab.dirty?' •':''}</span>`;btn.onclick=()=>activate(tab.path);
      const close=document.createElement('span');close.className='code-tab-close';close.textContent='×';close.setAttribute('role','button');close.tabIndex=0;close.setAttribute('aria-label',`Close ${basename(tab.path)}`);
      const closeIt=e=>{e.stopPropagation();if(tab.dirty&&!window.confirm(`Discard unsaved changes to ${basename(tab.path)}?`))return;URL.revokeObjectURL(tab.url||'');tabs.delete(tab.path);persist(tab.path);if(active===tab.path)activate(tabs.keys().next().value||null);dirtyChanged();};close.onclick=closeIt;close.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();closeIt(e);}};btn.append(close);tabsEl.append(btn);
    }
    if(wiringProjects.length){const btn=document.createElement('button');btn.type='button';btn.className='code-file-tab'+(active===SIM_TAB?' active':'');btn.setAttribute('role','tab');btn.setAttribute('aria-selected',String(active===SIM_TAB));btn.textContent='◈ 3D Wiring';btn.onclick=()=>activate(SIM_TAB);tabsEl.append(btn);}
  }
  function renderTree(){
    const filtered=entries.filter(f=>!filesQuery||f.path.toLowerCase().includes(filesQuery.toLowerCase()));const tree=buildFileTree(filtered,root);treeEl.replaceChildren();
    const add=(item,host,depth)=>{
      if(item.folder){const details=document.createElement('details');details.open=depth===0||!!filesQuery||expanded.has(item.path);const summary=document.createElement('summary');summary.textContent=item.name;details.append(summary);details.ontoggle=()=>{if(details.open)expanded.add(item.path);else expanded.delete(item.path);};for(const child of item.children)add(child,details,depth+1);host.append(details);}
      else{const btn=document.createElement('button');btn.type='button';btn.className='code-tree-file'+(active===item.path?' active':'');btn.title=item.path;btn.dataset.codeFile=item.path;btn.innerHTML=`<span class="code-tree-icon">${escapeHtml(documentKind(item.path)==='code'?'‹/›':documentKind(item.path)==='image'?'▧':isModelFilename(item.path)?'◈':'▤')}</span><span>${escapeHtml(item.name)}</span>`;btn.onclick=()=>{if(isModelFilename(item.path)){onOpenModel?.(item.path);return;}if(documentKind(item.path)==='image'&&onOpenImage){onOpenImage(item.path);void openFile(item.path);return;}void openFile(item.path);};host.append(btn);}
    };add(tree,treeEl,0);if(!filtered.length){const empty=document.createElement('p');empty.textContent=filesQuery?'No matching files.':'Upload code or select another folder.';treeEl.append(empty);}
    const rootLabel=root==='project'?'Project files':root.replace(/^references\//,'');
    $('[data-root-label]').textContent=projectMeta?`${projectMeta.name} · ${projectMeta.id} · ${rootLabel}`:rootLabel;
  }
  let codeManifestAbort = null; // leakfix107
  function beginCodeManifestFetch() {
    if (codeManifestAbort) {
      try { codeManifestAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    codeManifestAbort = ctl;
    return ctl;
  }
  async function refresh(){
    if(!pid){
      if(codeManifestAbort){try{codeManifestAbort.abort();}catch(_){}}
      return;
    }
    const ctl=beginCodeManifestFetch();
    const run=generation,target=pid,targetRoot=root;status('Loading folder…');
    try{
      const data=await api(`${base()}/manifest?root=${encodeURIComponent(targetRoot)}`,{signal:ctl.signal});
      if(ctl.signal.aborted)return;
      if(run!==generation||target!==pid||targetRoot!==root)return;
      files=data.files||[];entries=data.entries||files;projectMeta=data.project||null;renderTree();status(`${files.length} files${data.truncated?' · First 2,000 entries shown':''}`);
    }catch(e){
      if(ctl.signal.aborted||e?.name==='AbortError')return;
      if(run===generation&&targetRoot===root)status(e.message,true);
    }
  }
  function codeInput(tab){
    const wrap=document.createElement('div');wrap.className='code-source';const pre=document.createElement('pre');pre.className='code-highlight';pre.setAttribute('aria-hidden','true');const input=document.createElement('textarea');input.className='code-input';input.spellcheck=false;input.wrap='off';input.value=tab.text||'';input.readOnly=!tab.editable;input.setAttribute('aria-label',`Source code ${basename(tab.path)}`);wrap.append(pre,input);surface.append(wrap);
    let timer=0;const paint=()=>{pre.innerHTML=highlightCode(input.value,tab.kind==='json')+'\n';pre.scrollTop=input.scrollTop;pre.scrollLeft=input.scrollLeft;};paint();
    input.addEventListener('input',()=>{tab.text=input.value;tab.dirty=tab.text!==tab.saved;clearTimeout(timer);timer=setTimeout(paint,80);dirtyChanged();invalidatePlan();updateSearch(false);});input.addEventListener('scroll',()=>{pre.scrollTop=input.scrollTop;pre.scrollLeft=input.scrollLeft;});
    input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Tab'&&!input.readOnly){e.preventDefault();input.setRangeText('  ',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));}if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();void saveActive();}if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();$('[data-code-search]').focus();}});
    const cursor=()=>{const before=input.value.slice(0,input.selectionStart),lines=before.split('\n');$('[data-file-info]').textContent=`Ln ${lines.length}, Col ${lines.at(-1).length+1} · ${tab.editable?'UTF-8':'Read only'}`;};input.addEventListener('click',cursor);input.addEventListener('keyup',cursor);cursor();
  }
  function renderDocument(){
    disposeDocument?.();disposeDocument=null;
    const tab=tabs.get(active);surface.replaceChildren();$('[data-view-options]').replaceChildren();$('[data-save]').disabled=!tab?.editable;$('[data-download]').disabled=!tab;
    surface.classList.remove('is-structured');$('[data-file-info]').textContent='';
    status(!tab?'Open a file from the explorer.':tab.error|| (tab.loading?'Opening file…':`${basename(tab.path)}${tab.dirty?' · Unsaved draft':tab.editable?' · Ready to edit':' · Read only'}`),!!tab?.error);
    const searchable=tab&&['code','json','csv','spreadsheet'].includes(tab.kind);$('[data-code-search]').disabled=!searchable;$('[data-search-prev]').disabled=!searchable;$('[data-search-next]').disabled=!searchable;
    if(!tab){surface.innerHTML='<div class="code-empty"><span>‹/›</span><h3>Your project, file by file</h3><p>Open code, JSON, spreadsheets, PDFs, and images from the explorer.</p></div>';return;}
    if(tab.loading){surface.textContent='Opening file…';return;}if(tab.error){surface.textContent=tab.error;return;}
    const toggle=(label,mode)=>{const btn=document.createElement('button');btn.textContent=label;btn.classList.toggle('active',tab.mode===mode);btn.onclick=()=>{tab.mode=mode;renderDocument();updateSearch(false);};$('[data-view-options]').append(btn);};
    if(tab.kind==='json'){toggle('Raw code','raw');toggle('Tree','tree');}
    if(tab.kind==='csv'){toggle('Raw code','raw');toggle('Table','table');}
    if(tab.kind==='spreadsheet'&&tab.sheet){const select=document.createElement('select');select.setAttribute('aria-label','Worksheet');tab.sheet.sheets.forEach((name,i)=>{const opt=new Option(name,String(i));select.append(opt);});select.value=String(tab.sheet.sheet);select.onchange=()=>void loadSheet(tab,Number(select.value));$('[data-view-options]').append(select);}
    if(tab.kind==='json'&&tab.mode==='tree'){surface.classList.add('is-structured');mountJsonTree(surface,tab.text,query);}
    else if(tab.kind==='csv'&&tab.mode==='table'){surface.classList.add('is-structured');const parsed=parseDelimited(tab.text,/\.tsv$/i.test(tab.path)?'\t':',');mountTable(surface,parsed.rows,query);if(parsed.truncated)status('Table preview: first 500 rows. Raw code contains the complete file.');}
    else if(tab.kind==='spreadsheet'){surface.classList.add('is-structured');mountTable(surface,tab.sheet?.rows||[],query);status(tab.sheet?.truncated?'Worksheet preview limited to 500 rows / 100 columns.':'Spreadsheet preview · stored cell values and formulas');}
    else if(['code','json','csv'].includes(tab.kind)){surface.classList.remove('is-structured');codeInput(tab);}
    else if(tab.kind==='hex'){surface.classList.remove('is-structured');const pre=document.createElement('pre');pre.className='code-hex';pre.textContent=tab.text||'';surface.append(pre);}
    else if(tab.kind==='image'){const img=document.createElement('img');img.className='code-image';img.src=tab.url;img.alt=basename(tab.path);surface.append(img);}
    else if(tab.kind==='pdf'){const host=document.createElement('div');host.textContent='Opening PDF…';surface.append(host);void import('./code-pdf-preview.js?v=20260915-code-workspace3').then(({mountPdfPreview})=>{if(surface.firstElementChild===host)disposeDocument=mountPdfPreview(host,tab.url);}).catch(error=>{if(host.isConnected)host.textContent=error.message;});}
    else{surface.innerHTML='<div class="code-empty"><h3>Preview unavailable for this file type</h3><p>Use Download to open it in another application.</p></div>';}
  }
  function updateSearch(navigate=true,direction=1){
    const tab=tabs.get(active);if(!tab)return;const searchText=tab.kind==='spreadsheet'?(tab.sheet?.rows||[]).map(row=>row.join('\t')).join('\n'):tab.text||'';const hits=searchMatches(searchText,query);if(navigate)hitIndex=(hitIndex+direction+hits.length)%Math.max(1,hits.length);
    $('[data-match-count]').textContent=query?`${hits.length?Math.max(0,hitIndex)+1:0} / ${hits.length}${hits.length>=2000?'+':''}`:'';
    if(tab.mode==='tree'||tab.mode==='table'||tab.kind==='spreadsheet'){if(navigate)renderDocument();return;}
    const input=surface.querySelector('textarea');if(navigate&&input&&hits.length){const pos=hits[Math.max(0,hitIndex)];input.focus();input.setSelectionRange(pos,pos+query.length);input.scrollTop=Math.max(0,(input.value.slice(0,pos).split('\n').length-4)*21);input.dispatchEvent(new Event('scroll'));}
  }
  function activate(path){active=path;query=tabs.get(path)?.query||'';$('[data-code-search]').value=query;hitIndex=-1;const sim=path===SIM_TAB;surface.classList.toggle('hidden',sim);$('.code-sim-view').classList.toggle('hidden',!sim);$('.code-toolbar').classList.toggle('hidden',sim);preview?.setVisible(visible&&sim);renderTabs();renderTree();if(!sim){renderDocument();updateSearch(false);}else if(!wiringId)status('Select the electronics wiring project to view or simulate.');}
  async function loadSheet(tab,sheet=0){const run=generation;try{const data=await api(`${base()}/spreadsheet?path=${encodeURIComponent(tab.path)}&sheet=${sheet}`);if(run!==generation)return;tab.sheet=data;if(active===tab.path)renderDocument();}catch(e){tab.error=e.message;if(active===tab.path)renderDocument();}}
  async function openFile(path){
    if(!pid)return;const existing=tabs.get(path);if(existing){activate(path);return;}
    if(tabs.size>=24){status('Close a tab before opening another (24 open files maximum).',true);return;}
    const record=files.find(f=>f.path===path);const tab={path,kind:isExecutableFilename(path)?'hex':documentKind(path),editable:canEdit()&&!!record?.editable,loading:true,mode:/\.json$/i.test(path)?'tree':/\.(csv|tsv)$/i.test(path)?'table':'raw',dirty:false};tabs.set(path,tab);activate(path);const run=generation;
    try{
      if(['code','json','csv'].includes(tab.kind)){const data=await api(`${base()}/text?path=${encodeURIComponent(path)}`);if(run!==generation)return;tab.text=tab.saved=data.content;tab.revision=data.revision;const draft=parkedDraft(path);if(draft&&tab.editable){tab.text=draft.text;tab.revision=draft.revision;tab.dirty=tab.text!==tab.saved;status('Restored your unsaved draft. Save when ready.');}}
      else if(tab.kind==='hex'||tab.kind==='file'){const data=await api(`${base()}/hex?path=${encodeURIComponent(path)}`);if(run!==generation)return;tab.kind='hex';tab.text=data.content;tab.editable=false;status(data.executable?'Stored executable — hex view only, never run.':(data.truncated?'Hex preview of the first 4 KB.':'Hex view'));}
      else if(tab.kind==='spreadsheet'){await loadSheet(tab);}
      else if(['pdf','image'].includes(tab.kind)){const res=await rawFetch(`${base()}/content?path=${encodeURIComponent(path)}`);if(!res.ok)throw new Error('Could not load preview.');const blob=await res.blob();if(run!==generation)return;tab.url=URL.createObjectURL(new Blob([blob],{type:tab.kind==='pdf'?'application/pdf':(/\.svg$/i.test(path)?'image/svg+xml':blob.type)}));}
    }catch(error){tab.error=error.message;status(error.message,true);}finally{if(run===generation){tab.loading=false;if(active===path)renderDocument();renderTabs();}}
  }
  async function saveActive(){const tab=tabs.get(active);if(!tab?.editable||!canEdit()||tab.saving)return;const run=generation,content=tab.text;tab.saving=true;status('Saving…');try{const result=await api(`${base()}/text`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:tab.path,content,revision:tab.revision})});if(run!==generation)return;tab.revision=result.revision;tab.saved=content;tab.dirty=tab.text!==content;dirtyChanged();status(`Saved ${basename(tab.path)}`);void onRefresh();}catch(error){status(error.message,true);}finally{tab.saving=false;}}
  async function download(){const tab=tabs.get(active);if(!tab)return;try{let blob;if(['code','json','csv'].includes(tab.kind)&&typeof tab.text==='string')blob=new Blob([tab.text],{type:'text/plain'});else{const res=await rawFetch(`${base()}/content?path=${encodeURIComponent(tab.path)}`);if(!res.ok)throw new Error('Download failed.');blob=await res.blob();}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=basename(tab.path);a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){status(e.message,true);}}
  async function importFiles(list){if(!list.length)return;const run=generation;status('Uploading project code…');const form=new FormData();for(const f of list)form.append('uploads',f);form.append('paths',JSON.stringify(list.map(f=>f.webkitRelativePath||f.name)));form.append('name',list[0].webkitRelativePath?.split('/')[0]||basename(list[0].name).replace(/\.[^.]+$/,''));try{const res=await rawFetch(`${base()}/upload`,{method:'POST',body:form});const data=await res.json();if(!res.ok)throw new Error(data.detail||'Upload failed');if(run!==generation)return;root=data.root;created.push(data.root);await refresh();await onRefresh();status('Uploaded code folder. Open a file from the explorer.');if(onNewFile){onNewFile(data.root,data);docTabs?.upsert?.({id:CODE_NEW_FILES_TAB,label:'New files',kind:'code'});}}catch(e){status(e.message,true);}}
  async function createFolder(){if(!canEdit())return;const name=window.prompt('New folder name');if(!name?.trim())return;status('Creating folder…');try{const data=await api(`${base()}/folders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parent:root==='project'?'references':root,name:name.trim()})});await refresh();await onRefresh();status(`Created ${data.path}`);}catch(e){status(e.message||'Could not create folder.',true);}}
  let codeWiringProjectsAbort = null; // leakfix108
  function beginCodeWiringProjectsFetch() {
    if (codeWiringProjectsAbort) {
      try { codeWiringProjectsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    codeWiringProjectsAbort = ctl;
    return ctl;
  }
  async function loadWiringProjects(){
    if(!allowSimulate){$('.code-simulation-bar').hidden=true;return;}
    if(!pid){
      if(codeWiringProjectsAbort){try{codeWiringProjectsAbort.abort();}catch(_){}}
      return;
    }
    const ctl=beginCodeWiringProjectsFetch();
    const run=generation;
    try{
      const data=await api(`${base()}/wiring-projects`,{signal:ctl.signal});
      if(ctl.signal.aborted)return;
      if(run!==generation)return;
      wiringProjects=data.projects||[];
      const select=$('[data-wiring-select]');
      select.replaceChildren(new Option('Select electronics wiring…',''));
      for(const row of wiringProjects)select.append(new Option(`${row.name}${row.id===pid?' (this project)':''} · ${row.components} parts`,row.id));
      select.value=wiringId;
      $('.code-simulation-bar').hidden=!wiringProjects.length;
      renderTabs();
    }catch(e){
      if(ctl.signal.aborted||e?.name==='AbortError')return;
      status(`Wiring projects could not be loaded: ${e.message}`,true);
    }
  }
  async function ensurePreview(){if(preview)return preview;const mod=await import('./code-wiring-preview.js?v=20260916-wiring-repair-2-harness2-harness3-gpu-recovery3-gpu-recovery4-gpu-recovery5-webglfb1&gpu=20260916-startup2&gpu=20260916-startup3');preview=mod.createCodeWiringPreview($('[data-sim-canvas]'),{onStatus:message=>status(message)});return preview;}
  async function selectWiring(){wiringId=$('[data-wiring-select]').value;simPlan=null;planStale=false;preview?.stop();if(!wiringId)return;const selected=wiringId,run=generation;status('Loading selected wiring…');try{const data=await api(`/api/projects/${encodeURIComponent(selected)}/wiring`);if(selected!==wiringId||run!==generation)return;activate(SIM_TAB);const view=await ensurePreview();if(selected!==wiringId||run!==generation)return;view.load(data);view.setVisible(visible&&active===SIM_TAB);$('[data-sim-instructions]').textContent='Edit your code, then Run simulation to generate matching instructions.';}catch(e){status(e.message,true);}}
  function mismatch(messages){const dialog=document.createElement('dialog');dialog.className='code-mismatch';dialog.innerHTML='<h3>Code and wiring do not match</h3><p>Select the electronics project that matches these libraries, pins, and parts, or update the code.</p><ul></ul><button>Back to editor</button>';for(const message of messages){const li=document.createElement('li');li.textContent=message;dialog.querySelector('ul').append(li);}dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}
  async function runSimulation(){
    if(busy)return;if(!wiringId){$('[data-wiring-select]').focus();status('Select the matching electronics wiring project first.',true);return;}
    const sourceFiles=files.filter(f=>isCodeFile(f.path)&&f.editable);if(!sourceFiles.length){mismatch(['This folder has no editable source code to simulate.']);return;}
    if(sourceFiles.length>40){mismatch(['Open the smaller source folder containing the firmware (maximum 40 source files).']);return;}
    const run=generation,selected=wiringId;const drafts=Object.fromEntries([...tabs.values()].filter(t=>typeof t.text==='string'&&sourceFiles.some(f=>f.path===t.path)).map(t=>[t.path,t.text]));const snapshot=JSON.stringify(drafts);busy=true;$('[data-run]').disabled=true;status('Checking libraries and hardware; generating simulation instructions…');
    try{const result=await api(`${base()}/simulation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wiring_project_id:selected,paths:sourceFiles.map(f=>f.path),drafts,...getAiFields()})});if(run!==generation||selected!==wiringId)return;
      const latest=Object.fromEntries([...tabs.values()].filter(t=>typeof t.text==='string'&&sourceFiles.some(f=>f.path===t.path)).map(t=>[t.path,t.text]));if(snapshot!==JSON.stringify(latest)){status('Code changed during generation. Run simulation again with the latest edits.',true);return;}
      if(!result.compatible){mismatch(result.mismatches||['No matching behavior could be verified.']);status('Simulation blocked: code and wiring do not match.',true);return;}
      simPlan=result;planStale=false;activate(SIM_TAB);const view=await ensurePreview();if(run!==generation||selected!==wiringId)return;view.load(result.schematic);view.setVisible(visible);$('[data-sim-instructions]').textContent=`${result.preview_kind}\n${result.summary}\n\n${JSON.stringify(result.actions,null,2)}`;view.run(result);
    }catch(e){status(e.message,true);}finally{if(run===generation){busy=false;$('[data-run]').disabled=false;}}
  }
  $('[data-tree-search]').oninput=e=>{filesQuery=e.target.value;renderTree();};$('[data-code-search]').oninput=e=>{query=e.target.value;const tab=tabs.get(active);if(tab)tab.query=query;hitIndex=-1;updateSearch(true);$('[data-code-search]').focus();};$('[data-code-search]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();updateSearch(true,e.shiftKey?-1:1);}};
  $('[data-search-prev]').onclick=()=>updateSearch(true,-1);$('[data-search-next]').onclick=()=>updateSearch(true,1);$('[data-save]').onclick=()=>void saveActive();$('[data-download]').onclick=()=>void download();$('[data-refresh]').onclick=()=>void refresh();
  $('[data-new-folder]').onclick=()=>void createFolder();
  $('[data-project-select]').onchange=e=>{const next=String(e.target.value||'');if(next&&next!==pid)void open({projectId:next,folder:'project',title:workspaceTitle,tabLabel:workspaceTabLabel});};
  $('[data-upload-files]').onclick=()=>$('[data-file-input]').click();$('[data-upload-folder]').onclick=()=>$('[data-folder-input]').click();for(const sel of ['[data-file-input]','[data-folder-input]'])$(sel).onchange=e=>{void importFiles([...e.target.files]);e.target.value='';};
  $('[data-wiring-select]').onchange=()=>void selectWiring();$('[data-run]').onclick=()=>void runSimulation();$('[data-stop]').onclick=()=>preview?.stop();
  $('[data-share]').onclick=()=>onShare?.({root,files,active});
  $('[data-share]').hidden=!onShare;
  $('[data-ask-agent]').onclick=()=>onAskAgent?.({root,files,active});
  $('[data-ask-agent]').hidden=!onAskAgent;
  const setTreeHidden=(hidden)=>{treeHidden=hidden;shell.classList.toggle('code-tree-collapsed',hidden);$('[data-show-tree]').classList.toggle('hidden',!hidden);$('.code-explorer').classList.toggle('hidden',hidden);};
  $('[data-hide-tree]').onclick=()=>setTreeHidden(true);$('[data-show-tree]').onclick=()=>setTreeHidden(false);
  if(!canEdit()){$('[data-new-folder]').hidden=true;$('[data-upload-files]').hidden=true;$('[data-upload-folder]').hidden=true;$('[data-save]').hidden=shareMode!=='edit';}
  shell.addEventListener('keydown',e=>e.stopPropagation());
  shell.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();e.stopPropagation();}});shell.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();e.stopPropagation();void importFiles([...e.dataTransfer.files]);}});
  function hide(){visible=false;shell.classList.add('hidden');preview?.setVisible(false);persist();}
  function clear(){if(codeManifestAbort){try{codeManifestAbort.abort();}catch(_){}}if(codeWiringProjectsAbort){try{codeWiringProjectsAbort.abort();}catch(_){}}persist();disposeDocument?.();disposeDocument=null;generation++;for(const tab of tabs.values())if(tab.url)URL.revokeObjectURL(tab.url);tabs.clear();files=[];entries=[];projectMeta=null;active=null;pid=null;wiringId='';wiringProjects=[];preview?.dispose();preview=null;simPlan=null;busy=false;hide();}
  async function open({filename=null,folder=null,projectId=getProjectId(),title='Project Code',tabLabel='Project Code'}={}){
    if(!projectId)throw new Error('Open a project first.');
    if(pid!==projectId){clear();pid=projectId;root='references';}
    const targetRoot=folder||(filename?parentFolder(filename):root);root=targetRoot==='project'||targetRoot?.startsWith('references')?targetRoot:`references/${targetRoot}`;
    workspaceTitle=title;workspaceTabLabel=tabLabel;visible=true;shell.classList.remove('hidden');$('[data-workspace-title]').textContent=title;renderProjectPicker();docTabs.upsert({id:CODE_WORKSPACE_TAB,label:tabLabel,kind:'code-project'});docTabs.setActive(CODE_WORKSPACE_TAB);const run=++loadSequence;
    await refresh();if(run!==loadSequence||pid!==projectId)return;void loadWiringProjects();if(filename)await openFile(filename);else activate(active);preview?.setVisible(active===SIM_TAB);
  }
  window.addEventListener('beforeunload',e=>{if([...tabs.values()].some(t=>t.dirty)){persist();e.preventDefault();e.returnValue='';}});
  return{open,hide,clear,activate(){visible=true;shell.classList.remove('hidden');activate(active);preview?.setVisible(active===SIM_TAB);},close(){hide();docTabs.remove(CODE_WORKSPACE_TAB);},isActive:()=>visible,setTreeHidden,root:()=>root,createdFiles:()=>created};
}
