/** Public portfolios: approved product media, deliberate snippets, and owner-curated pins. */
import { authHeaders } from "../studio/auth.js";
import { shopCard } from "./shopping-view.js?v=20260923-profile-cards1";

const VERSION = "20260923-profile-cards1";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const keyOf = (p) => `${p.kind}:${p.listing_id || p.id}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

async function defaultApi(path, options = {}) {
  const response = await fetch(path, {...options, headers: {"Content-Type":"application/json", ...authHeaders(), ...options.headers}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}

function stylesheet() {
  if (document.querySelector("link[data-profile-showcase]")) return;
  const link = document.createElement("link"); link.rel = "stylesheet";
  link.href = `/marketplace/public-profile-showcase.css?v=${VERSION}`; link.dataset.profileShowcase = "";
  document.head.append(link);
}

export async function pinToPublicProfile(item, {api = defaultApi} = {}) {
  return api("/api/marketplace/profile-showcase/me/pins", {method:"POST", body:JSON.stringify({kind:item.kind || "model", listing_id:item.listing_id || item.id, category:item.category || ""})});
}

function money(item) {
  if (!item.price_cents) return "Free";
  try { return new Intl.NumberFormat(undefined,{style:"currency",currency:item.currency || "USD"}).format(item.price_cents / 100); }
  catch { return `$${(item.price_cents / 100).toFixed(2)}`; }
}

export async function mountPublicProfile(root, data, {api = defaultApi, edit = false} = {}) {
  stylesheet();
  const profile = data.profile || {};
  root.classList.add("profile-showcase");
  let response;
  try { response = await api(`/api/marketplace/profile/${encodeURIComponent(profile.handle || "")}/showcase`); }
  catch (error) {
    root.innerHTML = `<div class="ps-empty"><h2>Profile could not load</h2><p>${esc(error.message)}</p><button data-retry>Try again</button></div>`;
    root.querySelector("[data-retry]").onclick = () => mountPublicProfile(root,data,{api,edit});
    return;
  }
  let saved = clone(response.showcase), draft = clone(saved), revision = response.revision;
  const isOwner = response.is_self === true;
  let editing = isOwner && (edit || new URLSearchParams(location.search).get("edit") === "1");
  const listings = response.listings || [];
  let tab = !draft.pins.length && listings.length ? "products" : "collection";
  let category = "", slide = 0, dragKey = "", busy = false, status = "", dirty = false;
  const index = new Map(listings.map(p => [keyOf(p),p]));
  const itemFor = (pin) => index.get(keyOf(pin));

  function changed() { dirty = true; status = "Unsaved changes"; }
  function setStatus(text) { status = text; const el = root.querySelector("[data-ps-status]"); if(el) el.textContent = text; }
  const beforeUnload = (event) => { if (dirty) {event.preventDefault(); event.returnValue = "";} };
  window.addEventListener("beforeunload",beforeUnload);

  function image(item, pin = {}) {
    const url = item.media?.[pin.image_index || 0] || item.thumbnail_url;
    return url ? `<img src="${esc(url)}" alt="${esc(pin.caption || item.name)}" loading="lazy">` : `<span class="ps-image-fallback">${esc(item.kind === "model" ? "◇" : item.kind === "agent" ? "⌘" : "{}")}</span>`;
  }

  function pinTools(pin) {
    if (!editing) return "";
    const i = draft.pins.indexOf(pin), item = itemFor(pin);
    return `<div class="ps-pin-tools"><span aria-hidden="true" class="ps-grip">⠿</span><button data-edit-pin="${esc(keyOf(pin))}" aria-label="Edit ${esc(item.name)}">✎</button><button data-move="${i}:up" ${i ? "" : "disabled"} aria-label="Move ${esc(item.name)} earlier">←</button><button data-move="${i}:down" ${i < draft.pins.length-1 ? "" : "disabled"} aria-label="Move ${esc(item.name)} later">→</button><button data-remove-pin="${esc(keyOf(pin))}" aria-label="Unpin ${esc(item.name)}">×</button></div>`;
  }

  function card(item, pin = null) {
    const code = pin?.display === "code";
    if (code) return `<article class="ps-product ps-code-card" data-pin="${esc(keyOf(pin))}" draggable="${editing}">${pinTools(pin)}<a class="ps-product-media" href="${esc(item.href)}"><pre><code>${esc(pin.code || "Code example has not been added yet.")}</code></pre></a><div class="ps-product-copy"><div class="ps-kicker">${esc(pin.language || "Code example")}</div><a href="${esc(item.href)}"><h3>${esc(pin.caption || item.name)}</h3></a><div class="ps-card-bottom"><strong>${esc(money(item))}</strong><a href="${esc(item.href)}">Open code listing <span aria-hidden="true">↗</span></a></div></div></article>`;
    const product = {...item, name: pin?.caption || item.name, owner: {name: profile.display_name, handle: profile.handle}};
    return `<div class="ps-market-card" ${pin ? `data-pin="${esc(keyOf(pin))}" draggable="${editing}"` : ""}>${pin ? pinTools(pin) : ""}${shopCard(product,{price:money})}</div>`;
  }

  function visiblePins() { return draft.pins.filter(p => itemFor(p) && (!category || p.category === category)); }

  function content() {
    const pins = visiblePins();
    if (tab === "products") return listings.length ? `<div class="ps-grid shop-grid">${listings.filter(i => !category || draft.pins.some(p => keyOf(p)===keyOf(i)&&p.category===category)).map(i => card(i)).join("")}</div>` : empty("No public products yet", "Published products will appear here.");
    if (tab === "code") {
      const codes = pins.filter(p => p.display === "code");
      return codes.length ? `<div class="ps-code-table" role="table" aria-label="Code examples"><div class="ps-code-row ps-code-head" role="row"><span>Example</span><span>Language</span><span>Collection</span><span>Product</span></div>${codes.map(p => { const item=itemFor(p); return `<div class="ps-code-row" role="row"><div><strong>${esc(p.caption || item.name)}</strong><pre><code>${esc(p.code)}</code></pre></div><span>${esc(p.language || "Code")}</span><span>${esc(p.category || "—")}</span><a href="${esc(item.href)}">Open code listing ↗</a></div>`; }).join("")}</div>` : empty("Share how it works", "Code examples are public excerpts that link to the full product.");
    }
    if (tab === "gallery") {
      const pictures = pins.filter(p => p.display !== "code" && itemFor(p)?.media?.length);
      if (!pictures.length) return empty("A gallery of ideas", "Pin products with images to build a visual collection.");
      if (draft.gallery_mode === "slideshow") {
        slide = Math.min(slide,pictures.length-1); const p=pictures[slide], item=itemFor(p);
        return `<div class="ps-slideshow"><a href="${esc(item.href)}">${image(item,p)}</a><div class="ps-slide-caption"><div><span class="ps-kicker">${slide+1} / ${pictures.length}</span><h3>${esc(p.caption || item.name)}</h3><a href="${esc(item.href)}">Explore product ↗</a></div><div><button data-slide="prev" aria-label="Previous image">←</button><button data-slide="next" aria-label="Next image">→</button></div></div></div>`;
      }
      return `<div class="ps-gallery">${pictures.map(p => `<a href="${esc(itemFor(p).href)}"><figure>${image(itemFor(p),p)}<figcaption>${esc(p.caption || itemFor(p).name)}</figcaption></figure></a>`).join("")}</div>`;
    }
    return pins.length ? `<div class="ps-grid shop-grid">${pins.map(p => card(itemFor(p),p)).join("")}</div>` : empty("A collection starts here", isOwner ? "Edit your profile to pin products, add image stories, and share code examples." : "This creator has not pinned any products yet.");
  }

  function empty(title,text) { return `<div class="ps-empty"><span aria-hidden="true">◇</span><h3>${title}</h3><p>${text}</p>${isOwner&&!editing ? `<button data-edit-start>Customize profile</button>` : ""}</div>`; }

  function render() {
    root.dataset.accent = draft.accent;
    const cover = data.cover?.enabled && data.cover?.image_url;
    root.innerHTML = `${editing ? `<div class="ps-editbar"><div><strong>✎ Edit public profile</strong><span>Drag pinned cards to rearrange</span></div><div><button data-ps-details>Profile details</button><button data-add-pin>+ Pin product</button><button data-auto-pin>Fill from products</button><button data-cancel ${busy ? "disabled" : ""}>Cancel</button><button class="ps-primary" data-save ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save profile"}</button></div></div>` : ""}
      <section class="ps-hero ${cover ? "has-cover" : ""}">${cover ? `<img class="ps-cover" src="${esc(data.cover.image_url)}" alt="">` : ""}<div class="ps-hero-copy"><div class="ps-avatar">${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="${esc(profile.display_name)}">` : esc((profile.display_name || "R")[0])}</div><div class="ps-identity"><p class="ps-kicker">Creator profile <span>· @${esc(profile.handle || "")}</span></p><h1>${esc(draft.title)}</h1><p class="ps-bio">${esc(draft.description || "Models, tools, and ideas made with Render.")}</p><div class="ps-socials">${draft.social_links.map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`).join("")}</div></div><div class="ps-hero-actions">${isOwner ? `<button data-edit-start class="ps-primary">✎ ${editing ? "Profile details" : "Edit profile"}</button>` : `<button data-message class="ps-primary">Message creator</button>`}<a class="ps-button" href="${esc(data.store_path || "/marketplace.html")}">Visit store ↗</a>${profile.receive_money?.show_button ? `<span data-recv-pay-slot></span>` : ""}</div></div><div class="ps-profile-stats"><span><strong>${listings.length}</strong> products</span><span><strong>${draft.pins.length}</strong> pinned items</span><span><strong>${draft.categories.length}</strong> collections</span></div></section>
      <div class="ps-browse-head"><nav aria-label="Profile collections">${[["collection","Pinned collection"],["products","Products"],["gallery","Image gallery"],["code","Code examples"]].map(([id,label])=>`<button data-tab="${id}" aria-current="${tab===id ? "page" : "false"}" class="${tab===id?"active":""}">${label}</button>`).join("")}</nav>${editing ? `<button data-ps-details>Manage categories</button>` : ""}</div>
      <div class="ps-filters"><button data-category="" class="${category ? "" : "active"}">All collections</button>${draft.categories.map(c=>`<button data-category="${esc(c)}" class="${category===c?"active":""}">${esc(c)}</button>`).join("")}${tab==="gallery" && editing ? `<button class="ps-gallery-mode" data-gallery-mode>${draft.gallery_mode==="grid"?"Switch to slideshow":"Switch to grid"}</button>` : ""}</div>
      <p class="ps-status" data-ps-status role="status">${esc(status)}</p><section class="ps-content" aria-label="${esc(tab)}">${content()}</section>
      ${isOwner ? `<details class="ps-payment-settings"><summary>Payment settings</summary><div data-payment-settings></div></details>` : ""}`;
    bind(); void mountPayments();
  }

  async function mountPayments() {
    const slot = root.querySelector("[data-recv-pay-slot]");
    if (slot && profile.receive_money?.show_button) {
      try { const recv = await import("./receive-payments.js?v=20260909-proftabs1&leakfix74"); if(!slot.isConnected)return; slot.innerHTML=recv.receiveButtonHtml(profile.receive_money,{compact:true}); recv.bindReceiveButton(slot,profile.receive_money,{handle:profile.handle,profileName:profile.display_name}); } catch { /* Independent payment controls keep their existing implementation. */ }
    }
    const details = root.querySelector(".ps-payment-settings");
    details?.addEventListener("toggle",async()=> { const host=details.querySelector("[data-payment-settings]"); if(details.open&&!host.dataset.mounted){host.dataset.mounted="1";try{const recv=await import("./receive-payments.js?v=20260909-proftabs1&leakfix74");await recv.mountReceivePaymentsSettings(host);}catch(error){host.textContent=error.message;}} });
  }

  function bind() {
    root.querySelectorAll(".shop-card-image img").forEach(img=>img.addEventListener("error",()=>{
      const fallback=document.createElement("span");
      fallback.className="shop-no-image";
      fallback.textContent="3D preview unavailable";
      img.replaceWith(fallback);
    },{once:true}));
    root.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;slide=0;render();});
    root.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{category=b.dataset.category;slide=0;render();});
    root.querySelectorAll("[data-edit-start]").forEach(b=>b.onclick=()=>{if(editing)editDetails();else{editing=true;render();}});
    root.querySelectorAll("[data-ps-details]").forEach(b=>b.onclick=editDetails);
    root.querySelector("[data-message]")?.addEventListener("click", async()=>{ const {openMarketplaceMessages}=await import("./marketplace-messages.js?v=20260928-marketplace-dm1"); openMarketplaceMessages({api,recipient:profile}); });
    root.querySelector("[data-add-pin]")?.addEventListener("click",()=>pinDialog());
    root.querySelector("[data-auto-pin]")?.addEventListener("click",()=>{let added=0;for(const item of listings){if(draft.pins.length>=12)break;if(!draft.pins.some(p=>keyOf(p)===keyOf(item))){draft.pins.push({kind:item.kind,listing_id:item.id,category:"",display:"product",caption:"",code:"",language:"",image_index:0});added++;}}if(added){changed();tab="collection";}else status="Your published products are already pinned.";render();});
    root.querySelector("[data-cancel]")?.addEventListener("click",()=>{if(dirty&&!confirm("Discard the unsaved profile changes?"))return;draft=clone(saved);dirty=false;editing=false;status="";render();});
    root.querySelector("[data-save]")?.addEventListener("click",async()=>{busy=true;render();try{const result=await api("/api/marketplace/profile-showcase/me",{method:"PUT",body:JSON.stringify({showcase:draft,revision})});saved=clone(result.showcase);draft=clone(saved);revision=result.revision;dirty=false;status="Profile saved";editing=false;}catch(error){status=error.message;}finally{busy=false;render();}});
    root.querySelectorAll("[data-edit-pin]").forEach(b=>b.onclick=()=>pinDialog(draft.pins.find(p=>keyOf(p)===b.dataset.editPin)));
    root.querySelectorAll("[data-remove-pin]").forEach(b=>b.onclick=()=>{draft.pins=draft.pins.filter(p=>keyOf(p)!==b.dataset.removePin);changed();render();});
    root.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>{const [raw,dir]=b.dataset.move.split(":");const i=Number(raw),to=i+(dir==="up"?-1:1);if(to<0||to>=draft.pins.length)return;[draft.pins[i],draft.pins[to]]=[draft.pins[to],draft.pins[i]];changed();render();});
    root.querySelectorAll("[data-pin]").forEach(card=>{card.addEventListener("dragstart",event=>{if(!editing)return;dragKey=card.dataset.pin;event.dataTransfer.setData("text/plain",dragKey);event.dataTransfer.effectAllowed="move";});card.addEventListener("dragover",event=>{if(editing&&dragKey){event.preventDefault();event.dataTransfer.dropEffect="move";}});card.addEventListener("drop",event=>{if(!editing||!dragKey)return;event.preventDefault();const from=draft.pins.findIndex(p=>keyOf(p)===dragKey),to=draft.pins.findIndex(p=>keyOf(p)===card.dataset.pin);if(from>=0&&to>=0&&from!==to){const [moved]=draft.pins.splice(from,1);draft.pins.splice(to,0,moved);changed();render();}dragKey="";});card.addEventListener("dragend",()=>{dragKey="";});});
    root.querySelector("[data-gallery-mode]")?.addEventListener("click",()=>{draft.gallery_mode=draft.gallery_mode==="grid"?"slideshow":"grid";changed();render();});
    root.querySelectorAll("[data-slide]").forEach(b=>b.onclick=()=>{const n=visiblePins().filter(p=>p.display!=="code"&&itemFor(p)?.media?.length).length;slide=(slide+(b.dataset.slide==="next"?1:-1)+n)%n;render();});
  }

  function dialog(title,body,onSave) {
    const el=document.createElement("dialog");el.className="ps-dialog";
    el.innerHTML=`<form><header><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close dialog">×</button></header>${body}<p class="ps-dialog-error" role="alert"></p><footer><button type="button" data-close>Cancel</button><button type="submit" class="ps-primary">Apply changes</button></footer></form>`;
    document.body.append(el); const close=()=>{el.close();el.remove();};el.querySelectorAll("[data-close]").forEach(b=>b.onclick=close);el.addEventListener("cancel",()=>el.remove());el.querySelector("form").onsubmit=event=>{event.preventDefault();try{onSave(new FormData(event.currentTarget));changed();close();render();}catch(error){el.querySelector(".ps-dialog-error").textContent=error.message;}};el.showModal();return el;
  }

  function editDetails() {
    dialog("Profile details",`<label>Title<input name="title" value="${esc(draft.title)}" maxlength="120" required></label><label>Description<textarea name="description" maxlength="2400" rows="4">${esc(draft.description)}</textarea></label><label>Categories <small>One per line, up to 12</small><textarea name="categories" rows="3">${esc(draft.categories.join("\n"))}</textarea></label><label>Social links <small>One per line: label | https://…</small><textarea name="social_links" rows="3" placeholder="Portfolio | https://example.com">${esc(draft.social_links.map(l=>`${l.label} | ${l.url}`).join("\n"))}</textarea></label><div class="ps-form-row"><label>Accent<select name="accent">${["teal","violet","amber","slate"].map(a=>`<option ${draft.accent===a?"selected":""}>${a}</option>`).join("")}</select></label><label>Gallery layout<select name="gallery_mode"><option value="grid" ${draft.gallery_mode==="grid"?"selected":""}>Image grid</option><option value="slideshow" ${draft.gallery_mode==="slideshow"?"selected":""}>Slideshow</option></select></label></div>`,fd=>{
      const title=fd.get("title").trim();if(!title)throw new Error("Add a profile title.");
      const categories=[...new Set(fd.get("categories").split("\n").map(v=>v.trim()).filter(Boolean))];if(categories.length>12||categories.some(c=>c.length>48))throw new Error("Use up to 12 category names, each under 49 characters.");
      const links=fd.get("social_links").split("\n").map(v=>v.trim()).filter(Boolean).map(line=>{const split=line.indexOf("|");const label=split<0?"Website":line.slice(0,split).trim(),url=split<0?line:line.slice(split+1).trim();let parsed;try{parsed=new URL(url);}catch{throw new Error("Use https:// URLs for social links.");}if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw new Error("Use https:// URLs for social links.");return{label,url};});if(links.length>8)throw new Error("Use up to 8 social links.");
      Object.assign(draft,{title,description:fd.get("description"),categories,social_links:links,accent:fd.get("accent"),gallery_mode:fd.get("gallery_mode")});draft.pins.forEach(p=>{if(!categories.includes(p.category))p.category="";});if(!categories.includes(category))category="";
    });
  }

  function pinDialog(existing=null) {
    if(!listings.length){setStatus("Publish a marketplace product first. Its approved images will be available to pin here.");return;}
    const initial=existing || {kind:listings[0].kind,listing_id:listings[0].id,display:"product",category:"",code:"",caption:"",language:"",image_index:0};
    const el=dialog(existing?"Edit pinned item":"Pin a product",`<label>Published product<select name="product" ${existing?"disabled":""}>${listings.map(i=>`<option value="${esc(keyOf(i))}" ${keyOf(initial)===keyOf(i)?"selected":""}>${esc(i.name)}</option>`).join("")}</select></label><div class="ps-form-row"><label>Display as<select name="display">${[["product","Product card"],["image","Gallery image"],["code","Code example"]].map(([id,label])=>`<option value="${id}" ${initial.display===id?"selected":""}>${label}</option>`).join("")}</select></label><label>Collection<select name="category"><option value="">Uncategorized</option>${draft.categories.map(c=>`<option ${initial.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label></div><label>Caption<input name="caption" maxlength="200" value="${esc(initial.caption)}" placeholder="Use product title"></label><label data-image-field>Product image<select name="image_index"></select></label><div data-code-fields><p class="ps-publish-note">This excerpt will be public. Paste only the example you want visitors to see; the full product stays behind its listing.</p><label>Language<input name="language" maxlength="24" placeholder="Python, JavaScript…" value="${esc(initial.language)}"></label><label>Public code excerpt<textarea name="code" maxlength="6000" rows="8" spellcheck="false">${esc(initial.code)}</textarea></label></div>`,fd=>{const key=existing?keyOf(existing):fd.get("product"),item=index.get(key);if(!item)throw new Error("Choose a published product.");const pin={kind:item.kind,listing_id:item.id,display:fd.get("display"),category:fd.get("category"),caption:fd.get("caption"),code:fd.get("code"),language:fd.get("language"),image_index:Number(fd.get("image_index") || 0)};if(existing)Object.assign(existing,pin);else{if(draft.pins.some(p=>keyOf(p)===key))throw new Error("This product is already pinned. Edit its card instead.");if(draft.pins.length>=48)throw new Error("A profile can have up to 48 pinned items.");draft.pins.push(pin);}tab="collection";});
    const toggle=()=>{el.querySelector("[data-code-fields]").hidden=el.querySelector('[name="display"]').value!=="code";el.querySelector("[data-image-field]").hidden=el.querySelector('[name="display"]').value==="code";};
    const images=()=>{const item=index.get(el.querySelector('[name="product"]').value);el.querySelector('[name="image_index"]').innerHTML=(item.media.length?item.media:[""]).map((url,i)=>`<option value="${i}" ${i===initial.image_index?"selected":""}>${i===0?"Product thumbnail":`Gallery image ${i}`}${!url?" (no preview yet)":""}</option>`).join("");};el.querySelector('[name="display"]').onchange=toggle;el.querySelector('[name="product"]').onchange=images;toggle();images();
  }

  render();
  const dispose=()=>{window.removeEventListener("beforeunload",beforeUnload);root.replaceChildren();};
  return {destroy:dispose,dispose,getDraft:()=>clone(draft)};
}
