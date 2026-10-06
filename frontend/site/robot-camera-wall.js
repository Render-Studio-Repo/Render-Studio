const token = () => { try { return localStorage.getItem("render3d:token") || ""; } catch { return ""; } };
function isPrivateLanHost(hostname=globalThis.location?.hostname||"") {
  const host=String(hostname).trim().toLowerCase();
  return host==="localhost"||host==="127.0.0.1"||host==="::1"||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
// Private-LAN camera routes are intentionally authorized by the server using
// the request host and peer address. Do not send a stale Render bearer token:
// an expired token can be rejected before the LAN access check runs.
const headers = () => !isPrivateLanHost()&&token() ? {Authorization:`Bearer ${token()}`} : {};
const cameras = ["left", "right", "zed"];
let running = true;
let statusTimer = 0;
let authRequired = false;

async function json(path) {
  const response = await fetch(path,{headers:headers(),cache:"no-store"});
  const data = await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.detail||`HTTP ${response.status}`);error.status=response.status;throw error;}
  return data;
}

function paintStatus(name,row={}) {
  const card=document.querySelector(`[data-camera="${name}"]`);
  if(!card)return;
  card.classList.toggle("is-live",Boolean(row.live));
  card.classList.toggle("is-offline",!row.live);
  const badge=card.querySelector(".camera-feed-head span");
  if(badge)badge.textContent=row.live?"LIVE":"OFFLINE";
  const note=card.querySelector(".camera-frame p");
  if(note)note.textContent=row.live?"":(row.reason||"Camera unavailable");
}

function showSignIn(message = "Sign in on this address to view the camera feeds.") {
  authRequired = true;
  const panel = document.querySelector("[data-camera-signin]");
  if (panel) panel.hidden = false;
  const summary = document.querySelector("[data-camera-summary]");
  if (summary) summary.textContent = message;
  cameras.forEach(name => paintStatus(name, {live:false, reason:"Sign in required"}));
}

async function refreshStatus() {
  if (authRequired) return;
  try {
    const data=await json("/api/robotics/camera-wall/status");
    cameras.forEach(name=>paintStatus(name,data.cameras?.[name]||{}));
    const summary=document.querySelector("[data-camera-summary]");
    if(summary)summary.textContent=`${data.live_count||0}/3 feeds live · ${data.privacy||"Private proxy active"}`;
  } catch(err) {
    if (err.status === 401) { showSignIn("This Mac address needs its own Render sign-in before it can show cameras."); return; }
    const summary=document.querySelector("[data-camera-summary]");
    if(summary)summary.textContent=err.message==="Not authenticated"?"Sign in to Render Studio to view camera feeds.":`Camera gateway unavailable: ${err.message}`;
    cameras.forEach(name=>paintStatus(name,{live:false,reason:"Camera gateway unavailable"}));
  }
  clearTimeout(statusTimer);
  if(running)statusTimer=setTimeout(refreshStatus,4000);
}

async function refreshFrame(name) {
  if (authRequired) return;
  const card=document.querySelector(`[data-camera="${name}"]`);
  const img=card?.querySelector("img");
  if(!img)return;
  try {
    const response=await fetch(`/api/robotics/camera-wall/${name}.jpg?t=${Date.now()}`,{headers:headers(),cache:"no-store"});
    if(response.status===401){showSignIn("This Mac address needs its own Render sign-in before it can show cameras.");return;}
    if(!response.ok)throw new Error("offline");
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const old=img.dataset.objectUrl;
    img.onload=()=>{if(old)URL.revokeObjectURL(old);};
    img.dataset.objectUrl=url;img.src=url;img.hidden=false;
  } catch { img.hidden=true; }
  if(running&&!authRequired)setTimeout(()=>refreshFrame(name),name==="zed"?900:500);
}

document.querySelector("[data-camera-login]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const inputs = form.querySelectorAll("input");
  const error = document.querySelector("[data-camera-login-error]");
  const button = form.querySelector("button");
  if (error) error.textContent = "";
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:inputs[0]?.value.trim()||"",password:inputs[1]?.value||""})});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.token) throw new Error(data.detail || "Sign-in failed");
    localStorage.setItem("render3d:token", data.token);
    authRequired = false;
    const panel = document.querySelector("[data-camera-signin]");
    if (panel) panel.hidden = true;
    if (inputs[1]) inputs[1].value = "";
    await refreshStatus();
    cameras.forEach(refreshFrame);
  } catch (err) {
    if (error) error.textContent = err.message || "Sign-in failed";
  } finally {
    if (button) button.disabled = false;
  }
});

document.querySelector("[data-camera-refresh]")?.addEventListener("click",()=>{refreshStatus();cameras.forEach(refreshFrame);});
window.addEventListener("pagehide",()=>{running=false;clearTimeout(statusTimer);});
refreshStatus(); cameras.forEach(refreshFrame);
