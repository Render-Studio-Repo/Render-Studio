#!/usr/bin/env python3
"""Isolated editor regression: no account, real job, or project is modified."""
import asyncio
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright
from backend.services.video_ffmpeg import ffmpeg_bin

ROOT = Path(__file__).resolve().parents[2]

async def main():
    with tempfile.TemporaryDirectory() as tmp:
        media = Path(tmp) / 'result.webm'
        subprocess.run([ffmpeg_bin(), '-v', 'error', '-f', 'lavfi', '-i',
                        'color=c=blue:s=160x90:r=20', '-t', '3', '-c:v', 'libvpx',
                        '-deadline', 'realtime', str(media)], check=True)
        clip = media.read_bytes()
        stats = dict(active=False, polls=0, inflight=0, max_inflight=0, downloads=0, authorized=False)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            async def route(req):
                path = req.request.url.split('8001')[-1].split('?')[0]
                if path == '/__film-test':
                    return await req.fulfill(content_type='text/html', body='<div data-video-preview-wrap><video id="preview" controls></video></div><div id="editor"></div>')
                if path == '/fixture.webm':
                    return await req.fulfill(content_type='video/webm', body=clip)
                if path == '/api/video/film-edit':
                    body = req.request.post_data_buffer.decode('latin1')
                    assert 'clip_count' in body and 'clip_file_1' in body and 'clip_path_0' in body
                    assert 'duration_0' in body
                    stats['active'] = True
                    return await req.fulfill(status=202, json=dict(trace_id='new', generation=dict(kind='video', status='running', trace_id='new')))
                if path == '/api/projects/test/generation':
                    if not stats['active']:
                        return await req.fulfill(json={})
                    stats['polls'] += 1
                    stats['inflight'] += 1
                    stats['max_inflight'] = max(stats['max_inflight'], stats['inflight'])
                    await asyncio.sleep(.9)
                    stats['inflight'] -= 1
                    job = dict(kind='video', trace_id='new', status='complete', duration=3,
                               filename='references/edit.webm', url='/api/projects/test/files/references/edit.webm')
                    # The first response contains only an older completed edit.
                    if stats['polls'] == 1:
                        job = dict(kind='video', trace_id='old', status='complete', url='/old.webm')
                    return await req.fulfill(json=dict(jobs=[job]))
                if path == '/api/projects/test/files/references/edit.webm':
                    stats['downloads'] += 1
                    stats['authorized'] = req.request.headers.get('authorization') == 'Bearer test-token'
                    return await req.fulfill(content_type='video/webm', body=clip)
                if path.startswith('/api/'):
                    return await req.fulfill(json={})
                return await req.continue_()
            await page.route('**/*', route)
            await page.goto('http://127.0.0.1:8001/__film-test')
            result = await page.evaluate('''async () => {
              const {mountVideoTimelineEditor} = await import('/viewport/video-timeline-editor.js?film-runtime=1');
              const video = document.querySelector('video');
              const editor = mountVideoTimelineEditor(document.querySelector('#editor'), {
                getPreviewEl:()=>video, getToken:()=> 'test-token', getProjectId:()=> 'test',
              });
              await new Promise(r=>setTimeout(r,100));
              const blob = await (await fetch('/fixture.webm')).blob();
              await editor.setPrimaryClip(blob, {sourcePath:'references/source.webm', duration:3});
              await editor.addClip({blob, label:'uploaded', duration:3});
              document.querySelector('[data-vtl-prompt]').value = 'hard cut';
              await editor.generate();
              await new Promise((resolve,reject)=> {
                if(video.readyState >= 2) return resolve();
                video.addEventListener('loadeddata',resolve,{once:true});
                setTimeout(()=>reject(new Error('edited preview never loaded')),5000);
              });
              const draft = editor.getTimelineDraft();
              if(draft.clips.length !== 1 || draft.clips[0].filename !== 'references/edit.webm') throw new Error('timeline was not replaced: '+JSON.stringify({draft, status:document.querySelector('[data-vtl-status]')?.textContent}));
              if(!video.src.startsWith('blob:') || video.duration < 2.8) throw new Error('preview did not load full authenticated result');
              const src = video.src;
              window.dispatchEvent(new CustomEvent('render3d:video-generation', {detail:{projectId:'other', kind:'video',status:'complete',trace_id:'wrong',url:'/wrong.webm'}}));
              window.dispatchEvent(new CustomEvent('render3d:video-generation', {detail:{projectId:'test', kind:'video',status:'complete',trace_id:'new',url:'/api/projects/test/files/references/edit.webm'}}));
              await new Promise(r=>setTimeout(r,100));
              if(video.src !== src) throw new Error('duplicate/foreign event replaced preview');
              await video.play();
              await new Promise(r=>setTimeout(r,150));
              if(video.currentTime <= 0) throw new Error('result does not play');
              const result = {duration:video.duration, clips:draft.clips.length, playback:true};
              editor.destroy();
              return result;
            }''')
            assert stats['max_inflight'] == 1, stats
            assert stats['downloads'] == 1 and stats['authorized'], stats
            assert not errors, errors
            result.update(stats)
            out = ROOT/'docs/verification/video-film-edit-20260916.json'
            out.write_text(json.dumps(dict(passed=True, result=result), indent=2)+'\n')
            print(json.dumps(result))
            await browser.close()

asyncio.run(main())
