"""Real Three r172/WebGL2 startup and retry QA; isolated fixture, no project writes."""
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/private/tmp/webgl-recovery-runtime')
OUT.mkdir(exist_ok=True)
IMPORTS = re.search(r'<script type="importmap">(.*?)</script>', (ROOT / 'frontend/index.html').read_text(), re.S).group(1)
HTML = '''<!doctype html><html><head><meta charset="utf-8"><script type="importmap">''' + IMPORTS + '''</script>
<style>body{margin:0;background:#0d1117;color:#dce7ef;font:15px system-ui;padding:28px}h1{font-size:21px;margin:0 0 7px}p{color:#9eafbc}main{display:flex;gap:24px;margin-top:24px}#healthy{width:420px}#healthy canvas{width:420px;height:280px;border-radius:12px}#panel{position:relative;flex:1;min-width:390px}.webgl-fallback-message{display:flex;flex-direction:column;align-items:center;padding:24px;background:#101720;border:1px solid #744439;border-radius:14px;text-align:center;max-width:470px}.webgl-fallback-message>strong{color:#ff7c70;font-size:19px}.webgl-fallback-message>span{line-height:1.5}.evidence{background:#142334;padding:14px;border-radius:8px;margin-top:14px;font:13px monospace;color:#8ed8bc;white-space:pre-wrap}</style>
</head><body><h1>WebGL startup recovery — browser verification</h1><p>Real Three r172 renderer · isolated test fixture · project files untouched</p><main><section id="healthy"><div id="gpu"></div><div class="evidence" id="checks"></div></section><section id="panel"></section></main></body></html>'''

RUNTIME = r'''async () => {
  const THREE = await import('three');
  const glModule = await import('/viewport/webgl-renderer-fallback.js?runtime-qa=1');
  const panelModule = await import('/viewport/webgl-startup-panel.js?runtime-qa=1');
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const {createStudioWebGlRenderer:create, createStudioRendererWithRetry:retry} = glModule;
  const release = renderer => { renderer.dispose(); renderer.forceContextLoss(); };
  const renderer = create(THREE, {antialias:false, preserveDrawingBuffer:true});
  renderer.setSize(420,280); renderer.setPixelRatio(1);
  document.querySelector('#gpu').append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#153c5a');
  const camera = new THREE.PerspectiveCamera(40,1.5,.1,10);camera.position.z=3;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#3fcea0'}));
  cube.rotation.set(.4,.5,0); scene.add(cube); renderer.render(scene,camera);
  const gl=renderer.getContext(), pixel=new Uint8Array(4);gl.readPixels(210,140,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  check(THREE.REVISION==='172','Uses actual Three r172');
  check(gl instanceof WebGL2RenderingContext,'Allocates real WebGL2');
  check(pixel[1]>120 && pixel[1]>pixel[0] && pixel[3]===255,'Real geometry renders a green framebuffer pixel');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const gpu={version:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixel:[...pixel]};

  const asked=[];
  const blockedCanvas=()=>{
    const canvas=document.createElement('canvas'), native=canvas.getContext.bind(canvas);
    canvas.getContext=(type,attributes)=>{
      asked.push(type);
      if(type==='webgl2'){
        const event=new Event('webglcontextcreationerror');Object.defineProperty(event,'statusMessage',{value:'GPU process temporarily unavailable (QA injection)'});canvas.dispatchEvent(event);return null;
      }
      return native(type,attributes);
    };return canvas;
  };
  let blockedError;
  try{create(THREE,{createCanvas:blockedCanvas});}catch(error){blockedError=error;}
  check(blockedError?.name==='WebGlStartupError','Unavailable WebGL2 produces a controlled startup error');
  check(asked.some(name=>name==='webgl2') && asked.some(name=>name==='webgl'),'Falls back to WebGL1 after WebGL2 is refused');
  check(blockedError.webglDiagnostics.some(row=>row.profile==='software'),'Reports a software WebGL2 profile');
  check(blockedError.webglDiagnostics.some(row=>row.profile==='webgl1'),'Reports a WebGL1 profile');
  check(blockedError.webglDiagnostics.some(row=>row.reason==='GPU process temporarily unavailable (QA injection)'),'Browser context-creation statusMessage survives in diagnostics');
  check(new Set(blockedError.webglDiagnostics.map(row=>row.profile)).size>=3,'Reports distinct attempted graphics profiles');

  const availableAt=performance.now()+80;let attempts=0;
  const recovered=await retry(()=>{attempts++;return create(THREE,{antialias:false,createCanvas:performance.now()<availableAt?blockedCanvas:()=>document.createElement('canvas')});},{delays:[40,80,120]});
  check(attempts>=2 && recovered.getContext() instanceof WebGL2RenderingContext,'Bounded retry recovers after delayed GPU availability');
  release(recovered);

  window.qa={checks,gpu,renderer,blockedError,blockedCanvas,allowProbe:false,probeCalls:0,reloads:0,storage:new Map(),panelModule};
  window.qa.panel=panelModule.mountWebGlStartupPanel(document.querySelector('#panel'),{
    error:blockedError,
    storage:{getItem:key=>qa.storage.get(key),setItem:(key,value)=>qa.storage.set(key,value),removeItem:key=>qa.storage.delete(key)},
    probe:async()=>{qa.probeCalls++;const r=await retry(()=>create(THREE,{antialias:false,createCanvas:qa.allowProbe?()=>document.createElement('canvas'):blockedCanvas}),{delays:[20]});release(r);},
    reload:()=>qa.reloads++,
  });
  document.querySelector('#checks').textContent=checks.map(label=>'✓ '+label).join('\n');
  return {checks,gpu};
}'''


