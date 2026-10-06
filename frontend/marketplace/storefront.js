/** Public creator storefront and profile, sharing marketplace navigation. */
import { authHeaders } from '../studio/auth.js';
import { mountStorefrontBuilder } from './storefront-builder.js?v=20260915-marketplace3';
import { mountMarketplaceTopbar } from './marketplace-topbar.js?v=20260928-hey-ai-summary1';
const root=document.getElementById('storefront-root');
async function api(path,options={}) {
  const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...authHeaders(options.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not load this store.');
  return data;
}
function pathInfo(){const parts=location.pathname.replace(/^\//,'').split('/').filter(Boolean);if(parts[0]==='u'&&parts[1])return{kind:'profile',value:parts[1]};if(parts[0]==='s'&&parts[1])return{kind:'store',value:parts[1]};return{kind:'store',value:parts[0]};}
async function main(){
  try{
    const info=pathInfo(), data=await api(`/api/marketplace/${info.kind==='profile'?'profile':'store'}/${encodeURIComponent(info.value)}`);
    document.title=`${data.profile?.store?.store_title||data.profile?.display_name||data.slug} — Render ${info.kind==='profile'?'profile':'store'}`;
    const initialEdit=new URLSearchParams(location.search).get('edit')==='1';
    let controller;
    if(info.kind==='profile'){
      const mod=await import('./public-profile-showcase.js?v=20260923-profile-cards1&marketplace-dm1');
      controller=await mod.mountPublicProfile(root,data,{api,edit:initialEdit});
    }else controller=mountStorefrontBuilder(root,data,{api,initialEdit});
    mountMarketplaceTopbar({onStoreSettings:data.profile?.is_self&&info.kind==='store'?()=>controller?.setEditing(true):undefined,agentContext:{store:data.slug}});
    window.addEventListener('pagehide',()=>controller?.dispose?.(),{once:true});
  }catch(err){root.replaceChildren();const p=document.createElement('p');p.className='status error';p.textContent=err.message||'Store not found.';const a=document.createElement('a');a.href='/marketplace.html';a.textContent='← Back to marketplace';root.append(p,a);mountMarketplaceTopbar({});}
}
void main();
