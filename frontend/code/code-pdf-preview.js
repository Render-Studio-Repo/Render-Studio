// Use the same pinned PDF.js renderer as the reference document viewer.
let library;
async function pdfLibrary(){
  library ||= import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(pdf=>{
    pdf.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    return pdf;
  }).catch(error=>{library=null;throw error;});
  return library;
}

export function mountPdfPreview(host,url){
  host.className='code-pdf-preview';
  host.innerHTML='<div class="code-pdf-controls"><button data-prev>Previous page</button><span data-page>Opening PDF…</span><button data-next>Next page</button><button data-out aria-label="Zoom out">−</button><button data-in aria-label="Zoom in">+</button></div><div class="code-pdf-pages"><canvas aria-label="PDF page"></canvas></div>';
  const $=s=>host.querySelector(s),canvas=$('canvas'),label=$('[data-page]');
  let document=null,loading=null,task=null,page=1,zoom=1,closed=false,sequence=0;
  const controls=()=>{$('[data-prev]').disabled=!document||page<=1;$('[data-next]').disabled=!document||page>=document.numPages;};controls();
  async function paint(){
    if(!document||closed)return;
    const run=++sequence;task?.cancel();
    try{
      if(task)await task.promise.catch(()=>{});
      const pdfPage=await document.getPage(page);
      if(closed||run!==sequence)return;
      const original=pdfPage.getViewport({scale:1});
      const scale=Math.min(3,Math.max(.25,(host.clientWidth-32)/original.width))*zoom;
      const viewport=pdfPage.getViewport({scale:Math.min(scale,Math.sqrt(5000000/(original.width*original.height)))});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      label.textContent=`Page ${page} of ${document.numPages} · ${Math.round(zoom*100)}%`;controls();
      task=pdfPage.render({canvasContext:canvas.getContext('2d'),viewport});await task.promise;
      if(!closed&&run===sequence)canvas.dataset.rendered='true';
    }catch(error){if(!closed&&error.name!=='RenderingCancelledException')label.textContent=`PDF preview unavailable: ${error.message}`;}
  }
  $('[data-prev]').onclick=()=>{if(page>1){page--;void paint();}};
  $('[data-next]').onclick=()=>{if(document&&page<document.numPages){page++;void paint();}};
  $('[data-out]').onclick=()=>{zoom=Math.max(.5,zoom-.25);void paint();};
  $('[data-in]').onclick=()=>{zoom=Math.min(2,zoom+.25);void paint();};
  void (async()=>{try{const pdf=await pdfLibrary();if(closed)return;loading=pdf.getDocument(url);document=await loading.promise;if(closed){void document.destroy();return;}await paint();}catch(error){if(!closed)label.textContent=`PDF preview unavailable: ${error.message}`;}})();
  return()=>{closed=true;sequence++;task?.cancel();void loading?.destroy()?.catch(()=>{});};
}