async def run_mode(playwright, name, args, headless=True):
    browser = await playwright.chromium.launch(headless=headless, args=args)
    page = await browser.new_page(viewport={'width': 1100, 'height': 820})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.route('**/__webgl-recovery-runtime', lambda route: route.fulfill(content_type='text/html', body=HTML))
    await page.goto('http://127.0.0.1:8001/__webgl-recovery-runtime')
    result = await page.evaluate(RUNTIME)
    await page.get_by_role('button', name='Retry 3D').click()
    await page.wait_for_function("qa.probeCalls===1 && !qa.panel.querySelector('button').disabled")
    assert await page.evaluate('qa.reloads') == 0
    assert await page.evaluate('qa.storage.size') == 0
    assert 'still could not start' in await page.locator('#panel').inner_text()
    result['checks'].append('Failed Retry 3D stays on page, re-enables retry, and does not store compatibility mode')
    await page.get_by_text('Graphics diagnostics', exact=True).click()
    assert 'GPU process temporarily unavailable (QA injection)' in await page.locator('#panel pre').inner_text()
    await page.screenshot(path=str(OUT / f'{name}-retry-failed.png'))
    await page.evaluate('qa.allowProbe=true')
    await page.get_by_role('button', name='Retry 3D').click()
    await page.wait_for_function('qa.reloads===1')
    assert await page.evaluate('qa.probeCalls') == 2
    assert await page.evaluate('qa.storage.get(qa.panelModule.WEBGL_COMPATIBILITY_KEY)') == '1'
    assert await page.locator('#panel button').is_disabled()
    assert 'Graphics are available' in await page.locator('#panel').inner_text()
    result['checks'].append('Successful Retry 3D probes a real renderer, saves one-shot compatibility mode, and calls reload once')
    await page.screenshot(path=str(OUT / f'{name}-retry-success.png'))
    assert not errors, errors
    result['errors'] = errors
    await browser.close()
    return result


async def main():
    results = {}
    async with async_playwright() as playwright:
        for name, args, headless in [
            ('default', [], True),
            ('headed-default', [], False),
            ('software', ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], True),
        ]:
            try:
                results[name] = await run_mode(playwright, name, args, headless)
            except Exception as error:
                results[name] = {'failure': str(error)}
    (OUT / 'report.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    assert all('failure' not in value for value in results.values()), 'A browser configuration failed; inspect report.json'


if __name__ == '__main__':
    asyncio.run(main())
