import { authHeaders } from "./auth.js";
import { defaultTextModel } from "../components/ai-model-defaults.js?v=astra-default1&astraoffice=20260917-1&gpt61sol=20261001-1";
import { triggerTrackedBlobDownload } from "../viewport/viewport-video-editor.js?v=leakfix8";

const microDownloadCreated = [];

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const MICRO_VARIANTS = {minimal:"Minimal operations", constraints:"Check preservation", "mount-first":"Mounting and fit"};
export const RATING_CATEGORIES = {intent:"Matches the request", dimensions:"Dimensional accuracy", preservation:"Unrelated parts preserved", mount_fit:"Mounting / assembly fit", overall:"Overall result"};
export function trialCount(models) { return models.reduce((sum, model) => sum + Number(model.count || 0), 0); }
export function defaultMicroModel(options, current) {
  return defaultTextModel(options, current);
}
async function api(path, body) {
  const result = await fetch(`/api/micro-edits${path}`, {method:body ? "POST" : "GET", headers:{...authHeaders(),"Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined});
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Micro edit request failed (${result.status})`);
  return data;
}
function modal(title) {
  const node = document.createElement("dialog"); node.className = "assist-dialog micro-dialog";
  node.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close">×</button></header><div class="assist-content"></div>`;
  node.querySelector("button").onclick = () => node.close(); node.addEventListener("close", () => node.remove(), {once:true});
  document.body.append(node); node.showModal(); return {node,content:node.querySelector(".assist-content")};
}
async function download(url, name) {
  const res = await fetch(url, {headers:authHeaders()});
  if (!res.ok) throw new Error("Download failed");
  triggerTrackedBlobDownload(await res.blob(), name, microDownloadCreated);
}

export function mountMicroEdits({getProjectId, getSelectedModel, getPrompt, getContext, getModelOptions, getHarness, setEditMode, isCad, isDebugEnabled = () => false, initialEnabled = false, onEnabledChange, onResult, onComplete}) {
  let enabled = Boolean(initialEnabled), panel = null, currentRun = null;
  const ribbon = document.createElement("div"); ribbon.className = "micro-edit-ribbon";
  ribbon.innerHTML = '<label class="micro-edit-toggle" title="Use scoped CAD edits for selected bodies and faces while preserving the rest of the assembly."><span>Micro edits</span><input type="checkbox" role="switch" data-enable aria-describedby="micro-edit-help"></label><p class="electronics-help" id="micro-edit-help">Apply small changes to selected CAD bodies and faces, preserving the rest of the assembly. Enable, then use Edit selected.</p><div class="micro-edit-links"><button type="button" data-open-bench>Open benchmarks</button><a class="micro-edit-sandbox" href="/sandbox/index.html">Open Sandbox</a></div>';
  const checkbox = ribbon.querySelector("[data-enable]");
  checkbox.checked = enabled;
  const mount = () => {const host=document.getElementById("prompt-cad-tools"); if (!host) return false; host.append(ribbon); return true;};
  if (!mount()) { const observer=new MutationObserver(() => {if (mount()) observer.disconnect();}); observer.observe(document.body,{childList:true,subtree:true}); }
  function setEnabled(next, { persist = true } = {}) {
    enabled = Boolean(next);
    checkbox.checked = enabled;
    if (enabled) setEditMode();
    if (persist) onEnabledChange?.(enabled);
  }
  checkbox.onchange = e => {
    setEnabled(e.target.checked);
  };
  ribbon.querySelector("[data-open-bench]").onclick = e => {
    e.preventDefault();
    if (!enabled) setEnabled(true);
    void open(true);
  };
  document.addEventListener("render:rate-model", e => rateModel(e.detail?.filename || getSelectedModel()));

  async function rateModel(filename) {
    const pid=getProjectId(), view=modal("Rate model");
    if (!pid || !filename) {view.content.textContent="Select a model first.";return;}
    view.content.innerHTML=`<p>${esc(filename)}</p><form class="micro-ratings">${Object.entries(RATING_CATEGORIES).map(([key,label])=>`<label>${label}<select name="${key}" required><option value="">Choose 1–5</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}${n===1?' · Poor':n===5?' · Excellent':''}</option>`).join("")}</select></label>`).join("")}<label>What should improve? (optional)<textarea maxlength="2000" rows="3" name="comment"></textarea></label><button>Save rating</button><p role="status"></p></form>`;
    view.content.querySelector("form").onsubmit=async e=>{
      e.preventDefault(); const button=e.currentTarget.querySelector("button"); button.disabled=true;
      try {
        const ratings=Object.fromEntries(Object.keys(RATING_CATEGORIES).map(key=>[key,Number(view.content.querySelector(`[name=${key}]`).value)]));
        await api(`/projects/${encodeURIComponent(pid)}/ratings`,{filename,ratings,comment:view.content.querySelector("textarea").value});
        view.content.querySelector("[role=status]").textContent="Rating saved with the model, prompt variation and performance log.";
      } catch(error){view.content.querySelector("[role=status]").textContent=error.message;button.disabled=false;}
    };
  }

  async function open(debug=false) {
    if (panel?.node.isConnected) {panel.content.querySelector(`[data-tab="${debug?'debug':'edit'}"]`)?.click();panel.node.focus();return;}
    const view=modal("CAD micro edits"); panel=view;
    const pid=getProjectId(), filename=getSelectedModel(); let timer=null, disposed=false, inspecting=false, inspection=null;
    view.node.addEventListener("close",()=>{disposed=true;clearTimeout(timer);if(panel===view)panel=null;});
    if (!pid || !filename || !isCad()) {view.content.textContent="Open a CAD project, select a model, and choose a CAD harness first.";return;}
    setEditMode();
    const options=getModelOptions(); const model=defaultMicroModel(options, getContext().model);
    view.content.innerHTML=`<nav class="assist-tabs"><button type="button" data-tab="edit" class="${debug?'':'active'}">Edit selected</button><button type="button" data-tab="debug" class="${debug?'active':''}">Debug</button><button type="button" data-tab="results">Recent results</button></nav>
      <section data-config><p class="micro-source"><strong>${esc(filename)}</strong> · ${esc(getHarness())}</p>
      <p class="micro-hint">Select the mounting body, then describe a small change. Each result is saved as a new model with STEP and GLB.</p>
      <div class="micro-scope"><label>Find a body<input type="search" data-body-search placeholder="Search body names…"></label><label>CAD bodies (up to 8)<select data-bodies multiple size="5" aria-label="CAD bodies"></select></label><details><summary>Limit to specific faces (optional)</summary><div data-faces></div></details></div>
      <label>Micro-edit instruction<textarea data-prompt rows="4" maxlength="12000" placeholder="Enlarge the selected mounting holes to 3.2 mm; keep their centers and the rest of the model."></textarea></label>
      <div data-single><label>Model<select data-model>${options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></label></div>
      <section data-debug-config ${debug?'':'hidden'}><h3>Benchmark models and prompt variations</h3><p>Each repeat uses the same original geometry. Select up to 10 outputs in total. Calls use the AI source selected in the prompt composer.</p>
      <div class="micro-model-options">${options.map(o=>`<label><input type="checkbox" data-trial="${esc(o.value)}" ${o.value===model?'checked':''}> ${esc(o.label)}<input type="number" data-count="${esc(o.value)}" min="1" max="5" value="1" aria-label="Repeats for ${esc(o.label)}"></label>`).join("")}</div>
      <fieldset><legend>Prompt variations (cycled through repeats)</legend>${Object.entries(MICRO_VARIANTS).map(([key,label])=>`<label><input type="checkbox" data-variant="${key}" checked> ${label}</label>`).join("")}</fieldset></section>
      <label class="micro-repair"><input type="checkbox" data-repair> Allow one repair pass on the same selected part</label><p data-status role="status">Inspecting B-rep geometry…</p>
      <footer><button type="button" data-run disabled>${debug?'Run benchmarks':'Generate micro edit'}</button><button type="button" data-refresh>Refresh selection</button></footer></section><section data-results hidden></section>`;
    const status=view.content.querySelector("[data-status]");
    const bodyPicker=view.content.querySelector("[data-bodies]"); const selectedBodies=new Set(), selectedFaces=new Set();
    view.content.querySelector("[data-prompt]").value=getPrompt();
    view.content.querySelector("[data-model]").value=model;
    const showConfig=which=>{
      debug=which==="debug"; view.content.querySelector("[data-config]").hidden=which==="results";
      view.content.querySelector("[data-results]").hidden=which!=="results";
      view.content.querySelector("[data-debug-config]").hidden=!debug;
      view.content.querySelector("[data-single]").hidden=debug;
      view.content.querySelector("[data-run]").textContent=debug?"Run benchmarks":"Generate micro edit";
      view.content.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===which));
    };
    view.content.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{showConfig(b.dataset.tab); if(b.dataset.tab==="results") void recent();});
    function renderBodies(){
      const q=view.content.querySelector("[data-body-search]").value.toLowerCase();
      bodyPicker.innerHTML=(inspection?.bodies||[]).filter(b=>selectedBodies.has(b.id)||b.name.toLowerCase().includes(q)).map(b=>`<option value="${b.id}" ${selectedBodies.has(b.id)?'selected':''}>${esc(b.name)} · ${b.size_mm.map(n=>Number(n.toFixed(2))).join(' × ')} mm</option>`).join("");
    }
    async function inspect(){
      if(inspecting)return; inspecting=true; bodyPicker.disabled=true; view.content.querySelector("[data-run]").disabled=true;
      status.textContent="Inspecting the selected CAD revision…";
      try {
        inspection=await api("/inspect",{project_id:pid,base_filename:filename,body_ids:[...selectedBodies]});
        if(disposed)return;
        inspection.selected_body_ids.forEach(id=>selectedBodies.add(id)); renderBodies();
        view.content.querySelector("[data-faces]").innerHTML=inspection.bodies.filter(b=>selectedBodies.has(b.id)).map(b=>`<fieldset><legend>${esc(b.name)}</legend>${(b.faces||[]).map(f=>`<label><input type="checkbox" data-face="${b.id}/${f.id}" ${selectedFaces.has(`${b.id}/${f.id}`)?'checked':''}> ${f.hole?`Ø ${Number(f.hole.diameter_mm.toFixed(3))} mm hole`:esc(f.kind)} · center ${f.center_mm.map(n=>Number(n.toFixed(2))).join(', ')} mm · ${f.id}</label>`).join("")}</fieldset>`).join("");
        view.content.querySelectorAll("[data-face]").forEach(c=>c.onchange=()=>c.checked?selectedFaces.add(c.dataset.face):selectedFaces.delete(c.dataset.face));
        status.textContent=selectedBodies.size?"Ready. Unselected bodies remain unchanged. Large redesigns use regular Edit selected.":"Choose the body to edit. CAD face IDs are resolved from this revision.";
        view.content.querySelector("[data-run]").disabled=!selectedBodies.size;
      } catch(error){status.textContent=error.message;} finally {inspecting=false;bodyPicker.disabled=false;}
    }
    bodyPicker.onchange=()=>{selectedBodies.clear();[...bodyPicker.selectedOptions].slice(0,8).forEach(o=>selectedBodies.add(o.value));selectedFaces.clear();void inspect();};
    view.content.querySelector("[data-body-search]").oninput=renderBodies;
    view.content.querySelector("[data-refresh]").onclick=()=>{view.node.close();void open(debug);};
    view.content.querySelector("[data-run]").onclick=async()=>{
      const button=view.content.querySelector("[data-run]");button.disabled=true;
      try {
        if(getProjectId()!==pid || getSelectedModel()!==filename)throw new Error("Selection changed. Refresh selection before generating.");
        const models=debug?[...view.content.querySelectorAll("[data-trial]:checked")].map(c=>({model:c.dataset.trial,count:Number(view.content.querySelector(`[data-count="${CSS.escape(c.dataset.trial)}"]`).value)})):[{model:view.content.querySelector("[data-model]").value,count:1}];
        if(!models.length || trialCount(models)>10)throw new Error("Choose between 1 and 10 total outputs.");
        const variants=debug?[...view.content.querySelectorAll("[data-variant]:checked")].map(c=>c.dataset.variant):["minimal"];
        if(!variants.length)throw new Error("Select at least one prompt variation.");
        const prompt=view.content.querySelector("[data-prompt]").value.trim();if(!prompt)throw new Error("Describe the small edit first.");
        status.textContent="Starting scoped edit…";
        const context=await getContext({includeReferences:true});
        const {model:_,...keyContext}=context;
        currentRun=await api("/runs",{...keyContext, project_id:pid,base_filename:filename,revision:inspection.revision,prompt,
          body_ids:[...selectedBodies],face_ids:[...selectedFaces],models,variants,debug,harness:getHarness(),repair_passes:view.content.querySelector("[data-repair]").checked?1:0});
        showConfig("results"); renderRun(currentRun); void poll(currentRun.id);
      }catch(error){status.textContent=error.message;button.disabled=false;}
    };
    function renderRun(run){
      const target=view.content.querySelector("[data-results]");
      target.innerHTML=`<h3>${run.debug?'Debug benchmark':'Micro edit'} · ${esc(run.status)}</h3><p>${esc(run.prompt)}</p><p>${run.results.length} / ${run.total} outputs · ${run.elapsed_ms?`${(run.elapsed_ms/1000).toFixed(1)} s total`:'Running…'}</p>${run.error?`<p role="alert">${esc(run.error)}</p>`:''}
      <div class="micro-run-actions"><button data-log>Download performance log</button>${['queued','running','canceling'].includes(run.status)?'<button data-cancel>Stop remaining runs</button>':''}<small>Completed models update once after validation. No per-token viewport rebuild.</small></div>
      <div class="micro-results">${run.results.map(row=>`<article><h4>${esc(row.name)} · ${esc(row.model)}</h4><p>${esc(MICRO_VARIANTS[row.variant]||row.variant)} · ${esc(row.status)} · ${row.elapsed_ms?`${(row.elapsed_ms/1000).toFixed(2)} s`:''}</p>${row.error?`<p role="alert">${esc(row.error)}</p>`:''}${row.questions?`<p>${esc(row.questions.map(q=>typeof q==='string'?q:JSON.stringify(q)).join('\n'))}</p>`:''}${row.validation?`<p>Valid B-rep · ${row.validation.body_count} bodies · unselected bodies preserved</p><small>Intent and fit accuracy await your rating.</small>`:''}${row.glb_filename?`<div><button data-open="${esc(row.glb_filename)}">View ${esc(row.name)}</button><button data-rate="${esc(row.glb_filename)}">Rate 1–5</button><button data-download="${esc(row.step_filename)}">STEP ↓</button><button data-download="${esc(row.glb_filename)}">GLB ↓</button></div>`:''}<details><summary>Plan and timings</summary><pre>${esc(JSON.stringify(row.attempts||[],null,2))}</pre></details></article>`).join('')}</div><p data-result-status role="status"></p>`;
      const message=target.querySelector("[data-result-status]");
      target.querySelector("[data-log]").onclick=()=>download(`/api/micro-edits/projects/${encodeURIComponent(pid)}/runs/${run.id}/log`,`micro-edit-${run.id}.json`).catch(e=>message.textContent=e.message);
      target.querySelector("[data-cancel]")?.addEventListener("click",async e=>{e.target.disabled=true;try{await api(`/projects/${encodeURIComponent(pid)}/runs/${run.id}/cancel`,{});}catch(error){message.textContent=error.message;}});
      target.querySelectorAll("[data-open]").forEach(b=>b.onclick=async()=>{try{if(getProjectId()!==pid)throw new Error("Return to this project first.");await onResult(b.dataset.open);view.node.close();}catch(e){message.textContent=e.message;}});
      target.querySelectorAll("[data-rate]").forEach(b=>b.onclick=()=>rateModel(b.dataset.rate));
      target.querySelectorAll("[data-download]").forEach(b=>b.onclick=()=>download(`/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(b.dataset.download)}`,b.dataset.download).catch(e=>message.textContent=e.message));
    }
    async function poll(id){
      if(disposed)return;
      try{const run=await api(`/projects/${encodeURIComponent(pid)}/runs/${id}`);if(disposed)return;currentRun=run;renderRun(run);
        if(['queued','running','canceling'].includes(run.status))timer=setTimeout(()=>poll(id),2000);
        else {view.content.querySelector("[data-run]").disabled=false;if(getProjectId()===pid)await onComplete?.();}
      }catch(error){if(!disposed)view.content.querySelector("[data-results]").textContent=error.message;}
    }
    async function recent(){
      clearTimeout(timer);const target=view.content.querySelector("[data-results]");target.textContent="Loading results…";
      try{const {runs}=await api(`/projects/${encodeURIComponent(pid)}/runs`);if(disposed)return;
        if(!runs.length){target.textContent="No micro edits yet. Choose a body and run an edit or benchmark.";return;}
        target.innerHTML=runs.map(r=>`<button data-run-id="${r.id}">${esc(r.created_at)} · ${esc(r.status)} · ${esc(r.prompt.slice(0,100))}</button>`).join("");
        target.querySelectorAll("[data-run-id]").forEach(b=>b.onclick=()=>poll(b.dataset.runId));
      }catch(error){target.textContent=error.message;}
    }
    showConfig(debug?"debug":"edit"); await inspect();
  }
  return {open, rateModel, enabled:()=>enabled && isCad() && document.getElementById("prompt-target-mode")?.value==="edit", prefEnabled:()=>enabled, setEnabled};
}
