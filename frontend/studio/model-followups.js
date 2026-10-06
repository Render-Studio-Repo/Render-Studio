import { authHeaders } from "./auth.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const followupDraftKey = (pid, filename) => `render:model-followup:${pid}:${filename}`;
export function answerSnapshot(data, answers, notes) {
  return {filename:data.filename, model_revision:data.model_revision, revision:data.revision, answers:{...answers}, notes};
}

async function api(path, body, method = body ? "POST" : "GET") {
  const res = await fetch(`/api/design-assist${path}`, {method, headers:{...authHeaders(),"Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not save follow-up questions");
  return data;
}

export function mountModelFollowups({getProjectId, getSelectedModel, getContext, getPrompt, attachReference}) {
  let state = null, modal = null, opening = null;
  const current = s => getProjectId() === s.pid && getSelectedModel() === s.requestFilename;
  function status(s, text) { if (s.status?.isConnected) s.status.textContent = text; }
  function stash(s) {
    try { localStorage.setItem(s.key, JSON.stringify(answerSnapshot(s.data,s.answers,s.notes))); }
    catch { status(s,"Saving to the project… Browser draft storage is unavailable."); }
  }
  async function flushState(s) {
    clearTimeout(s.timer);
    if (s.conflict) throw new Error("Review the recovered follow-up draft and click Save before continuing.");
    if (s.saving) { await s.saving; return flushState(s); }
    if (s.saved === s.edited) return;
    s.saving = (async () => {
      while (s.saved !== s.edited) {
        const version = s.edited;
        const result = await api(`/projects/${encodeURIComponent(s.pid)}/model-followups`, answerSnapshot(s.data,s.answers,s.notes), "PUT");
        s.data.revision = result.revision;
        s.saved = version;
        if (s.saved === s.edited) {
          s.data = result;
          try { localStorage.removeItem(s.key); } catch { /* project copy succeeded */ }
          if (current(s)) attachReference({...result.reference,projectId:s.pid});
          status(s,"Saved automatically · Follow-up questions.txt is linked to your prompt.");
        } else stash(s);
      }
    })();
    try { await s.saving; }
    catch (error) {
      status(s,`${error.message} Your draft stays on this device; retry saving before Generate.`);
      if (!s.status?.isConnected) {
        const globalStatus = document.getElementById("prompt-status");
        if (globalStatus) {globalStatus.className="status error";globalStatus.textContent=`Follow-up answers are saved locally but not synced: ${error.message}`;}
      }
      throw error;
    } finally { s.saving = null; }
  }
  function changed(s) {
    s.edited++; stash(s); status(s,"Saving…"); clearTimeout(s.timer);
    s.timer = setTimeout(() => { void flushState(s).catch(() => {}); },450);
  }

  async function open() {
    if (modal?.isConnected && modal.open) { modal.focus(); return opening; }
    if (modal?.isConnected) { modal.remove(); modal = null; }
    const pid = getProjectId(), requestFilename = getSelectedModel();
    if (!pid || !requestFilename) return;
    modal = document.createElement("dialog"); const dialog = modal;
    dialog.className = "assist-dialog model-followups-dialog";
    dialog.innerHTML = '<header><h2>Refine this model</h2><button type="button" data-close aria-label="Close">×</button></header><div class="assist-content"><p>Reviewing your generated model, selected parts and drawings…</p></div>';
    document.body.append(dialog); dialog.showModal();
    const content = dialog.querySelector(".assist-content");
    let dialogState;
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      if (dialogState && dialogState.saved !== dialogState.edited) { stash(dialogState); void flushState(dialogState).catch(() => {}); }
      dialog.remove(); if (modal === dialog) modal = null;
    },{once:true});
    opening = (async () => {
      try {
        if (state && state.saved !== state.edited && !state.conflict) await flushState(state);
        const context = await getContext({selectionRequired:true,includeModelImage:true});
        if (context.project_id !== pid || context.base_filename !== requestFilename) throw new Error("Selection changed. Reopen questions for the selected model.");
        const data = await api("/model-followups/generate", {...context,prompt:getPrompt()});
        if (getProjectId() !== pid || getSelectedModel() !== requestFilename) return;
        const s = {pid,requestFilename,data,answers:Object.fromEntries(data.questions.map(q=>[q.id,q.answer || ""])),notes:data.notes || "",key:followupDraftKey(pid,data.filename),edited:0,saved:0};
        state = s; dialogState = s;
        let recovered = false;
        try {
          const draft = JSON.parse(localStorage.getItem(s.key) || "null");
          if (draft?.model_revision === data.model_revision) {
            s.answers = {...s.answers,...draft.answers}; s.notes = draft.notes || "";
            recovered = true; s.edited++;
            s.conflict = draft.revision !== data.revision && (JSON.stringify(s.answers) !== JSON.stringify(Object.fromEntries(data.questions.map(q=>[q.id,q.answer || ""]))) || s.notes !== (data.notes || ""));
          }
        } catch { /* malformed old draft */ }
        attachReference({...data.reference,projectId:pid});
        if (!dialog.isConnected) { if (recovered) await flushState(s); return; }
        content.innerHTML = `<p><strong>${esc(data.filename)}</strong></p><p>${esc(data.summary)}</p><p>What should change to make this fit your assembly? Your answers save automatically, including when you close this window.</p>
          <form class="assist-questions">${data.questions.map(q=>`<label><strong>${esc(q.question)}</strong><small>${esc(q.reason)}</small><textarea rows="2" maxlength="5000" data-answer="${esc(q.id)}" placeholder="For example: move the battery tray 15 mm toward the rear; keep its holes unchanged…">${esc(s.answers[q.id])}</textarea></label>`).join("")}
          <label><strong>Anything else that looks wrong or needs a smaller edit?</strong><textarea data-notes rows="3" maxlength="10000" placeholder="Name the part or reference a selected face. Describe what to keep and what to change.">${esc(s.notes)}</textarea></label>
          <p class="assist-status" role="status"></p><button type="submit">Save and return to Edit selected</button></form>`;
        s.status = content.querySelector("[role=status]");
        status(s,s.conflict ? "Saved answers changed in another window. Review this recovered draft, then click Save to use it." : recovered ? "Recovered your local draft. Saving it to the project…" : "Follow-up questions.txt is linked to your prompt. Answers save automatically.");
        if (s.conflict) {
          const prior=document.createElement("details"); const title=document.createElement("summary");title.textContent="Compare with currently saved answers";
          const text=document.createElement("pre");text.style.whiteSpace="pre-wrap";text.textContent=data.questions.map(q=>`${q.question}\n${q.answer || '[not answered]'}`).join("\n\n")+"\n"+(data.notes || "");
          prior.append(title,text);s.status.before(prior);
        }
        content.querySelectorAll("[data-answer]").forEach(input=>input.addEventListener("input",()=>{s.answers[input.dataset.answer]=input.value;changed(s);}));
        content.querySelector("[data-notes]").addEventListener("input",event=>{s.notes=event.target.value;changed(s);});
        content.querySelector("form").onsubmit = async event => {
          event.preventDefault();
          s.conflict = false;
          try { await flushState(s); dialog.close(); } catch { /* draft retained, error visible */ }
        };
        if (recovered && !s.conflict) void flushState(s).catch(()=>{});
      } catch (error) {
        if (dialog.isConnected) {
          content.textContent = error.message;
          const retry = document.createElement("button"); retry.textContent = "Try again";
          retry.onclick = () => {dialog.close();void open();}; content.append(retry);
        }
      }
    })();
    try { await opening; } finally { opening = null; }
  }

  async function prepare() {
    if (document.getElementById("prompt-target-mode")?.value !== "edit") return;
    if (opening) await opening;
    if (state && current(state)) await flushState(state);
    const pid=getProjectId(), filename=getSelectedModel();
    if (!pid || !filename) return;
    const data=await api(`/projects/${encodeURIComponent(pid)}/model-followups?filename=${encodeURIComponent(filename)}`);
    if (getProjectId() !== pid || getSelectedModel() !== filename) throw new Error("Model changed while loading its follow-up answers.");
    attachReference(data.reference ? {...data.reference,projectId:pid} : null);
    if (state && current(state) && state.data.model_revision !== data.model_revision) state = null;
    // A draft from a closed/reloaded page must be reviewed/saved before it can
    // silently disappear from a Generate or Improve request.
    if (localStorage.getItem(followupDraftKey(pid,data.filename))) {
      await open();
      if (state && current(state)) await flushState(state);
    }
  }
  const onEdit = () => {
    if (document.getElementById("prompt-target-mode")?.value === "edit") setTimeout(()=>{void open();},0);
  };
  document.getElementById("prompt-target-mode")?.addEventListener("change",onEdit);
  document.addEventListener("render:edit-selected",onEdit);
  document.addEventListener("visibilitychange",()=>{if(document.hidden && state)void flushState(state).catch(()=>{});});
  return {open,prepare};
}
