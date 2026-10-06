/** Inert, bounded storefront sections shared by preview and seller editor. */
export const SECTION_TYPES = { featured_models: 'Featured products', models: 'Product grid', slideshow: 'Slideshow', gallery: 'Image gallery', categories: 'Shop by category', about: 'Story / information', code: 'Code example' };
export const TEMPLATES = [
  { id: 'curated', name: 'Curated studio', note: 'A spacious spotlight and a clear product collection.', icon: '▦' },
  { id: 'catalog', name: 'Big catalog', note: 'Categories and compact cards for larger collections.', icon: '▤' },
  { id: 'showcase', name: 'Visual showcase', note: 'An image-led slideshow and editorial gallery.', icon: '▧' },
  { id: 'developer', name: 'Developer shelf', note: 'Skills, useful context, and a readable code example.', icon: '</>' },
];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function safeImage(value) {
  const s=String(value || '').trim();
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(s)) return s;
  if (/^https?:\/\//i.test(s) || /^\/(?!\/)/.test(s)) return s;
  return '';
}
export function imageFor(item) {
  const first=Array.isArray(item?.gallery)?item.gallery[0]:null;
  return safeImage(item?.thumbnail_url || item?.thumbnail?.data_url || item?.thumbnail?.url || (typeof first==='string'?first:first?.data_url||first?.url) || '');
}
export function itemUrl(item) { return `/marketplace.html#/p/${encodeURIComponent(item.kind || 'model')}/${encodeURIComponent(item.slug || item.id || '')}`; }
export function money(item) {
  if (item.access_mode === 'view_only') return 'Preview';
  const n=Number(item.price_cents || 0)/100;
  if (n<=0) return 'Free';
  try { return new Intl.NumberFormat(undefined,{style:'currency',currency:item.currency || 'USD'}).format(n); } catch { return `$${n.toFixed(2)}`; }
}
export function normalizeLayout(layout) {
  const seen=new Set();
  const clean=(Array.isArray(layout)?layout:[]).slice(0,24).filter(x => x && (SECTION_TYPES[x.type] || x.type==='hero')).map(raw => {
    const id=String(raw.id || raw.type).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const item={id,type:raw.type,visible:raw.visible!==false,label:String(raw.label || SECTION_TYPES[raw.type] || 'Store identity').slice(0,80)};
    for (const [key,max] of [['title',120],['subtitle',240],['body',8000],['code',12000]]) if(key in raw) item[key]=String(raw[key] || '').slice(0,max);
    for (const [key,values] of [['style',['grid','spotlight','compact','editorial']],['tone',['white','mist','dark','accent']],['kind',['model','knowledge','agent']]]) if(values.includes(raw[key])) item[key]=raw[key];
    if ('category' in raw) item.category=String(raw.category || '').slice(0,80);
    if (/^#[0-9a-f]{6}$/i.test(raw.accent || '')) item.accent=raw.accent;
    for (const [key,min,max] of [['columns',2,4],['limit',1,48],['interval',3,15]]) if(Number.isFinite(Number(raw[key]))) item[key]=Math.max(min,Math.min(max,Math.trunc(Number(raw[key]))));
    if(Array.isArray(raw.listing_ids)) item.listing_ids=[...new Set(raw.listing_ids.filter(x=>typeof x==='string'&&x).map(x=>x.slice(0,100)))].slice(0,48);
    return item;
  }).filter(Boolean);
  return clean.length ? clean : createTemplate('curated');
}
export function createTemplate(id, listings=[]) {
  const featured=listings.filter(imageFor).slice(0,6).map(x=>String(x.id));
  const block=(type,title,extra={})=>({id:type,type,label:SECTION_TYPES[type],title,visible:true,...extra});
  if(id==='catalog') return [block('categories','Find your next project'),block('featured_models','Popular in this store',{listing_ids:featured,style:'compact',columns:4}),block('models','Browse the collection',{columns:4,style:'compact'})];
  if(id==='showcase') return [block('slideshow','Made to inspire',{listing_ids:featured,interval:6,tone:'dark'}),block('gallery','A closer look',{listing_ids:featured,columns:3}),block('about','Behind the designs'),block('models','Take a project home',{columns:3})];
  if(id==='developer') return [block('about','Tools for your next idea',{subtitle:'Explore the workflows, requirements, and possibilities.'}),block('featured_models','Start building',{listing_ids:featured,columns:3}),block('code','A peek inside',{body:'Add a short, public example to explain your workflow.',code:''}),block('models','The complete toolkit',{columns:3})];
  return [block('featured_models','Made for your next idea',{listing_ids:featured,style:'spotlight',columns:3,tone:'mist'}),block('models','Explore the collection',{columns:3}),block('about','Meet the maker')];
}
export function itemsForSection(section,listings) {
  let items=(listings || []).filter(x=>x && x.id && (x.name || x.title));
  if(section.kind) items=items.filter(x=>x.kind===section.kind);
  if(section.category) items=items.filter(x=>x.category===section.category);
  if(section.listing_ids?.length){const map=new Map(items.map(x=>[String(x.id),x]));items=section.listing_ids.map(x=>map.get(String(x))).filter(Boolean);}
  else if(section.type==='featured_models') { const flagged=items.filter(x=>x.featured); if(flagged.length)items=flagged; else items=[...items.filter(imageFor),...items.filter(x=>!imageFor(x))]; }
  return items.slice(0,section.limit || (section.type==='models'?48:6));
}
export function productCard(item,{gallery=false}={}) {
  const thumb=imageFor(item), title=item.name || item.title || 'Untitled';
  return `<a class="sf-product${gallery?' sf-product-gallery':''}" href="${esc(itemUrl(item))}"><div class="sf-product-image">${thumb?`<img src="${esc(thumb)}" alt="${esc(title)}" loading="lazy"/>`:`<span class="sf-product-placeholder" aria-hidden="true">${esc(title[0])}</span>`}<span class="sf-kind">${esc(item.kind==='knowledge'?'Skill / knowledge':item.kind || 'Model')}</span></div><div class="sf-product-copy"><h3>${esc(title)}</h3>${gallery?'':`<p>${esc(item.tagline || '')}</p><strong>${esc(money(item))}</strong>`}</div></a>`;
}
