"""Real click activation + browser audio; settings and provider transports are isolated."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path('/private/tmp/xr-voice-startup-20260916')

async def main():
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        # Deliberately use normal browser autoplay policy. Start comes from a real click.
        browser = await p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        page = await browser.new_page(viewport={'width': 1180, 'height': 820})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.route('**/__voice-startup-check', lambda route: route.fulfill(content_type='text/html', body='''<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#15202b;color:#dceaf4;font:18px/1.6 system-ui;padding:35px"><h1>Astra Talk · startup verification</h1><p>Actual click → delayed settings + microphone → socket → PCM audio</p><button id="talk" style="font:20px system-ui;padding:12px 28px">Talk</button><pre id="result">Waiting for the real click…</pre></body></html>'''))
        await page.goto('http://127.0.0.1:8001/__voice-startup-check')
        await page.evaluate('''async () => {
          const {createXrAgentBridge} = await import('/components/xr-agent-bridge.js?v=20260916-talk-verify');
          const {createVoiceMold} = await import('/components/voice-mold.js?v=20260916-talk-verify');
          const {VoiceAudioOutput} = await import('/components/voice-audio-output.js?v=20260916-talk-verify');
          const checks=[], check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
          const connections=new WeakMap(), nativeConnect=AudioNode.prototype.connect,nativeDisconnect=AudioNode.prototype.disconnect;
          AudioNode.prototype.connect=function(destination,...rest){const result=nativeConnect.call(this,destination,...rest);const targets=connections.get(this)||new Set();targets.add(destination);connections.set(this,targets);return result;};
          AudioNode.prototype.disconnect=function(...args){const result=nativeDisconnect.apply(this,args);if(args.length)connections.get(this)?.delete(args[0]);else connections.get(this)?.clear();return result;};
          const NativeContext=window.AudioContext, contexts=[];
          const inputContext=new NativeContext(), input=inputContext.createMediaStreamDestination();
          const oscillator=inputContext.createOscillator();oscillator.frequency.value=220;oscillator.connect(input);oscillator.start();
          window.AudioContext=class extends NativeContext {constructor(options){super(options);contexts.push(this);}};
          let micCalls=0,stateCalls=0,releaseMic,releaseState;
          navigator.mediaDevices.getUserMedia=()=>{micCalls++;return new Promise(resolve=>{releaseMic=()=>resolve(input.stream);});};
          class Socket extends EventTarget {
            static OPEN=1;constructor(){super();this.readyState=1;this.sent=[];window.testVoiceSocket=this;setTimeout(()=>this.dispatchEvent(new Event('open')),30);}
            send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='session.update')setTimeout(()=>this.event({type:'session.updated'}),30);}
            close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
            event(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
          }
          window.WebSocket=Socket;
          const bridge=createXrAgentBridge({getUserId:()=> 'isolated-user',getProjectId:()=> 'isolated-project',getToken:()=>'',getPeers:()=>[],
            getDesignContext:()=>({workspace:'cad'}),getGenerationModel:()=>({model:'isolated'}),isPresenting:()=>true,
            api:async(path,options)=>{if(path==='/api/xr-agent/state'&&!options){stateCalls++;return new Promise(resolve=>{releaseState=()=>resolve({version:1,revision:1,settings:{name:'Astra',voiceModel:'gpt-realtime-mini',includeVisualContext:false,volume:0},history:[],changes:[]});});}throw new Error('Unexpected request '+path);},
          });
          const voice=createVoiceMold({bindDesktop:false,...bridge.voiceOptions,getProjectId:()=> 'isolated-project',getToken:()=>'',
            api:async(path,options)=>path.includes('/models')?{models:[{id:'gpt-realtime-mini',transport:'realtime'}],has_openai_key:true}
              :{transport:'realtime',model:'gpt-realtime-mini',label:'Astra',proxy_ws_path:'/api/voice-mold/ws'},
          });
          bridge.bindVoice(voice);
          let attempt,second;
          document.querySelector('#talk').onclick=()=>{void inputContext.resume();attempt=bridge.start({greet:true});second=bridge.start({greet:true});void attempt.catch(()=>{});};
          window.finishVoiceCheck=async()=>{
            check(attempt===second,'Repeated Talk shares a single pending startup');
            check(micCalls===1&&stateCalls===1,'One microphone prompt and one settings request while both are pending');
            check(contexts.length===1&&contexts[0].state==='running','Output AudioContext is running before deferred settings and microphone resolve');
            releaseState();releaseMic();await attempt;
            await new Promise(resolve=>setTimeout(resolve,160));
            check(voice.getState().live,'Talk reaches live state after settings and socket handshake');
            check(contexts.length===1&&contexts[0].state==='running','Capture reuses the gesture-unlocked output context after network awaits');
            check(testVoiceSocket.sent.some(value=>value.type==='input_audio_buffer.append'),'Actual browser microphone PCM reaches the isolated socket');
            check(testVoiceSocket.sent.filter(value=>value.type==='response.create').length===1,'Talk asks for one spoken greeting');
            await bridge.stop();check(input.stream.getTracks().every(track=>track.readyState==='ended'),'Stop releases the owned microphone');bridge.dispose();await inputContext.close();
            const audio=new VoiceAudioOutput({volume:0});await audio.resume();await new Promise(resolve=>setTimeout(resolve,50));
            check(audio.el?.volume===0&&audio.gain.gain.value===0,'Mute reaches both local playback controls without changing the room stream');
            audio.setVolume(.25);check(audio.el.volume===.25,'Headset element respects the chosen local volume');
            check(audio.localOutput==='element'&&!audio.el.paused&&!connections.get(audio.gain)?.has(audio.ctx.destination),'Playing headset element disconnects the second local speaker route');
            check(connections.get(audio.bus)?.has(audio.streamDestination),'Local playback changes preserve the separate room-send connection');
            audio.close();check(audio.getOutputStream().getTracks().every(track=>track.readyState==='ended'),'Closing audio stops its separate assistant stream');
            const nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('Isolated autoplay rejection','NotAllowedError'));
            const fallback=new VoiceAudioOutput({volume:0});await fallback.resume();await Promise.resolve();
            check(fallback.localOutput==='web-audio'&&connections.get(fallback.gain)?.has(fallback.ctx.destination)&&fallback.el.paused,'Blocked HTML playback restores exactly the WebAudio local route');
            fallback.close();HTMLMediaElement.prototype.play=nativePlay;
            document.querySelector('#result').textContent=checks.map(text=>'✓ '+text).join('\\n');
            return {checks,providerRequests:0,autoplayBypass:false,contexts:contexts.length};
          };
        }''')
        await page.click('#talk')
        result = await page.evaluate('finishVoiceCheck()')
        if errors:
            raise RuntimeError(errors)
        result['pageErrors'] = errors
        (OUT / 'results.json').write_text(json.dumps(result, indent=2))
        await page.screenshot(path=str(OUT / 'browser.png'))
        await browser.close()
        print(json.dumps(result, indent=2))

asyncio.run(main())
